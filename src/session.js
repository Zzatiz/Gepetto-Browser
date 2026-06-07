// src/session.js
//
// Lightweight session persistence: save/restore cookies to a JSON file so an
// authenticated session can be reused across runs without re-logging-in. For
// full persistence (localStorage, cache, IndexedDB) use the `userDataDir`
// option, which Chrome persists natively.
//
// Exposed on each page as page.saveCookies(file) / page.loadCookies(file).
'use strict';

const fs = require('fs');

async function saveCookies(page, file) {
  if (!file) throw new Error('saveCookies: a file path is required');
  // Save ALL browser cookies, not just those scoped to the current page URL.
  let cookies;
  try {
    const client = await page.createCDPSession();
    const res = await client.send('Network.getAllCookies');
    cookies = res.cookies || [];
    try { await client.detach(); } catch (e) {}
  } catch (e) {
    cookies = await page.cookies();
  }
  fs.writeFileSync(file, JSON.stringify(cookies, null, 2), 'utf-8');
  return cookies.length;
}

async function loadCookies(page, file) {
  if (!file || !fs.existsSync(file)) return 0;
  try {
    const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      return cookies.length;
    }
  } catch (e) {
    console.error('[Session] Failed to load cookies:', e.message);
  }
  return 0;
}

function attachSession(page) {
  page.saveCookies = (file) => saveCookies(page, file);
  page.loadCookies = (file) => loadCookies(page, file);
}

module.exports = { saveCookies, loadCookies, attachSession };
