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
  return { uuid, host, port, params, tag, original: s };
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

function realityKeysFromInbound(inboundTemplate) {
  // We try a couple of common 3x-ui/xray shapes for reality settings.
  const reality =
    inboundTemplate?.realitySettings ||
    inboundTemplate?.streamSettings?.realitySettings ||
    inboundTemplate?.settings?.streamSettings?.realitySettings ||
    inboundTemplate?.settings?.realitySettings ||
    findFirstDeep(inboundTemplate, (n) => typeof n === 'object' && (n.fingerprint || n.publicKey || n.shortId || n.spiderX || n.serverName));

  const fp = reality?.fingerprint ?? reality?.fp ?? findFirstValueByKeys(reality, ['fingerprint', 'fp']);
  const pbk = reality?.publicKey ?? reality?.pbk ?? findFirstValueByKeys(reality, ['publicKey', 'pbk']);
  const sid = reality?.shortId ?? reality?.sid ?? findFirstValueByKeys(reality, ['shortId', 'sid']);
  const sni = reality?.serverName ?? reality?.sni ?? findFirstValueByKeys(reality, ['serverName', 'sni', 'serverNames']);
  const spx = reality?.spiderX ?? reality?.spx ?? reality?.path ?? findFirstValueByKeys(reality, ['spiderX', 'spx', 'path']);
  const flow = reality?.flow ?? findFirstValueByKeys(inboundTemplate, ['flow', 'xtlsFlow', 'xtlsSettings']);

  const sniValue = Array.isArray(sni) ? sni[0] : sni;
  const sidValue = Array.isArray(sid) ? sid[0] : sid;
  const spxValue = Array.isArray(spx) ? spx[0] : spx;

  return {
    fp: fp ?? null,
    pbk: pbk ?? null,
    sid: sidValue ?? null,
    sni: sniValue ?? null,
    spx: spxValue ?? null,
    flow: flow ?? null,
    reality,
  };
}

function buildVlessLinkFromRealityInbound({ uuid, email, inboundTemplate, publicHost }) {
  const host = isNonEmptyString(publicHost) ? publicHost : inboundTemplate?.host;
  const port = inboundTemplate?.port ?? inboundTemplate?.listen ?? inboundTemplate?.streamSettings?.port;

  const { fp, pbk, sid, sni, spx, flow } = realityKeysFromInbound(inboundTemplate);

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

  // This builds a standard VLESS Reality link. If your inbound uses different parameters,
  // you can always send the current `vless://...` link and we will only update host/port.
  const params = new URLSearchParams();
  params.set('type', 'tcp');
  params.set('security', 'reality');
  params.set('encryption', 'none');

  if (flow) params.set('flow', String(flow));
  if (fp) params.set('fp', String(fp));
  if (pbk) params.set('pbk', String(pbk));
  if (sni) params.set('sni', String(sni));
  if (sid) params.set('sid', String(sid));

  if (spx) {
    // Most UIs use `/` but whatever is configured should work.
    params.set('spx', String(spx));
  } else {
    // Reality usually requires spx/spiderX; keep the default `/` if missing.
    params.set('spx', '/');
  }

  // Telegram tag (fragment).
  const tag = isNonEmptyString(email) ? String(email) : uuid;

  return `vless://${uuid}@${host}:${port}?${params.toString()}#${tag}`;
}

module.exports = {
  tryParseVlessLink,
  updateVlessHostPort,
  buildVlessLinkFromRealityInbound,
};

