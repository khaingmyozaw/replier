const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'subscribers.json');

function emptyStore() {
  return { subscribers: {} };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.subscribers) {
      return emptyStore();
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to load subscribers: ${err.message}`);
  }
}

function saveStore(filePath, store) {
  try {
    ensureParentDir(filePath);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    throw new Error(`Failed to save subscribers: ${err.message}`);
  }
}

function extractTelegramIdentity(ctx) {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat?.id) return null;

  return {
    chatId: chat.id,
    userId: from?.id ?? null,
    username: from?.username ?? null,
    firstName: from?.first_name ?? null,
    lastName: from?.last_name ?? null,
    chatType: chat.type ?? null,
  };
}

/**
 * File-backed store of Telegram chat/user IDs for later notifications.
 */
class SubscriberStore {
  constructor({ filePath = DEFAULT_PATH } = {}) {
    this.filePath = filePath;
    this._store = loadStore(filePath);
  }

  upsertFromContext(ctx) {
    const identity = extractTelegramIdentity(ctx);
    if (!identity) return null;
    return this.upsert(identity);
  }

  upsert(identity) {
    const key = String(identity.chatId);
    const now = new Date().toISOString();
    const existing = this._store.subscribers[key];

    this._store.subscribers[key] = {
      chatId: identity.chatId,
      userId: identity.userId,
      username: identity.username,
      firstName: identity.firstName,
      lastName: identity.lastName,
      chatType: identity.chatType,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
    };

    saveStore(this.filePath, this._store);
    return this._store.subscribers[key];
  }

  list() {
    return Object.values(this._store.subscribers);
  }

  count() {
    return Object.keys(this._store.subscribers).length;
  }

  chatIds() {
    return this.list().map((s) => s.chatId);
  }
}

module.exports = {
  SubscriberStore,
  extractTelegramIdentity,
  DEFAULT_PATH,
};
