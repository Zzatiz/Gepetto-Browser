<p align="center">
  <img src="assets/gepetto-banner.jpg" alt="Gepetto-Browser banner" width="900"/>
</p>

# Gepetto-Browser

Stealth Puppeteer fork for serious scraping: coherent **fingerprint spoofing**, **Cloudflare Turnstile + 2Captcha** solving, **proxy rotation** with GeoIP coherence, **resilient navigation**, **self-healing selectors**, and an **HTTP-first** fast path — all behind a one-line `init()`. Inspired by puppeteer-real-browser.

---

## Features

- **One-line launch** — `init()` returns a ready, stealthed `{ browser, page }`.
- **Real fingerprint spoofing** — patches `navigator.webdriver`, **WebGL vendor/renderer** (no more SwiftShader give-away), canvas/audio noise, `hardwareConcurrency`, `deviceMemory`, screen, plugins, permissions, and removes the `HeadlessChrome` UA — all from a single **coherent, seedable profile** with matching **Client Hints** + `navigator.userAgentData`.
- **WebRTC leak prevention** — launch flag + ICE-candidate filtering so your real IP doesn't leak past the proxy.
- **Proxy rotation** — loads all of `proxies.txt` (multiple formats), rotates (`first`/`random`/`roundrobin`), supports SOCKS, authenticates **every** page/popup, and can align the page **timezone with the proxy's exit IP** (`geoip`).
- **Resilient navigation** — `page.gotoResilient()` retries with backoff, honors `Retry-After`, and waits out Cloudflare interstitials.
- **CAPTCHA solving** — bundled 2Captcha extension + a hardened Turnstile clicker (skips already-solved widgets, clicks the real challenge iframe).
- **Self-healing selectors** — `page.findAdaptive()` relocates elements by similarity when a site changes its markup (no AI).
- **HTTP-first tiered fetch** — `httpGet()` / `tieredFetch()` with browser-coherent headers; only spin up Chrome when a page actually needs it.
- **Session persistence** — `userDataDir` + cookie save/restore.
- **Human-like input** — `ghost-cursor` + simulated mouse movement before clicks/typing.
- **CLI + MCP server + Agent Skill** — drive it from the shell or from AI tools.

## Installation

```sh
npm install gepetto-browser
```

On Debian/Ubuntu the postinstall step installs the system libraries Chrome needs.
The optional MCP server needs `npm install @modelcontextprotocol/sdk`.

## Quick Start

```js
const { init } = require('gepetto-browser');

(async () => {
  const { browser, page } = await init({
    headless: false,
    fingerprint: true,     // coherent fingerprint spoofing (recommended)
    turnstile: true,       // auto-solve Cloudflare Turnstile
    userAgent: 'random',
    inputDelay: 1.5,
  });

  await page.gotoResilient('https://example.com'); // retries + challenge-aware
  console.log(await page.title(), page.fingerprint.os);
  await browser.close();
})();
```

## Options

```js
await init({
  // Launch
  headless: false,              // visible or headless
  args: [],                     // extra Chrome flags (appended to defaults)
  configFlags: null,            // replace ALL default flags
  ignoreAllFlags: false,        // launch with only your `args`, no defaults
  screenSize: { width: 1280, height: 720 },
  customConfig: {},             // extra puppeteer.launch options
  executablePath: null,         // defaults to /usr/bin/google-chrome-stable on Debian
  disableXvfb: false,           // skip xvfb on Linux
  autoLaunch: true,

  // Stealth
  fingerprint: true,            // true | <seed number/string> | <profile object>
  userAgent: 'random',          // 'random' (Agents.txt) or a UA string

  // Proxy
  proxy: null,                  // explicit proxy (object or string); else from proxies.txt
  proxies: null,                // explicit array to rotate through
  proxyRotation: 'roundrobin',  // 'first' | 'random' | 'roundrobin'
  geoip: false,                 // align page timezone with proxy exit IP

  // CAPTCHA
  captcha: false,               // prompt for a 2Captcha key + load the extension
  turnstile: true,              // background Turnstile solver

  // Performance / signal
  blockResources: false,        // true => block image/media/font, or pass your own list
  blockAds: false,              // block known ad/tracker domains
  adDomains: [],                // extra domains to block

  // Session
  userDataDir: null,            // persist profile across runs
  cookiesFile: null,            // restore cookies on launch; page.saveCookies() writes back

  // Input
  inputDelay: 0,                // seconds of simulated mouse movement before click/type
});
```

### Augmented `page`

| Member | Description |
|--------|-------------|
| `page.gotoResilient(url, opts)` | Navigate with retries/backoff + Cloudflare-challenge handling. |
| `page.findAdaptive(selector, opts)` | Self-healing selector; relocates moved elements by similarity. |
| `page.saveCookies(file)` / `page.loadCookies(file)` | Cookie session persistence (all browser cookies). |
| `page.fingerprint` | The active fingerprint profile (or `null`). |
| `page.proxy` / `page.proxyGeo` | The selected proxy and resolved exit geography. |

## Proxies

`proxies.txt` (one per line) accepts any of:

```
http:1.2.3.4:8080:user:pass
socks5://user:pass@9.9.9.9:1080
5.6.7.8:3128
```

```js
const { browser, page } = await init({
  proxyRotation: 'roundrobin',
  geoip: true,   // sets the page timezone to match the proxy's country
});
```

> SOCKS proxies work for traffic, but Chrome can't authenticate SOCKS proxies and
> GeoIP lookups only run over HTTP/HTTPS proxies.

## Resilient navigation & sessions

```js
const { browser, page } = await init({ fingerprint: true, cookiesFile: './session.json' });
await page.gotoResilient('https://shop.example.com', { retries: 3, challengeWaitMs: 60000 });
await page.saveCookies(); // writes back to ./session.json
```

## Self-healing selectors

```js
// First run records the element's signature; later runs relocate it even if the
// site changed its id/classes/markup.
const btn = await page.findAdaptive('#checkout-button');
if (btn) await btn.click();
```

## HTTP-first (no browser)

```js
const { tieredFetch, httpGet } = require('gepetto-browser');

const { mode, result } = await tieredFetch('https://api.example.com/data');
// mode === 'http'           -> result.body is ready
// mode === 'needs-browser'  -> escalate to init()+gotoResilient
```

Pass a TLS-impersonation client (e.g. `node-tls-client`) via `httpGet(url, { client })`
for real JA3/TLS spoofing — it's optional and lazy-loaded.

## CLI

```sh
gepetto fetch  "https://example.com"                 # fast HTTP path -> text
gepetto browse "https://protected.com" --screenshot out.png
gepetto browse "https://x.com" --proxy "http://user:pass@host:port"
```

## MCP server (for AI tools)

```sh
npm install @modelcontextprotocol/sdk
npm run mcp     # exposes gepetto_fetch and gepetto_browse over stdio
```

An installable Agent Skill lives in [`skill/SKILL.md`](skill/SKILL.md).

## Notes & limitations

- Fingerprint spoofing is **JS/CDP-level** (via `evaluateOnNewDocument`), which covers
  the high-value signals but cannot match a compiled-in fork for things like OS font
  enumeration. Keep a coherent profile (e.g. don't claim Windows from a Linux host with
  custom fonts installed) for best results.
- `fingerprint` accepts a **seed** for a repeatable identity across runs, or a full
  profile object to fully control the spoof.
- `blockResources` will block CAPTCHA images too — leave it off when solving image
  captchas.
