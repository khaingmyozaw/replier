require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const { ThreeXUISvc } = require('./src/xuiService');
const {
  tryParseVlessLink,
  updateVlessHostPort,
  buildVlessLinkFromRealityInbound,
} = require('./src/vless');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment.');
}

const PORT_REFRESH_MS = Number(process.env.XUI_REFRESH_MS ?? 5 * 60_000);
const panelUrl = process.env.PANEL_URL; // root URL without `/panel`
const panelUsername = process.env.PANEL_USERNAME;
const panelPassword = process.env.PANEL_PASSWORD;

function panelUrlToHost(u) {
  try {
    if (!u) return null;
    const url = new URL(String(u).replace(/\/+$/, '')); // trim trailing slash
    return url.hostname;
  } catch {
    return null;
  }
}

const publicHost = process.env.VLESS_PUBLIC_HOST || panelUrlToHost(panelUrl);
const publicPort = process.env.VLESS_PUBLIC_PORT ? Number(process.env.VLESS_PUBLIC_PORT) : undefined;

if (!panelUrl || !panelUsername || !panelPassword) {
  console.warn(
    'Warning: PANEL_URL/PANEL_USERNAME/PANEL_PASSWORD are not set. ' +
      'Bot will only support updating existing `vless://...` links.'
  );
}

const bot = new Telegraf(BOT_TOKEN);
const xui = panelUrl && panelUsername && panelPassword ? new ThreeXUISvc({ panelUrl, panelUsername, panelPassword }) : null;

async function ensureXuiFresh() {
  if (!xui) return;
  await xui.ensureRefreshed({ force: false, maxAgeMs: PORT_REFRESH_MS });
}

function normalizeQuery(q) {
  return (q ?? '').trim();
}

function extractQueryFromText(ctx) {
  // Supports:
  // - /key <query>
  // - any plain text message that isn't a command
  const text = ctx.message?.text ?? '';
  if (text.startsWith('/key')) {
    return normalizeQuery(text.replace(/^\/key(@\w+)?\s*/i, ''));
  }
  if (text.startsWith('/start')) return '';
  if (text.startsWith('/')) return '';
  return normalizeQuery(text);
}

function friendlyInput(input) {
  // Prevent Telegram from interpreting characters as markdown links.
  return String(input).replaceAll('_', '\\_');
}

bot.start(async (ctx) => {
  const msg = [
    'Hi',
    '',
    'ပိုမိုကောင်းမွန်တဲ့ performance ကို ရစေရန်',
    'server ပိုင်း update လုပ်ထားပါတယ်ဗျ။',
    '',
    'Key အသစ်ရယူရန် ဝယ်ယူထားသော',
    'vpn key လေးကို ပို့ပေးပါဗျ။',
    '',
    'ဥပမာ - `vless://example-link`',
    '',
    'အဆင်မပြေပါက admin: @mr_zembi ကို',
    'ဆက်သွယ်နိုင်ပါတယ်ဗျ။',
  ].join('\n');

  await ctx.reply(msg, {
    parse_mode: 'HTML',
  });
});

bot.command('key', async (ctx) => {
  const query = normalizeQuery(extractQueryFromText(ctx));
  if (!query) return ctx.reply('Usage: /key <vless://... or username/email>');
  await ctx.reply(await handleQuery(query, ctx), { parse_mode: 'HTML' });
});

bot.on('text', async (ctx) => {
  const query = normalizeQuery(extractQueryFromText(ctx));
  if (!query) return;
  await ctx.reply(await handleQuery(query, ctx), { parse_mode: 'HTML' });
});

async function handleQuery(query, ctx) {
  // 1) If user pasted a VLESS link => just update host/port.
  const vless = tryParseVlessLink(query);
  if (vless) {
    const updated = updateVlessHostPort(query, {
      publicHost,
      publicPort,
    });
    if (!updated) return 'Could not parse that VLESS link. Paste the full `vless://...` string.';
    return `Key အသစ်လေး ရပါပြီဗျာ။\n\n<pre>${updated}</pre>`;
  }

  // 2) Otherwise, attempt lookup via 3x-ui.
  if (!xui) {
    return '3x-ui credentials are not configured, so I can’t look up UUIDs by username/email. Send a full `vless://...` link instead.';
  }

  await ensureXuiFresh();

  // a) If query looks like a UUID, use it directly.
  const uuidMaybe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query) ? query : null;

  try {
    const { inboundTemplate, uuid, email } = await xui.findInboundTemplateForQuery(query, { uuidMaybe });
    if (!inboundTemplate || !uuid) {
      return `No client found for: \`${friendlyInput(query)}\`. ` + 'Check the username/email and try again.';
    }

    const vlessLink = buildVlessLinkFromRealityInbound({
      uuid,
      email,
      inboundTemplate,
      publicHost,
    });

    return `VLESS link for \`${friendlyInput(query)}\`:\n${vlessLink}`;
  } catch (err) {
    console.error(err);
    return `Error while generating VLESS link: ${err?.message ?? String(err)}`;
  }
}

bot.catch(async (err) => {
  console.error('Telegram bot error:', err);
});

async function main() {
  console.log('Bot starting...');
  if (xui) {
    await xui.ensureRefreshed({ force: true, maxAgeMs: 0 });
    console.log('3x-ui cache primed.');
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

