#!/usr/bin/env node
// bin/gepetto.js
//
// Command-line interface for Gepetto-Browser. No code required:
//   gepetto fetch  <url> [--proxy URL] [--raw]
//   gepetto browse <url> [--proxy URL] [--no-turnstile] [--screenshot out.png] [--wait MS]
//
// `fetch` uses the cheap HTTP-first path; `browse` launches a stealth headless
// Chrome. Output is plain text on stdout (handy for piping / agent skills).
'use strict';

const { init, tieredFetch } = require('../src/index.js');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.flags[key] = next; i++; }
      else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function cmdFetch(url, flags) {
  const { mode, result } = await tieredFetch(url, { proxy: flags.proxy || null });
  if (!result) { console.error('Fetch failed.'); process.exit(1); }
  if (mode === 'needs-browser') console.error('[hint] Page looks blocked/JS-rendered; try `gepetto browse`.');
  console.log(flags.raw ? result.body : stripHtml(result.body));
}

async function cmdBrowse(url, flags) {
  const { browser, page } = await init({
    headless: true, disableXvfb: true, fingerprint: true,
    turnstile: flags['no-turnstile'] ? false : true,
    proxy: flags.proxy || null,
    executablePath: process.env.GEPETTO_EXECUTABLE_PATH || undefined,
    inputDelay: 0,
  });
  try {
    await page.gotoResilient(url, { timeout: 60000 });
    if (flags.wait) await new Promise((r) => setTimeout(r, parseInt(flags.wait, 10) || 0));
    if (flags.screenshot) {
      const file = typeof flags.screenshot === 'string' ? flags.screenshot : 'gepetto-screenshot.png';
      await page.screenshot({ path: file, fullPage: false });
      console.error(`[saved] ${file}`);
    }
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    console.log(text);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const [cmd, url] = _;
  if (!cmd || !url || (cmd !== 'fetch' && cmd !== 'browse')) {
    console.error('Usage:\n  gepetto fetch  <url> [--proxy URL] [--raw]\n  gepetto browse <url> [--proxy URL] [--no-turnstile] [--screenshot FILE] [--wait MS]');
    process.exit(1);
  }
  if (cmd === 'fetch') await cmdFetch(url, flags);
  else await cmdBrowse(url, flags);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
