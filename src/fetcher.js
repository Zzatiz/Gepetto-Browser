// src/fetcher.js
//
// HTTP-first tiered fetching (inspired by Scrapling's Fetcher escalation). Many
// targets are static HTML/JSON and don't need a full browser. This provides a
// cheap request path with browser-coherent headers (UA + Client Hints + Sec-Fetch
// + Accept-Language) derived from a fingerprint profile, plus proxy support.
//
//   - Default transport: axios (already a dependency). Header-level impersonation.
//   - Optional upgrade: if `node-tls-client` (or a compatible client) is installed,
//     pass it via opts.client to get real TLS/JA3 impersonation. Lazy-loaded, so
//     it is NEVER a hard dependency and won't break `npm install`.
//
// `tieredFetch` tries HTTP first and only signals a browser fallback when the
// response looks blocked or JS-rendered.
'use strict';

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { generateFingerprint } = require('./stealth/fingerprint');

function buildHeaders(profile, extra = {}) {
  const ch = profile.clientHints;
  const brandList = ch.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
  return Object.assign({
    'User-Agent': profile.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': profile.languages.join(',') + ';q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': brandList,
    'sec-ch-ua-mobile': ch.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${ch.platform}"`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  }, extra);
}

function proxyAgent(proxy) {
  if (!proxy || !proxy.host) return null;
  const type = (proxy.type || 'http').toLowerCase();
  if (type.startsWith('socks')) return null; // needs socks-proxy-agent (not bundled)
  const auth = (proxy.username && proxy.password)
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  return new HttpsProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`);
}

/**
 * Lightweight HTTP GET with browser-coherent headers + optional proxy.
 * @returns {Promise<{status, headers, body, url, ok}>}
 */
async function httpGet(url, opts = {}) {
  const {
    fingerprint = true,
    proxy = null,
    headers = {},
    timeout = 20000,
    client = null, // optional TLS-impersonation client: { get(url, {headers, proxy}) }
    maxRedirects = 5,
  } = opts;

  const profile = (fingerprint && typeof fingerprint === 'object')
    ? fingerprint
    : generateFingerprint(fingerprint === true ? true : (fingerprint || true));
  const finalHeaders = buildHeaders(profile, headers);

  // Optional TLS-impersonation client path.
  if (client && typeof client.get === 'function') {
    const res = await client.get(url, { headers: finalHeaders, proxy, timeout });
    const status = res.status || res.statusCode || 0;
    const body = res.body || res.data || '';
    return { status, headers: res.headers || {}, body, url, ok: status >= 200 && status < 400 };
  }

  // Default axios path.
  const agent = proxyAgent(proxy);
  const res = await axios.get(url, {
    headers: finalHeaders,
    timeout,
    maxRedirects,
    httpAgent: agent || undefined,
    httpsAgent: agent || undefined,
    proxy: agent ? false : undefined,
    responseType: 'text',
    transformResponse: (d) => d,
    validateStatus: () => true,
  });
  return {
    status: res.status,
    headers: res.headers,
    body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
    url,
    ok: res.status >= 200 && res.status < 400,
  };
}

// Heuristics: does this HTTP response need a real browser?
function needsBrowser(result) {
  if (!result || !result.ok) return true;
  const body = result.body || '';
  if (body.length < 500) return true; // likely a JS shell / redirect stub
  if (/just a moment|checking your browser|enable javascript|cf-browser-verification|attention required/i.test(body)) return true;
  // A near-empty <body> usually means client-side rendering.
  const m = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (m && m[1].replace(/<[^>]+>/g, '').trim().length < 100) return true;
  return false;
}

/**
 * Tiered fetch: try cheap HTTP first; if it looks blocked/JS-rendered, signal a
 * browser fallback. Returns { mode: 'http'|'needs-browser', result }.
 */
async function tieredFetch(url, opts = {}) {
  try {
    const result = await httpGet(url, opts);
    if (!needsBrowser(result)) return { mode: 'http', result };
    return { mode: 'needs-browser', result };
  } catch (e) {
    return { mode: 'needs-browser', result: null, error: e };
  }
}

module.exports = { httpGet, tieredFetch, needsBrowser, buildHeaders };
