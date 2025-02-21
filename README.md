# Gepetto-Browser
captcha + cf solving, human replicating, http proxy-able, puppeteer fork inspired by puppeteer-real-browser

```markdown
## Quick Start

You can get started with gepetto-browser using just one command:

```js
const { init } = require('gepetto-browser');

(async () => {
  const { browser, page } = await init({
    headless: false,
    captcha: true,
    autoLaunch: true,
    userAgent: "random",
    inputDelay: 2.0
  });

  await page.goto('https://example.com');
  await page.waitForTimeout(5000); // Wait 5 seconds
  await browser.close();
})();
```

This simple setup:
- Launches Chrome in non-headless mode.
- Solves CAPTCHAs automatically using the 2Captcha extension.
- Randomizes the user agent.
- Simulates human-like mouse movements before each click/type action.

## Features

- **One-Line Initialization:** Instantly launch a browser with customizable settings in a single call.
- **Automatic CAPTCHA Solving:** Supports 2Captcha out of the box. Prompts for the 2Captcha API key and automatically configures the extension.
- **Human-like Input Simulation:** Simulates mouse movements across random points before clicks/types, with an adjustable delay to mimic natural interactions.
- **Proxy Rotation & Support:** Supports all proxy types (http, https, socks4, socks5) and automatically rotates proxies from a proxies.txt file in the project root.
- **Custom User Agent:** Easily set a custom user agent. Use "random" to select one from Agents.txt.
- **Fingerprint Protection:** Toggle fingerprint protection to help evade bot detection.
- **Turnstile CAPTCHA Support:** Automatically solves Cloudflare Turnstile CAPTCHAs.
- **Executable Path Control:** Allows specifying a custom Chrome executable path. Defaults to `/usr/bin/google-chrome-stable` on Debian-based systems.
- **Xvfb Support for Linux:** Automatically sets up xvfb for headless display on Linux.

## Installation

To install the package, run:

```sh
npm install gepetto-browser
```

The installation process will automatically install all required npm dependencies and, on Debian-based Linux systems, the necessary system-level packages.

## Options

```js
await init({
  headless: false,               // Launch in headless or visible mode
  args: ['--custom-flag=example'],// Extra Chrome flags (appended to defaults if configFlags is not set)
  configFlags: ['--window-size=1280,720', '--no-sandbox'], // Override default Chrome flags completely
  screenSize: { width: 1280, height: 720 }, // Custom viewport dimensions
  proxy: {                       // Proxy settings (rotates automatically from proxies.txt if not set)
    type: 'http', 
    host: '127.0.0.1', 
    port: '8080', 
    username: 'user', 
    password: 'pass'
  },
  captcha: true,                 // Enable 2Captcha solving (prompts for API key)
  turnstile: true,               // Enable Cloudflare Turnstile solving
  customConfig: {},              // Additional Puppeteer launch options
  disableXvfb: false,            // Disable xvfb on Linux
  plugins: [],                   // Array of puppeteer-extra plugins
  ignoreAllFlags: false,         // Whether to ignore default Chrome flags
  fingerprint: true,             // Enable fingerprint protection
  autoLaunch: true,              // Automatically launch the browser on connect
  userAgent: "random",           // Custom user agent; "random" selects one from Agents.txt
  inputDelay: 2.0,               // Total delay (in seconds) to simulate human-like mouse hovering before actions
  executablePath: '/usr/bin/google-chrome-stable' // Path to Chrome binary (default on Debian-based systems)
});
```

## Example

```js
const { init } = require('gepetto-browser');

(async () => {
  const { browser, page } = await init({
    headless: false,
    args: ['--disable-web-security'],
    configFlags: ['--window-size=1280,720', '--no-sandbox'],
    screenSize: { width: 1280, height: 720 },
    proxy: { 
      type: 'http', 
      host: '127.0.0.1', 
      port: '8080', 
      username: 'user', 
      password: 'pass'
    },
    captcha: true,
    turnstile: true,
    customConfig: {},
    disableXvfb: false,
    plugins: [],
    ignoreAllFlags: false,
    fingerprint: true,
    autoLaunch: true,
    userAgent: "random",
    inputDelay: 2.0,
    executablePath: '/usr/bin/google-chrome-stable'
  });

  await page.goto('https://example.com');
  await page.waitForTimeout(5000);
  await browser.close();
})();
```
