---
name: gepetto-browser
description: Stealth-browse or fetch any URL and return its content. Use when you need to read a web page that is JS-rendered, behind Cloudflare/Turnstile, or otherwise bot-protected, or when a plain HTTP fetch is enough. Triggers on "scrape this page", "get the content of <url>", "bypass cloudflare on <url>", "screenshot this site".
allowed-tools: Bash, Read
user-invocable: true
metadata:
  openclaw:
    bins: [node]
    env_optional: [GEPETTO_EXECUTABLE_PATH]
---

# Gepetto-Browser Skill

Drive the Gepetto-Browser stealth scraper from the command line. Two modes:

- **Cheap path (HTTP-first):** for static HTML / JSON, no browser needed.
- **Stealth browser:** fingerprint-spoofed headless Chrome that handles Cloudflare
  Turnstile and JS-rendered pages.

## Usage

From the package directory:

```bash
# Fast HTTP fetch (returns extracted text)
node bin/gepetto.js fetch "https://example.com"

# Full stealth browser (handles JS + Cloudflare), returns visible text
node bin/gepetto.js browse "https://protected-site.com"

# Through a proxy, with a screenshot
node bin/gepetto.js browse "https://example.com" --proxy "http://user:pass@host:port" --screenshot out.png
```

If installed globally (`npm i -g`), use `gepetto fetch ...` / `gepetto browse ...`.

Set `GEPETTO_EXECUTABLE_PATH` to point at a specific Chrome binary if the bundled
one isn't found (e.g. `/usr/bin/google-chrome-stable`).

## When to use which

1. Try `fetch` first — it's fast and cheap. It prints a `[hint]` to stderr if the
   page looks blocked or JS-rendered.
2. If `fetch` is blocked/empty, use `browse`.

## MCP alternative

For agent integrations, run the MCP server instead (`npm run mcp`) which exposes
`gepetto_fetch` and `gepetto_browse` tools over stdio.
