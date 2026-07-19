function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function tryParseVlessLink(input) {
  if (!isNonEmptyString(input)) return null;
  const s = input.trim();
  if (!s.startsWith('vless://')) return null;

  // vless://<uuid>@<host>:<port>?<query>#<tag>
  // URL parsing works if we replace the scheme with something URL-like.
  const replaced = `http://${s.slice('vless://'.length)}`;
  let url;
  try {
    url = new URL(replaced);
  } catch {
    return null;
  }

  const uuid = url.username || null; // because of our "http://" replacement
  const host = url.hostname || null;
  const port = url.port ? Number(url.port) : null;

  // Restore original: the part after "?" is query params for vless.
  const params = url.search ? url.search.slice(1) : '';

  let tag = null;
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) tag = decodeURIComponent(s.slice(hashIdx + 1)).trim() || null;

  // Keep the raw query string (without leading "?") to preserve parameters.
  return { uuid, host, port, params, tag, original: s, reality: parseVlessRealityParams(params) };
}

function parseVlessRealityParams(params) {
  if (!isNonEmptyString(params)) return {};
  let search;
  try {
    search = new URLSearchParams(params);
  } catch {
    return {};
  }

  const get = (key) => {
    const v = search.get(key);
    return isNonEmptyString(v) ? v.trim() : null;
  };

  return {
    fp: get('fp'),
    pbk: get('pbk'),
    sid: get('sid'),
    sni: get('sni'),
    spx: get('spx'),
    flow: get('flow'),
    type: get('type'),
    security: get('security'),
    encryption: get('encryption'),
  };
}

function updateVlessHostPort(vlessLink, { publicHost, publicPort }) {
  const parsed = tryParseVlessLink(vlessLink);
  if (!parsed) return null;
  if (!isNonEmptyString(publicHost)) return null;

  const port = Number.isFinite(publicPort) && publicPort != null ? Number(publicPort) : parsed.port;
  if (!Number.isFinite(port)) return null;

  const queryPart = parsed.params ? `?${parsed.params}` : '';
  const tagPart = parsed.tag ? `#${parsed.tag}` : '';
  return `vless://${parsed.uuid}@${publicHost}:${port}${queryPart}${tagPart}`;
}

function findFirstDeep(obj, predicate) {
  if (!obj) return null;
  const seen = new Set();

  function walk(node) {
    if (!node) return null;
    if (typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (predicate(node)) return node;

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found != null) return found;
      }
      return null;
    }

    for (const key of Object.keys(node)) {
      const found = walk(node[key]);
      if (found != null) return found;
    }
    return null;
  }

  return walk(obj);
}

function findFirstValueByKeys(obj, keys) {
  // Returns the first matching value where key matches one of `keys`.
  const keySet = new Set(keys);
  if (!obj) return null;
  const seen = new Set();

  function walk(node) {
    if (!node) return null;
    if (typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found != null) return found;
      }
      return null;
    }

    for (const [k, v] of Object.entries(node)) {
      if (keySet.has(k) && v != null) return v;
      const found = walk(v);
      if (found != null) return found;
    }
    return null;
  }

  return walk(obj);
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

function firstNonEmpty(values) {
  for (const v of values) {
    if (Array.isArray(v)) {
      const nested = firstNonEmpty(v);
      if (nested != null) return nested;
      continue;
    }
    if (isNonEmptyString(v)) return String(v).trim();
  }
  return null;
}

function pickRealityObject(inboundTemplate) {
  const streamSettings =
    tryJsonParse(inboundTemplate?.streamSettings) ??
    tryJsonParse(inboundTemplate?.settings?.streamSettings) ??
    inboundTemplate?.streamSettings ??
    inboundTemplate?.settings?.streamSettings ??
    null;

  const settingsObj = tryJsonParse(inboundTemplate?.settings) ?? inboundTemplate?.settings;

  return (
    inboundTemplate?.realitySettings ||
    streamSettings?.realitySettings ||
    settingsObj?.streamSettings?.realitySettings ||
    settingsObj?.realitySettings ||
    findFirstDeep(
      inboundTemplate,
      (n) =>
        typeof n === 'object' &&
        !Array.isArray(n) &&
        (n.fingerprint ||
          n.publicKey ||
          n.shortId ||
          n.shortIds ||
          n.spiderX ||
          n.serverName ||
          n.serverNames)
    )
  );
}

function realityKeysFromInbound(inboundTemplate) {
  // 3x-ui usually stores Reality under streamSettings (JSON string) as:
  // realitySettings: { shortIds: ["", "abcd"], serverNames: [...], settings: { publicKey, fingerprint, spiderX } }
  const reality = pickRealityObject(inboundTemplate);
  const nested = reality?.settings && typeof reality.settings === 'object' ? reality.settings : null;

  const fp = firstNonEmpty([
    reality?.fingerprint,
    reality?.fp,
    nested?.fingerprint,
    nested?.fp,
    findFirstValueByKeys(reality, ['fingerprint', 'fp']),
  ]);
  const pbk = firstNonEmpty([
    reality?.publicKey,
    reality?.pbk,
    nested?.publicKey,
    nested?.pbk,
    findFirstValueByKeys(reality, ['publicKey', 'pbk']),
  ]);
  const sid = firstNonEmpty([
    reality?.shortId,
    reality?.sid,
    reality?.shortIds,
    nested?.shortId,
    nested?.sid,
    nested?.shortIds,
    findFirstValueByKeys(reality, ['shortId', 'sid', 'shortIds']),
  ]);
  const sni = firstNonEmpty([
    reality?.serverName,
    reality?.sni,
    reality?.serverNames,
    nested?.serverName,
    nested?.sni,
    findFirstValueByKeys(reality, ['serverName', 'sni', 'serverNames']),
  ]);
  const spx = firstNonEmpty([
    reality?.spiderX,
    reality?.spx,
    reality?.path,
    nested?.spiderX,
    nested?.spx,
    nested?.path,
    findFirstValueByKeys(reality, ['spiderX', 'spx']),
  ]);
  const flow = firstNonEmpty([
    reality?.flow,
    nested?.flow,
    findFirstValueByKeys(inboundTemplate, ['flow']),
  ]);

  return { fp, pbk, sid, sni, spx, flow, reality };
}

function pickParam(primary, fallback) {
  return isNonEmptyString(primary) ? String(primary).trim() : isNonEmptyString(fallback) ? String(fallback).trim() : null;
}

function buildVlessFragmentTag({ email, inboundTemplate, fallbackTag, uuid }) {
  const remark = firstNonEmpty([inboundTemplate?.remark, inboundTemplate?.tag]);
  const name = isNonEmptyString(email) ? String(email).trim() : null;
  if (remark && name) return `${remark}-${name}`;
  if (name) return name;
  if (isNonEmptyString(fallbackTag)) return String(fallbackTag).trim();
  return uuid;
}

function buildVlessLinkFromRealityInbound({
  uuid,
  email,
  inboundTemplate,
  publicHost,
  fallbackParams,
  fallbackTag,
}) {
  const host = isNonEmptyString(publicHost) ? publicHost : inboundTemplate?.host;
  const port = inboundTemplate?.port ?? inboundTemplate?.listen ?? inboundTemplate?.streamSettings?.port;

  const fromPanel = realityKeysFromInbound(inboundTemplate);
  const fromLink = fallbackParams && typeof fallbackParams === 'object' ? fallbackParams : {};

  const fp = pickParam(fromPanel.fp, fromLink.fp);
  const pbk = pickParam(fromPanel.pbk, fromLink.pbk);
  const sid = pickParam(fromPanel.sid, fromLink.sid);
  const sni = pickParam(fromPanel.sni, fromLink.sni);
  // Prefer pasted spx (3x-ui share links often use a client-specific path).
  const spx = pickParam(fromLink.spx, fromPanel.spx) || '/';
  const flow = pickParam(fromPanel.flow, fromLink.flow);

  assertVlessBuildInputs({ uuid, host, port, fp, pbk, sni, sid });

  const params = buildRealityQueryParams({ fp, pbk, sid, sni, spx, flow });
  const tag = buildVlessFragmentTag({ email, inboundTemplate, fallbackTag, uuid });

  return `vless://${uuid}@${host}:${port}?${params}#${encodeURIComponent(tag)}`;
}

function assertVlessBuildInputs({ uuid, host, port, fp, pbk, sni, sid }) {
  const missing = [];
  if (!isNonEmptyString(uuid)) missing.push('uuid');
  if (!host) missing.push('host');
  if (!Number.isFinite(Number(port))) missing.push('port');
  if (!fp) missing.push('fingerprint (fp)');
  if (!pbk) missing.push('publicKey (pbk)');
  if (!sni) missing.push('serverName (sni)');
  if (!sid) missing.push('shortId (sid)');
  if (missing.length) {
    throw new Error(`Could not build VLESS link. Missing: ${missing.join(', ')}.`);
  }
}

function buildRealityQueryParams({ fp, pbk, sid, sni, spx, flow }) {
  // Match common VLESS Reality share-link order used by 3x-ui / clients.
  const params = new URLSearchParams();
  params.set('encryption', 'none');
  params.set('fp', String(fp));
  params.set('pbk', String(pbk));
  params.set('security', 'reality');
  params.set('sid', String(sid));
  params.set('sni', String(sni));
  params.set('spx', String(spx));
  params.set('type', 'tcp');
  if (flow) params.set('flow', String(flow));
  return params.toString();
}

module.exports = {
  tryParseVlessLink,
  parseVlessRealityParams,
  updateVlessHostPort,
  buildVlessLinkFromRealityInbound,
};

