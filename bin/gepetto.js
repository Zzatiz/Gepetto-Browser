#!/usr/bin/env node
// bin/gepetto.js
//
// Command-line interface for Gepetto-Browser. No code required:
//   gepetto setup                                          interactive: proxies + Claude key (both optional)
//   gepetto fetch  <url> [--proxy URL] [--raw]             cheap HTTP-first path
//   gepetto browse <url> [--proxy URL] [--no-turnstile] [--screenshot FILE] [--wait MS]
//   gepetto ai     <url> "<prompt>" [--model M] [--markup N] [--proxy URL]   AI agent -> structured JSON
//
// `setup` writes proxies.txt (auto-used) and .gepetto.json (Claude key, gitignored).
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { init, tieredFetch } = require('../src/index.js');

const CONFIG_PATH = path.join(process.cwd(), '.gepetto.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return {}; }
}

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

// Buffering line reader — robust for both interactive TTY and piped stdin
// (rl.question in a loop drops lines when input arrives in bursts).
function makeLineReader() {
  const rl = readline.createInterface({ input: process.stdin });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
  rl.on('close', () => { closed = true; let w; while ((w = waiters.shift())) w(null); });
  return {
    next: () => new Promise((res) => {
      if (queue.length) return res(queue.shift());
      if (closed) return res(null);
      waiters.push(res);
    }),
    close: () => rl.close(),
  };
}

// Interactive first-run setup. Both steps optional (press Enter to skip).
async function cmdSetup() {
  const reader = makeLineReader();
  const ask = (q) => { process.stdout.write(q); return reader.next(); };
  console.log('Gepetto setup — both steps are optional (press Enter to skip).\n');

  // 1. Proxies.
  console.log('1) Proxy list (optional). One per line, any supported format:');
  console.log('   http:host:port:user:pass | socks5://user:pass@host:port | host:port');
  console.log('   Enter a blank line when done.');
  const proxies = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await ask('   proxy> ');
    if (line == null || !line.trim()) break; // blank line or EOF = done
    proxies.push(line.trim());
  }
  if (proxies.length) {
    fs.writeFileSync(path.join(process.cwd(), 'proxies.txt'), proxies.join('\n') + '\n');
    console.log(`   ✓ wrote ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'} to proxies.txt`);
  } else {
    console.log('   skipped.');
  }

  // 2. Claude key.
  console.log('\n2) Claude (Anthropic) API key (optional) — enables the AI agent plugin.');
  const key = ((await ask('   anthropic key> ')) || '').trim();
  const cfg = loadConfig();
  if (key) {
    cfg.anthropicApiKey = key;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
    console.log('   ✓ saved to .gepetto.json (gitignored)');
    console.log('   note: the AI plugin also needs:  npm install @anthropic-ai/sdk');
  } else {
    console.log('   skipped.');
  }

  reader.close();
  console.log('\nSetup complete.');
  if (key) console.log('Try:  gepetto ai "https://example.com" "summarize this page"');
}

async function cmdAI(url, prompt, flags) {
  if (!prompt) { console.error('Usage: gepetto ai <url> "<prompt>" [--model M] [--markup N] [--proxy URL]'); process.exit(1); }
  const cfg = loadConfig();
  const apiKey = flags.key || process.env.ANTHROPIC_API_KEY || cfg.anthropicApiKey;
  if (!apiKey) { console.error('No Claude key. Run `gepetto setup` or set ANTHROPIC_API_KEY.'); process.exit(1); }
  let ai;
  try { ai = require('../src/ai'); } catch (e) { console.error('AI plugin error:', e.message); process.exit(1); }
  const res = await ai.aiScrape({
    url, prompt, apiKey,
    model: flags.model || cfg.model || 'claude-haiku-4-5',
    markup: flags.markup ? parseFloat(flags.markup) : (cfg.markup || 1),
    proxy: flags.proxy || null,
    launch: { executablePath: process.env.GEPETTO_EXECUTABLE_PATH || undefined },
    onStep: (s) => console.error('  step:', s.action, '->', s.outcome),
  });
  console.log(JSON.stringify({ ok: res.ok, summary: res.summary, data: res.data, usage: res.usage, cost: res.cost }, null, 2));
}

const USAGE = `Usage:
  gepetto setup                                  configure proxies + Claude key (both optional)
  gepetto fetch  <url> [--proxy URL] [--raw]
  gepetto browse <url> [--proxy URL] [--no-turnstile] [--screenshot FILE] [--wait MS]
  gepetto ai     <url> "<prompt>" [--model M] [--markup N] [--proxy URL]`;

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const [cmd, a1, a2] = _;
  if (cmd === 'setup') return cmdSetup();
  if (cmd === 'ai') return cmdAI(a1, a2, flags);
  if ((cmd === 'fetch' || cmd === 'browse') && a1) {
    return cmd === 'fetch' ? cmdFetch(a1, flags) : cmdBrowse(a1, flags);
  }
  console.error(USAGE);
  process.exit(1);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
