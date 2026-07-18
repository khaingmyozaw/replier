function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function env(key) {
  const v = process.env[key];
  return isNonEmptyString(v) ? v.trim() : null;
}

function panelUrlToHost(u) {
  try {
    if (!u) return null;
    const url = new URL(String(u).replace(/\/+$/, ''));
    return url.hostname;
  } catch {
    return null;
  }
}

function parsePort(raw) {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function stripWrappingQuotes(v) {
  if (!v) return v;
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function sharedPanelFromEnv() {
  return {
    panelUrl: env('PANEL_URL'),
    panelUsername: env('PANEL_USERNAME'),
    panelPassword: stripWrappingQuotes(env('PANEL_PASSWORD')),
    apiToken: stripWrappingQuotes(env('PANEL_API_TOKEN')),
    tlsInsecure: ['1', 'true', 'yes'].includes(String(env('PANEL_TLS_INSECURE') || '').toLowerCase()),
  };
}

function hasEndpointSignal(i) {
  const prefix = `ENDPOINT_${i}_`;
  return Boolean(
    env(`${prefix}NAME`) ||
      env(`${prefix}PANEL_URL`) ||
      env(`${prefix}PUBLIC_HOST`) ||
      env(`${prefix}PANEL_USERNAME`) ||
      env(`${prefix}PANEL_PASSWORD`) ||
      env(`${prefix}API_TOKEN`)
  );
}

function readNumberedEndpoint(i, sharedPanel) {
  const prefix = `ENDPOINT_${i}_`;
  const panelUrl = env(`${prefix}PANEL_URL`) ?? sharedPanel.panelUrl;
  const tlsRaw = env(`${prefix}TLS_INSECURE`);
  return {
    id: i,
    name: env(`${prefix}NAME`) ?? `Endpoint ${i}`,
    panelUrl,
    panelUsername: env(`${prefix}PANEL_USERNAME`) ?? sharedPanel.panelUsername,
    panelPassword:
      stripWrappingQuotes(env(`${prefix}PANEL_PASSWORD`)) ?? sharedPanel.panelPassword,
    apiToken: stripWrappingQuotes(env(`${prefix}API_TOKEN`)) ?? sharedPanel.apiToken,
    tlsInsecure: tlsRaw
      ? ['1', 'true', 'yes'].includes(tlsRaw.toLowerCase())
      : sharedPanel.tlsInsecure,
    publicHost:
      env(`${prefix}PUBLIC_HOST`) ??
      (i === 1 ? env('VLESS_PUBLIC_HOST') : null) ??
      panelUrlToHost(panelUrl),
    publicPort:
      parsePort(env(`${prefix}PUBLIC_PORT`)) ??
      (i === 1 ? parsePort(env('VLESS_PUBLIC_PORT')) : undefined),
  };
}

function loadNumberedEndpoints(sharedPanel) {
  const numbered = [];
  for (let i = 1; i <= 20; i++) {
    if (!hasEndpointSignal(i)) {
      if (i > 1) break;
      continue;
    }
    numbered.push(readNumberedEndpoint(i, sharedPanel));
  }
  return numbered;
}

function loadLegacyEndpoint(sharedPanel) {
  if (!sharedPanel.panelUrl && !env('VLESS_PUBLIC_HOST') && !sharedPanel.apiToken) return [];
  return [
    {
      id: 1,
      name: env('ENDPOINT_NAME') ?? 'Endpoint 1',
      panelUrl: sharedPanel.panelUrl,
      panelUsername: sharedPanel.panelUsername,
      panelPassword: sharedPanel.panelPassword,
      apiToken: sharedPanel.apiToken,
      tlsInsecure: sharedPanel.tlsInsecure,
      publicHost: env('VLESS_PUBLIC_HOST') ?? panelUrlToHost(sharedPanel.panelUrl),
      publicPort: parsePort(env('VLESS_PUBLIC_PORT')),
    },
  ];
}

/**
 * Load endpoints from env.
 *
 * Preferred (2+ endpoints): ENDPOINT_1_*, ENDPOINT_2_*, ...
 * Shared panel shorthand: PANEL_* + ENDPOINT_N_PUBLIC_HOST
 * Legacy single: PANEL_* + VLESS_PUBLIC_HOST
 */
function loadEndpointsFromEnv() {
  const sharedPanel = sharedPanelFromEnv();
  const numbered = loadNumberedEndpoints(sharedPanel);
  if (numbered.length > 0) return numbered;
  return loadLegacyEndpoint(sharedPanel);
}

function endpointHasPanelAuth(endpoint) {
  if (!endpoint?.panelUrl) return false;
  if (endpoint.apiToken) return true;
  return Boolean(endpoint.panelUsername && endpoint.panelPassword);
}

module.exports = {
  loadEndpointsFromEnv,
  endpointHasPanelAuth,
  panelUrlToHost,
};
