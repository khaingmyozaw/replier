const { ThreeXUIClient } = require('./xuiClient');

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
  const settingsObj = tryJsonParse(inbound?.settings) ?? inbound?.settings;
  const streamObj =
    tryJsonParse(settingsObj?.streamSettings ?? settingsObj?.stream) ?? settingsObj?.streamSettings;

  const containers = [];
  if (settingsObj && typeof settingsObj === 'object') containers.push(settingsObj);
  if (streamObj && typeof streamObj === 'object') containers.push(streamObj);
  // Newer panels also nest streamSettings on the inbound itself.
  const inboundStream = tryJsonParse(inbound?.streamSettings) ?? inbound?.streamSettings;
  if (inboundStream && typeof inboundStream === 'object') containers.push(inboundStream);

  const clientsArr = [];
  for (const c of containers) {
    if (Array.isArray(c?.clients)) clientsArr.push(...c.clients);
  }
  return clientsArr;
}

function getInboundProtocol(inbound) {
  return inbound?.protocol ?? inbound?.inboundProtocol ?? inbound?.tag ?? null;
}

function normalizeInboundsResponse(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.obj)) return raw.obj;
  if (Array.isArray(raw.inbounds)) return raw.inbounds;
  if (Array.isArray(raw?.obj?.inbounds)) return raw.obj.inbounds;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.obj?.data)) return raw.obj.data;
  return [];
}

function normalizeUuid(u) {
  if (typeof u !== 'string') return null;
  const trimmed = u.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function indexInboundClients(inbounds) {
  const byEmail = new Map();
  const byUuid = new Map();
  const byRemark = new Map();

  for (const inbound of inbounds) {
    const protocol = String(getInboundProtocol(inbound) ?? '').toLowerCase();
    if (!protocol) continue;

    for (const c of extractClientsFromInbound(inbound) ?? []) {
      const uuidRaw = c?.id ?? c?.uuid ?? c?.clientId;
      const uuid = normalizeUuid(uuidRaw) ?? (typeof uuidRaw === 'string' ? uuidRaw.trim() : null);
      const email = c?.email ?? c?.username ?? c?.remark;
      const remark = c?.remark ?? c?.email;
      if (typeof uuid !== 'string' || !uuid) continue;

      const entry = { uuid: typeof uuidRaw === 'string' ? uuidRaw.trim() : uuid, email: typeof email === 'string' ? email : null, inbound };
      if (!byUuid.has(uuid)) byUuid.set(uuid, entry);
      const emailKey = safeLower(email);
      if (emailKey) byEmail.set(emailKey, entry);
      const remarkKey = safeLower(remark);
      if (remarkKey) byRemark.set(remarkKey, entry);
    }
  }

  return { byEmail, byUuid, byRemark };
}

class ThreeXUISvc {
  constructor({ panelUrl, panelUsername, panelPassword, apiToken, tlsInsecure }) {
    this.client = new ThreeXUIClient({
      panelUrl,
      panelUsername,
      panelPassword,
      apiToken,
      tlsInsecure,
    });
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
    this.index = indexInboundClients(normalizeInboundsResponse(inboundsRaw));
    this.lastRefreshAt = Date.now();
  }

  async findInboundTemplateForQuery(query, { uuidMaybe, emailMaybe } = {}) {
    await this.ensureRefreshed({ force: false, maxAgeMs: 0 });

    const uuidKey = normalizeUuid(uuidMaybe);
    // Only search email when explicitly asked — never fall back from a UUID/key lookup.
    const emailKey =
      emailMaybe != null && emailMaybe !== ''
        ? safeLower(emailMaybe)
        : uuidKey
          ? null
          : safeLower(query);

    if (uuidKey && this.index.byUuid.has(uuidKey)) {
      const found = this.index.byUuid.get(uuidKey);
      return {
        inboundTemplate: found.inbound,
        uuid: found.uuid,
        email: found.email ?? emailMaybe ?? query,
      };
    }

    if (emailKey && !normalizeUuid(emailKey)) {
      const found = this.index.byEmail.get(emailKey) ?? this.index.byRemark.get(emailKey);
      if (found) {
        return {
          inboundTemplate: found.inbound,
          uuid: found.uuid,
          email: found.email ?? emailMaybe ?? query,
        };
      }
    }

    return { inboundTemplate: null, uuid: null, email: null };
  }
}

module.exports = { ThreeXUISvc, normalizeUuid };
