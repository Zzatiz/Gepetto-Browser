#!/usr/bin/env node
// mcp/server.js
//
// Model Context Protocol server that lets AI tools (Claude, Cursor, etc.) drive
// Gepetto-Browser. Exposes two tools:
//   - gepetto_fetch   : cheap HTTP-first fetch (auto-escalates if it looks blocked)
//   - gepetto_browse  : full stealth-browser navigation + text/screenshot extraction
//
// @modelcontextprotocol/sdk is an OPTIONAL dependency (lazy-required here) so it
// never blocks `npm install` of the core library. Run with: npm run mcp
'use strict';

let Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema;
try {
  ({ Server } = require('@modelcontextprotocol/sdk/server/index.js'));
  ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
  ({ ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js'));
} catch (e) {
  console.error('[gepetto-mcp] Missing @modelcontextprotocol/sdk. Install it with:\n  npm install @modelcontextprotocol/sdk\n');
  process.exit(1);
}

const { init, httpGet, tieredFetch } = require('../src/index.js');

const EXEC = process.env.GEPETTO_EXECUTABLE_PATH || undefined;

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseProxy(p) {
  return p ? p : null; // normalizeProxy runs inside init()
}

const TOOLS = [
  {
    name: 'gepetto_fetch',
    description: 'Fast HTTP-first fetch of a URL with browser-coherent headers. Returns extracted text. Use for static/JSON pages; it reports if the target needs a full browser.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        proxy: { type: 'string', description: 'Optional proxy, e.g. http://user:pass@host:port' },
        raw: { type: 'boolean', description: 'Return raw body instead of extracted text' },
      },
      required: ['url'],
    },
  },
  {
    name: 'gepetto_browse',
    description: 'Open a URL in a stealth (fingerprint-spoofed) headless Chrome, handle Cloudflare challenges, and return the page title + visible text. Optionally returns a screenshot. Use for JS-rendered or bot-protected sites.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to open' },
        proxy: { type: 'string', description: 'Optional proxy, e.g. http://user:pass@host:port' },
        turnstile: { type: 'boolean', description: 'Enable Cloudflare Turnstile auto-clicking (default true)' },
        screenshot: { type: 'boolean', description: 'Also return a base64 PNG screenshot' },
        waitMs: { type: 'number', description: 'Extra wait after load, in ms (default 0)' },
      },
      required: ['url'],
    },
  },
];

async function doFetch(args) {
  const { mode, result } = await tieredFetch(args.url, { proxy: parseProxy(args.proxy) });
  if (!result) return { content: [{ type: 'text', text: `Fetch failed for ${args.url}` }], isError: true };
  const note = mode === 'needs-browser' ? '\n\n[note] This page looks blocked or JS-rendered — consider gepetto_browse.' : '';
  const body = args.raw ? result.body : stripHtml(result.body);
  return { content: [{ type: 'text', text: `HTTP ${result.status} ${args.url}\n\n${body.slice(0, 12000)}${note}` }] };
}

async function doBrowse(args) {
  const { browser, page } = await init({
    headless: true, disableXvfb: true, fingerprint: true,
    turnstile: args.turnstile !== false, inputDelay: 0,
    proxy: parseProxy(args.proxy), executablePath: EXEC,
  });
  try {
    await page.gotoResilient(args.url, { timeout: 60000 });
    if (args.waitMs) await new Promise((r) => setTimeout(r, args.waitMs));
    const title = await page.title();
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    const content = [{ type: 'text', text: `# ${title}\n${args.url}\n\n${(text || '').slice(0, 12000)}` }];
    if (args.screenshot) {
      const b64 = await page.screenshot({ encoding: 'base64', fullPage: false });
      content.push({ type: 'image', data: b64, mimeType: 'image/png' });
    }
    return { content };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const server = new Server({ name: 'gepetto-browser', version: '1.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === 'gepetto_fetch') return await doFetch(args || {});
      if (name === 'gepetto_browse') return await doBrowse(args || {});
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error in ${name}: ${e.message}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
  console.error('[gepetto-mcp] server running on stdio');
}

main().catch((e) => { console.error('[gepetto-mcp] fatal:', e); process.exit(1); });
