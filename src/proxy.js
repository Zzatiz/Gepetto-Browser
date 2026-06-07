// src/proxy.js
//
// Proxy loading, rotation, GeoIP coherence, and per-page authentication.
//
// gepetto previously loaded proxies.txt but only ever used the first entry and
// only authenticated the first page. This module adds rotation strategies,
// flexible line formats, SOCKS support, GeoIP-coherent timezone alignment, and
// auth for every page/popup the browser opens.
'use strict';

const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Parse a single proxy definition (string or object) into a normalized object.
 * Supported string formats:
 *   protocol:host:port:username:password
 *   protocol://username:password@host:port
 *   host:port
 *   host:port:username:password
 */
function normalizeProxy(input) {
  if (!input) return null;
  if (typeof input === 'object') {
    if (!input.host || !input.port) return null;
    return {
      type: (input.type || 'http').toLowerCase(),
      host: input.host,
      port: String(input.port),
      username: input.username || undefined,
      password: input.password || undefined,
    };
  }
  let line = String(input).trim();
  if (!line || line.startsWith('#')) return null;

  // URL form: protocol://[user:pass@]host:port
  if (line.includes('://')) {
    try {
      const u = new URL(line);
      return {
        type: (u.protocol.replace(':', '') || 'http').toLowerCase(),
        host: u.hostname,
        port: u.port,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    } catch (e) { /* fall through */ }
  }

  const parts = line.split(':').map(p => p.trim());
  // protocol:host:port[:user:pass]
  const PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];
  if (PROTOCOLS.includes(parts[0].toLowerCase())) {
    return {
      type: parts[0].toLowerCase(),
      host: parts[1],
      port: parts[2],
      username: parts[3] || undefined,
      password: parts[4] || undefined,
    };
  }
  // host:port[:user:pass]
  return {
    type: 'http',
    host: parts[0],
    port: parts[1],
    username: parts[2] || undefined,
    password: parts[3] || undefined,
  };
}

/** Load and normalize all proxies from a file (empty array on error). */
function loadProxies(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return data.split('\n').map(normalizeProxy).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Module-level cursor so repeated init() calls in one process round-robin.
let rrIndex = 0;

/**
 * Pick a proxy from a list per a strategy.
 * @param {Array} proxies
 * @param {'first'|'random'|'roundrobin'} strategy
 */
function selectProxy(proxies, strategy = 'roundrobin') {
  if (!proxies || proxies.length === 0) return null;
  if (proxies.length === 1) return proxies[0];
  switch (strategy) {
    case 'first': return proxies[0];
    case 'random': return proxies[Math.floor(Math.random() * proxies.length)];
    case 'roundrobin':
    default: {
      const p = proxies[rrIndex % proxies.length];
      rrIndex++;
      return p;
    }
  }
}

/** Build the Chrome --proxy-server value for a proxy (or null). */
function proxyServerArg(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  return `${(proxy.type || 'http').toLowerCase()}://${proxy.host}:${proxy.port}`;
}

/**
 * Resolve the proxy's exit IP -> country + timezone, used to keep the spoofed
 * timezone consistent with the proxy's geography. Best-effort; returns null on
 * any failure. Only http/https proxies are supported (no SOCKS agent bundled).
 */
async function resolveExitGeo(proxy, timeoutMs = 8000) {
  if (!proxy || !proxy.host) return null;
  const type = (proxy.type || 'http').toLowerCase();
  if (type === 'socks4' || type === 'socks5') return null; // needs socks-proxy-agent
  const auth = (proxy.username && proxy.password)
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  const proxyUrl = `http://${auth}${proxy.host}:${proxy.port}`;
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    const res = await axios.get(
      'http://ip-api.com/json/?fields=status,countryCode,timezone,query',
      { httpAgent: agent, httpsAgent: agent, proxy: false, timeout: timeoutMs }
    );
    if (res.data && res.data.status === 'success') {
      return { ip: res.data.query, countryCode: res.data.countryCode, timezone: res.data.timezone };
    }
  } catch (e) { /* best-effort */ }
  return null;
}

/** Apply the resolved geography to a page (timezone emulation). */
async function applyGeoCoherence(page, geo) {
  if (!geo) return;
  try { if (geo.timezone) await page.emulateTimezone(geo.timezone); } catch (e) {}
}

/**
 * Authenticate every page/popup the browser opens (not just the first one).
 * Chrome only supports auth for HTTP/HTTPS proxies via this mechanism.
 */
function attachProxyAuth(browser, proxy) {
  if (!proxy || !proxy.username || !proxy.password) return;
  browser.on('targetcreated', async (target) => {
    try {
      const pg = await target.page();
      if (pg) await pg.authenticate({ username: proxy.username, password: proxy.password });
    } catch (e) { /* ignore non-page targets */ }
  });
}

module.exports = {
  normalizeProxy,
  loadProxies,
  selectProxy,
  proxyServerArg,
  resolveExitGeo,
  applyGeoCoherence,
  attachProxyAuth,
};
