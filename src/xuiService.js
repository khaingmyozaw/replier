const ThreeXUI = require('3xui-api-client');

const ThreeXUIClass = ThreeXUI?.default ?? ThreeXUI;

function safeLower(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : null;
}

function tryJsonParse(maybeJson) {
  if (maybeJson == null) return null;
  if (typeof maybeJson === 'object') return maybeJson;
  if (typeof maybeJson !== 'string') return null;
  const trimmed = maybeJson.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractClientsFromInbound(inbound) {
  // 3x-ui usually stores clients inside `settings.clients`.
  const settingsObj = tryJsonParse(inbound?.settings) ?? inbound?.settings;
  const streamObj = tryJsonParse(settingsObj?.streamSettings ?? settingsObj?.stream) ?? settingsObj?.streamSettings;

  const containers = [];
  if (settingsObj && typeof settingsObj === 'object') containers.push(settingsObj);
  if (streamObj && typeof streamObj === 'object') containers.push(streamObj);

  const clientsArr = [];
  for (const c of containers) {
    const maybeClients = c?.clients;
    if (Array.isArray(maybeClients)) clientsArr.push(...maybeClients);
  }

  // Some panels may embed `clients` under `settings` directly without parsing,
  // but `clients` should still be present somewhere in `settings`.
  if (clientsArr.length === 0 && settingsObj && typeof settingsObj === 'object' && Array.isArray(settingsObj?.clients)) {
    clientsArr.push(...settingsObj.clients);
  }

  return clientsArr;
}

function getInboundProtocol(inbound) {
  return inbound?.protocol ?? inbound?.inboundProtocol ?? inbound?.tag ?? null;
}

function normalizeInboundsResponse(raw) {
  // 3x-ui client can return:
  // - Array<inbound>
  // - { success, obj: Array<inbound> }
  // - { obj: { inbounds: Array<inbound> } } (some wrappers)
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  if (Array.isArray(raw.obj)) return raw.obj;
  if (Array.isArray(raw.inbounds)) return raw.inbounds;
  if (Array.isArray(raw?.obj?.inbounds)) return raw.obj.inbounds;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.obj?.data)) return raw.obj.data;

  return [];
}

class ThreeXUISvc {
  constructor({ panelUrl, panelUsername, panelPassword }) {
    this.client = new ThreeXUIClass(panelUrl, panelUsername, panelPassword);
    this.index = null;
    this.lastRefreshAt = 0;
  }

  async ensureRefreshed({ force, maxAgeMs }) {
    const now = Date.now();
    const needsRefresh =
      force ||
      !this.index ||
      !this.lastRefreshAt ||
      (typeof maxAgeMs === 'number' && maxAgeMs > 0 && now - this.lastRefreshAt > maxAgeMs);

    if (!needsRefresh) return;

    const inboundsRaw = await this.client.getInbounds();
    const inbounds = normalizeInboundsResponse(inboundsRaw);
    const byEmail = new Map(); // email -> { uuid, inbound }
    const byUuid = new Map(); // uuid -> { email?, inbound }
    const byRemark = new Map(); // remark -> { uuid, inbound }

    for (const inbound of inbounds) {
      const protocol = String(getInboundProtocol(inbound) ?? '').toLowerCase();
      // We only need VLESS Reality inbounds, but we won’t hard-filter; if we find clients, keep them.
      // The VLESS builder will use stream settings to generate a link.
      if (!protocol) continue;

      const clients = extractClientsFromInbound(inbound);
      for (const c of clients ?? []) {
        const uuid = c?.id ?? c?.uuid ?? c?.clientId;
        const email = c?.email ?? c?.username ?? c?.remark;
        const remark = c?.remark ?? c?.email;

        if (typeof uuid !== 'string') continue;

        const entryByUuid = byUuid.get(uuid);
        if (!entryByUuid) byUuid.set(uuid, { uuid, email: typeof email === 'string' ? email : null, inbound });

        const emailKey = safeLower(email);
        if (emailKey) {
          byEmail.set(emailKey, { uuid, email: typeof email === 'string' ? email : null, inbound });
        }

        const remarkKey = safeLower(remark);
        if (remarkKey) {
          byRemark.set(remarkKey, { uuid, email: typeof email === 'string' ? email : null, inbound });
        }
      }
    }

    this.index = { byEmail, byUuid, byRemark };
    this.lastRefreshAt = Date.now();
  }

  async findInboundTemplateForQuery(query, { uuidMaybe }) {
    await this.ensureRefreshed({ force: false, maxAgeMs: 0 });

    const raw = String(query ?? '').trim();
    const emailKey = safeLower(raw);
    const uuidKey = uuidMaybe ? String(uuidMaybe).trim() : null;

    if (uuidKey && this.index.byUuid.has(uuidKey)) {
      const found = this.index.byUuid.get(uuidKey);
      return { inboundTemplate: found.inbound, uuid: found.uuid, email: found.email ?? raw };
    }

    if (emailKey) {
      const found =
        this.index.byEmail.get(emailKey) ??
        this.index.byRemark.get(emailKey);

      if (found) {
        return { inboundTemplate: found.inbound, uuid: found.uuid, email: found.email ?? raw };
      }
    }

    return { inboundTemplate: null, uuid: null, email: null };
  }
}

module.exports = { ThreeXUISvc };

