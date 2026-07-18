const http = require('http');
const https = require('https');
const { URL } = require('url');

function normalizeBaseUrl(panelUrl) {
  const raw = String(panelUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('panelUrl is required');
  return raw.replace(/\/panel$/i, '');
}

function mergeCookies(existing, setCookieHeaders) {
  const jar = new Map();
  for (const part of String(existing || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }

  for (const header of setCookieHeaders || []) {
    const first = String(header).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }

  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function buildHeaders({ cookie, headers, payload }) {
  const reqHeaders = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(headers || {}),
  };
  if (cookie) reqHeaders.Cookie = cookie;
  if (payload) {
    reqHeaders['Content-Type'] = 'application/json';
    reqHeaders['Content-Length'] = String(payload.length);
  }
  return reqHeaders;
}

function requestJson(baseUrl, { method, path, body, headers, cookie, tlsInsecure, timeoutMs }) {
  const url = new URL(path, `${baseUrl}/`);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const timeout = timeoutMs || 30_000;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        family: 4,
        headers: buildHeaders({ cookie, headers, payload }),
        rejectUnauthorized: !tlsInsecure,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
          }
          resolve({
            status: res.statusCode || 0,
            data,
            cookie: mergeCookies(cookie, res.headers['set-cookie']),
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout (${method} ${path})`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

class ThreeXUIClient {
  constructor({ panelUrl, panelUsername, panelPassword, apiToken, tlsInsecure }) {
    this.baseUrl = normalizeBaseUrl(panelUrl);
    this.username = panelUsername || null;
    this.password = panelPassword || null;
    this.apiToken = apiToken || null;
    this.tlsInsecure = Boolean(tlsInsecure);
    this.cookie = null;
    this.csrfToken = null;
  }

  async getInbounds() {
    const res = await this.request('GET', '/panel/api/inbounds/list');
    if (res?.success === false) {
      throw new Error(res.msg || 'Failed to list inbounds');
    }
    return res;
  }

  async request(method, path, body) {
    if (this.apiToken) return this.#bearer(method, path, body);
    return this.#session(method, path, body);
  }

  async #bearer(method, path, body) {
    const res = await requestJson(this.baseUrl, {
      method,
      path,
      body,
      tlsInsecure: this.tlsInsecure,
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Panel request failed (${res.status}) ${path}`);
    }
    return res.data;
  }

  async #login() {
    if (!this.username || !this.password) {
      throw new Error('Panel username/password (or apiToken) required');
    }

    const csrfRes = await requestJson(this.baseUrl, {
      method: 'GET',
      path: '/csrf-token',
      tlsInsecure: this.tlsInsecure,
    });
    const csrf = csrfRes.data?.obj;
    if (!csrf) throw new Error('Could not obtain CSRF token from panel');

    const loginRes = await requestJson(this.baseUrl, {
      method: 'POST',
      path: '/login',
      cookie: csrfRes.cookie || null,
      tlsInsecure: this.tlsInsecure,
      headers: { 'X-CSRF-Token': csrf },
      body: { username: this.username, password: this.password },
    });

    if (loginRes.status === 403) {
      throw new Error('Login forbidden (403). CSRF token rejected by panel.');
    }
    if (loginRes.data?.success !== true) {
      throw new Error(loginRes.data?.msg || `Login failed (${loginRes.status})`);
    }

    this.cookie = loginRes.cookie || csrfRes.cookie || null;
    const csrfAfter = await requestJson(this.baseUrl, {
      method: 'GET',
      path: '/csrf-token',
      cookie: this.cookie,
      tlsInsecure: this.tlsInsecure,
    });
    this.cookie = csrfAfter.cookie || this.cookie;
    this.csrfToken = csrfAfter.data?.obj || csrf;
  }

  async #ensureSession() {
    if (!this.cookie || !this.csrfToken) await this.#login();
  }

  async #session(method, path, body) {
    await this.#ensureSession();
    const unsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(String(method).toUpperCase());
    const headers = unsafe ? { 'X-CSRF-Token': this.csrfToken } : {};

    let res = await requestJson(this.baseUrl, {
      method,
      path,
      body,
      cookie: this.cookie,
      headers,
      tlsInsecure: this.tlsInsecure,
    });

    if (res.status === 401 || res.status === 403) {
      this.cookie = null;
      this.csrfToken = null;
      await this.#login();
      if (unsafe) headers['X-CSRF-Token'] = this.csrfToken;
      res = await requestJson(this.baseUrl, {
        method,
        path,
        body,
        cookie: this.cookie,
        headers,
        tlsInsecure: this.tlsInsecure,
      });
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Panel request failed (${res.status}) ${path}`);
    }
    this.cookie = res.cookie || this.cookie;
    return res.data;
  }
}

module.exports = { ThreeXUIClient, normalizeBaseUrl };
