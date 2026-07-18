require('dotenv').config();

const { Telegraf } = require('telegraf');
const { ThreeXUISvc, normalizeUuid } = require('./src/xuiService');
const {
  tryParseVlessLink,
  updateVlessHostPort,
  buildVlessLinkFromRealityInbound,
} = require('./src/vless');
const { loadEndpointsFromEnv, endpointHasPanelAuth } = require('./src/endpoints');
const { SubscriberStore } = require('./src/subscribers');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment.');
}

const ADMIN_IDS = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
);

const subscribers = new SubscriberStore();

const PORT_REFRESH_MS = Number(process.env.XUI_REFRESH_MS ?? 5 * 60_000);
const endpoints = loadEndpointsFromEnv().map((ep) => {
  const xui = endpointHasPanelAuth(ep)
    ? new ThreeXUISvc({
        panelUrl: ep.panelUrl,
        panelUsername: ep.panelUsername,
        panelPassword: ep.panelPassword,
        apiToken: ep.apiToken,
        tlsInsecure: ep.tlsInsecure,
      })
    : null;
  return { ...ep, xui };
});

if (endpoints.length === 0) {
  console.warn(
    'Warning: no endpoints configured. Set ENDPOINT_1_* / ENDPOINT_2_* ' +
      '(or legacy PANEL_URL / VLESS_PUBLIC_HOST). Bot will not be able to rewrite links.'
  );
} else {
  console.log(
    `Loaded ${endpoints.length} endpoint(s): ${endpoints.map((e) => e.name).join(', ')}`
  );
}

const hasAnyPanel = endpoints.some((e) => e.xui);
if (!hasAnyPanel) {
  console.warn(
    'Warning: no panel credentials set. Bot will only support updating existing `vless://...` links.'
  );
}

const bot = new Telegraf(BOT_TOKEN);

function isAdmin(ctx) {
  const id = ctx.from?.id;
  return id != null && ADMIN_IDS.has(id);
}

bot.use(async (ctx, next) => {
  try {
    subscribers.upsertFromContext(ctx);
  } catch (err) {
    console.error('Failed to store subscriber:', err?.message ?? err);
  }
  return next();
});

async function ensureXuiFresh(endpoint) {
  if (!endpoint?.xui) return;
  await endpoint.xui.ensureRefreshed({ force: false, maxAgeMs: PORT_REFRESH_MS });
}

function normalizeQuery(q) {
  return (q ?? '').trim();
}

function extractQueryFromText(ctx) {
  const text = ctx.message?.text ?? '';
  if (text.startsWith('/key')) {
    return normalizeQuery(text.replace(/^\/key(@\w+)?\s*/i, ''));
  }
  if (text.startsWith('/start')) return '';
  if (text.startsWith('/')) return '';
  return normalizeQuery(text);
}

function friendlyInput(input) {
  return String(input).replaceAll('_', '\\_');
}

function formatEndpointLink(name, link) {
  return `<b>${name}</b>\n<pre>${link}</pre>`;
}

function rewriteVlessForEndpoints(query) {
  const parts = [];
  for (const ep of endpoints) {
    if (!ep.publicHost) continue;
    const updated = updateVlessHostPort(query, {
      publicHost: ep.publicHost,
      publicPort: ep.publicPort,
    });
    if (updated) parts.push(formatEndpointLink(ep.name, updated));
  }
  return parts;
}

async function lookupOnEndpoint(ep, { query, uuidMaybe, emailMaybe }) {
  if (!ep.xui) return null;
  await ensureXuiFresh(ep);

  const { inboundTemplate, uuid, email } = await ep.xui.findInboundTemplateForQuery(query, {
    uuidMaybe,
    emailMaybe,
  });
  if (!inboundTemplate || !uuid) return null;

  const vlessLink = buildVlessLinkFromRealityInbound({
    uuid,
    email,
    inboundTemplate,
    publicHost: ep.publicHost,
  });
  return formatEndpointLink(ep.name, vlessLink);
}

async function lookupAcrossEndpoints({ query, uuidMaybe, emailMaybe }) {
  const parts = [];
  const errors = [];

  for (const ep of endpoints) {
    try {
      const block = await lookupOnEndpoint(ep, { query, uuidMaybe, emailMaybe });
      if (block) parts.push(block);
    } catch (err) {
      console.error(`[${ep.name}] lookup failed:`, err);
      errors.push(`${ep.name}: ${err?.message ?? String(err)}`);
    }
  }

  return { parts, errors };
}

bot.start(async (ctx) => {
  const lines = [
    'Hi',
    '',
    'ပိုမိုကောင်းမွန်တဲ့ performance ကို ရစေရန်',
    'server ပိုင်း update လုပ်ထားပါတယ်ဗျ။',
    '',
    'Key အသစ်ရယူရန် ဝယ်ယူထားသော',
    'vpn key လေးကို ပို့ပေးပါဗျ။',
    '',
    'ဥပမာ - `vless://example-link`',
  ];

  if (endpoints.length > 1) {
    lines.push(
      '',
      'Key ရှိသော server(s) အတွက်သာ key အသစ် ရပါမည်။',
      'username/email ပို့ပါက အဲ့ဒီ client ရှိသော server အားလုံး ရနိုင်သည်။'
    );
  }

  lines.push('', 'အဆင်မပြေပါက admin: @mr_zembi ကို', 'ဆက်သွယ်နိုင်ပါတယ်ဗျ။');

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
});

bot.command('key', async (ctx) => {
  const query = normalizeQuery(extractQueryFromText(ctx));
  if (!query) return ctx.reply('Usage: /key <vless://... or username/email>');
  await ctx.reply(await handleQuery(query), { parse_mode: 'HTML' });
});

bot.command('subscribers', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const list = subscribers.list();
  if (list.length === 0) {
    return ctx.reply('No subscribers stored yet.');
  }

  const preview = list
    .slice(0, 20)
    .map((s) => {
      const name = [s.firstName, s.lastName].filter(Boolean).join(' ') || '(no name)';
      const handle = s.username ? `@${s.username}` : '-';
      return `${s.chatId} | ${handle} | ${name}`;
    })
    .join('\n');

  const more =
    list.length > 20 ? `\n…and ${list.length - 20} more (see data/subscribers.json).` : '';

  await ctx.reply(`Subscribers: ${list.length}\n\n${preview}${more}`);
});

bot.command('notify', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const text = (ctx.message?.text ?? '').replace(/^\/notify(@\w+)?\s*/i, '').trim();
  if (!text) {
    return ctx.reply('Usage: /notify <message>');
  }

  const chatIds = subscribers.chatIds();
  if (chatIds.length === 0) {
    return ctx.reply('No subscribers to notify.');
  }

  let ok = 0;
  let fail = 0;
  for (const chatId of chatIds) {
    try {
      await ctx.telegram.sendMessage(chatId, text);
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`notify failed for ${chatId}:`, err?.message ?? err);
    }
  }

  await ctx.reply(`Notify done. sent=${ok} failed=${fail} total=${chatIds.length}`);
});

bot.on('text', async (ctx) => {
  const query = normalizeQuery(extractQueryFromText(ctx));
  if (!query) return;
  await ctx.reply(await handleQuery(query), { parse_mode: 'HTML' });
});

async function handleQuery(query) {
  const vless = tryParseVlessLink(query);

  if (vless && !hasAnyPanel) {
    if (endpoints.length === 0) {
      return 'No endpoints configured. Set ENDPOINT_1_PUBLIC_HOST / ENDPOINT_2_PUBLIC_HOST in `.env`.';
    }
    const parts = rewriteVlessForEndpoints(query);
    if (parts.length === 0) {
      return 'Could not parse that VLESS link. Paste the full `vless://...` string.';
    }
    return `Key အသစ်လေး ရပါပြီဗျာ။\n\n${parts.join('\n\n')}`;
  }

  if (!hasAnyPanel) {
    return (
      '3x-ui credentials are not configured, so I can’t look up UUIDs by username/email. ' +
      'Send a full `vless://...` link instead.'
    );
  }

  // vless:// or bare UUID → match that UUID only on each panel.
  // username/email → match that identity on each panel.
  const uuidMaybe = normalizeUuid(vless?.uuid) ?? normalizeUuid(query);
  // Key/UUID searches must not fall back to #tag email (that falsely hits other servers).
  const emailMaybe = uuidMaybe || vless ? null : String(query).trim();

  const { parts, errors } = await lookupAcrossEndpoints({
    query,
    uuidMaybe,
    emailMaybe,
  });

  if (parts.length > 0) {
    return `Key အသစ်လေး ရပါပြီဗျာ။\n\n${parts.join('\n\n')}`;
  }

  if (errors.length > 0) {
    return `Error while generating VLESS link:\n${errors.join('\n')}`;
  }

  return (
    `No client found for: \`${friendlyInput(query)}\`. ` +
    'Send a `vless://...` key or username/email and try again.'
  );
}

bot.catch(async (err) => {
  console.error('Telegram bot error:', err);
});

async function main() {
  console.log('Bot starting...');
  for (const ep of endpoints) {
    if (!ep.xui) continue;
    try {
      await ep.xui.ensureRefreshed({ force: true, maxAgeMs: 0 });
      console.log(`3x-ui cache primed for ${ep.name}.`);
    } catch (err) {
      console.error(`Failed to prime ${ep.name}:`, err?.message ?? err);
    }
  }
  await bot.launch();
  console.log('Bot launched.');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
