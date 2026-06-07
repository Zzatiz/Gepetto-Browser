// src/index.js
const connect = require('./connect').connect;
const { applyStealth, stealthLaunchFlags } = require('./stealth');
const {
  normalizeProxy, loadProxies, selectProxy,
  resolveExitGeo, applyGeoCoherence, attachProxyAuth,
} = require('./proxy');
const { loadCookies } = require('./session');
const { enableResourceBlocking } = require('./blocker');
const { httpGet, tieredFetch, needsBrowser } = require('./fetcher');
const { generateFingerprint } = require('./stealth');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { executablePath } = require('puppeteer');
const readline = require('readline');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Check if the platform is Linux and Debian-based.
 */
const isDebianBased = () => {
  if (os.platform() !== 'linux') return false;
  try {
    const result = execSync('cat /etc/os-release').toString();
    return result.includes('debian') || result.includes('ubuntu');
  } catch (err) {
    return false;
  }
};

/**
 * Prompts the user to input the 2Captcha API key.
 */
function promptApiKey() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Please enter your 2Captcha API key: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts the user for the 2Captcha extension URL.
 * (No longer used since we now ask for the API key.)
 */
function promptExtensionUrl() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Please paste the extension URL for captcha settings: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}


async function updateExtensionConfig(apiKey) {
  // Navigate up to the project root and then into 2captcha-solver/common/config.js
  const configPath = path.join(__dirname, './2captcha-solver/common/config.js');
  try {
    let configData = await fsPromises.readFile(configPath, 'utf-8');
    // Replace a placeholder like: apiKey: "" or apiKey: '...'
    configData = configData.replace(/apiKey:\s*["'][^"']*["']/, `apiKey: "${apiKey}"`);
    await fsPromises.writeFile(configPath, configData, 'utf-8');
    console.log('[2Captcha Extension] Updated API key in extension config.');
  } catch (err) {
    console.error('[2Captcha Extension] Failed to update config:', err.message);
  }
}

/**
 * Merges launch arguments.
 * If configFlags is provided, it replaces all default flags.
 * Otherwise, default flags (including window size) are merged with any userArgs.
 */
function mergeArgs(userArgs, configFlags, screenSize, ignoreAllFlags) {
  // configFlags completely replaces the default flag set when provided.
  if (configFlags && Array.isArray(configFlags) && configFlags.length > 0) {
    return configFlags;
  }
  // ignoreAllFlags: launch with only the user-supplied flags, no defaults.
  if (ignoreAllFlags) {
    return Array.isArray(userArgs) ? userArgs : [];
  }
  const width = (screenSize && screenSize.width) || 1280;
  const height = (screenSize && screenSize.height) || 720;
  const defaultArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${width},${height}`,
    '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,AutomationControlled'
  ];
  return defaultArgs.concat(userArgs || []);
}

/**
 * Reads Agents.txt (one agent per line) and returns a random user agent.
 */
function getRandomUserAgent() {
  const agentsPath = path.join(process.cwd(), 'Agents.txt');
  try {
    const data = fs.readFileSync(agentsPath, 'utf-8');
    const agents = data.split('\n').map(a => a.trim()).filter(a => a);
    if (agents.length === 0) return '';
    const idx = Math.floor(Math.random() * agents.length);
    return agents[idx];
  } catch (error) {
    console.error('[UserAgent] Failed to load Agents.txt:', error);
    return '';
  }
}

/**
 * Main initialization function.
 *
 * Options:
 *   - headless: (boolean) Launch headless (default: false)
 *   - args: (Array) Additional chrome launch flags.
 *   - configFlags: (Array) If provided, replaces all default flags.
 *   - screenSize: (Object) { width, height } (default: { width: 1280, height: 720 }).
 *   - proxy: (Object|string) Explicit proxy. If omitted, one is selected from `proxies` or proxies.txt.
 *   - proxies: (Array) Explicit list of proxies (objects or strings) to rotate through.
 *   - proxyRotation: ('first'|'random'|'roundrobin') Selection strategy (default: 'roundrobin').
 *   - geoip: (boolean) Align the page timezone with the proxy's exit-IP geography (default: false).
 *   - captcha: (boolean) Toggle captcha solving (default: false).
 *   - turnstile: (boolean) Toggle turnstile solving (default: false).
 *   - customConfig: (Object) Additional config for puppeteer.launch.
 *   - disableXvfb: (boolean) Disable xvfb on Linux (default: false).
 *   - plugins: (Array) Plugins for puppeteer-extra.
 *   - ignoreAllFlags: (boolean) Whether to ignore default chrome flags.
 *   - fingerprint: (boolean) Toggle fingerprint protection.
 *   - autoLaunch: (boolean) If true, automatically launch the browser (default: true).
 *   - userAgent: (string) Custom user agent. If set to "random", one is chosen from Agents.txt.
 *   - inputDelay: (number) A float (in seconds) that determines how long to simulate mouse hovering before click/type.
 *   - userDataDir: (string) Persist the browser profile (cookies, localStorage, cache) across runs.
 *   - cookiesFile: (string) JSON file to restore cookies from on launch; page.saveCookies() writes back to it.
 *   - blockResources: (boolean|Array) Block heavy resources. true => ['image','media','font'], or pass your own list.
 *   - blockAds: (boolean) Block known ad/tracker domains (default: false).
 *   - adDomains: (Array) Extra ad/tracker domains to block.
 *
 * The returned page is augmented with:
 *   - page.gotoResilient(url, opts) — navigate with retries/backoff + challenge handling.
 *   - page.findAdaptive(selector, opts) — self-healing selector that relocates moved elements.
 *   - page.saveCookies(file) / page.loadCookies(file) — cookie session persistence.
 *   - page.fingerprint — the active fingerprint profile (or null).
 *   - page.proxy / page.proxyGeo — the selected proxy and resolved exit geography.
 */
async function init(options = {}) {
  const {
    headless = false,
    args = [],
    configFlags,
    screenSize = { width: 1280, height: 720 },
    proxy = null,
    proxies = null,
    proxyRotation = 'roundrobin',
    geoip = false,
    captcha = false,
    turnstile = false,
    customConfig = {},
    disableXvfb = false,
    plugins = [],
    ignoreAllFlags = false,
    fingerprint = false,
    autoLaunch = true,
    userAgent,
    inputDelay = 0,
    userDataDir = null,
    cookiesFile = null,
    blockResources = false,
    blockAds = false,
    adDomains = [],
    executablePath = isDebianBased() ? '/usr/bin/google-chrome-stable' : null  // <-- NEW DEFAULT VALUE
  } = options;


  // Merge default launch arguments.
  let finalArgs = mergeArgs(args, configFlags, screenSize, ignoreAllFlags);

  // When fingerprinting is enabled, add browser-level stealth flags (WebRTC
  // leak policy etc.) that aren't already in the default set.
  if (fingerprint) {
    for (const flag of stealthLaunchFlags()) {
      if (!finalArgs.some(a => a.split('=')[0] === flag.split('=')[0])) {
        finalArgs.push(flag);
      }
    }
  }

  // If captcha is enabled, prompt for 2Captcha API key and update the extension config.
  if (captcha) {
    const apiKey = await promptApiKey();
    await updateExtensionConfig(apiKey);
    // Add extension load flags pointing to the bundled 2Captcha extension folder.
    const extPath = path.join(__dirname, '2captcha-solver');
    finalArgs.push(`--disable-extensions-except=${extPath}`);
    finalArgs.push(`--load-extension=${extPath}`);
  }

  // Resolve the proxy: an explicit `proxy` wins; otherwise select from the
  // `proxies` array (if given) or proxies.txt using the rotation strategy.
  let finalProxy = proxy ? normalizeProxy(proxy) : null;
  if (!finalProxy) {
    const list = (Array.isArray(proxies) && proxies.length)
      ? proxies.map(normalizeProxy).filter(Boolean)
      : loadProxies(path.join(process.cwd(), 'proxies.txt'));
    finalProxy = selectProxy(list, proxyRotation);
  }

  // Prepare options for connect().
  const connectOptions = {
    args: finalArgs,
    headless,
    customConfig,
    proxy: finalProxy || {},
    turnstile,
    disableXvfb,
    plugins,
    ignoreAllFlags,
    fingerprint,
    autoLaunch,
    executablePath,
    userDataDir
  };

  // Connect and launch the browser.
  const { browser, page } = await connect(connectOptions);

  // Authenticate every page/popup the browser opens (not just the first one).
  if (finalProxy) attachProxyAuth(browser, finalProxy);

  // Set viewport to desired screen size.
  await page.setViewport({ width: screenSize.width, height: screenSize.height });

  // Apply the stealth layer (fingerprint spoofing + coherent UA/Client Hints).
  // Returns the resolved profile, or null when fingerprinting is disabled.
  const fpProfile = await applyStealth(page, browser, { fingerprint, userAgent });

  // Legacy user-agent handling only when fingerprinting is OFF — applyStealth
  // already sets a coherent UA (and matching Client Hints) when a profile exists.
  if (!fpProfile && userAgent) {
    let ua = userAgent === 'random' ? getRandomUserAgent() : userAgent;
    if (ua) await page.setUserAgent(ua);
  } else if (fpProfile && userAgent === 'random') {
    console.warn('[Gepetto] userAgent:"random" ignored — fingerprint is enabled; using the coherent profile UA instead.');
  }

  // Expose the active fingerprint profile for inspection/debugging.
  page.fingerprint = fpProfile;
  page.proxy = finalProxy || null;

  // GeoIP coherence: align the page timezone with the proxy's exit-IP country so
  // the spoofed identity and the network origin don't contradict each other.
  if (geoip && finalProxy && finalProxy.host) {
    const geo = await resolveExitGeo(finalProxy);
    if (geo) {
      await applyGeoCoherence(page, geo);
      page.proxyGeo = geo;
      console.log(`[Proxy] Exit IP ${geo.ip} (${geo.countryCode}); timezone set to ${geo.timezone}`);
    }
  }

  // Resource / ad blocking (opt-in): speeds up loads and lowers bot signal.
  if (blockResources || blockAds) {
    try {
      await enableResourceBlocking(page, { blockTypes: blockResources, blockAds, adDomains });
    } catch (e) {
      console.error('[Blocker] Failed to enable resource blocking:', e.message);
    }
  }

  // Restore a previously saved cookie session, if requested.
  if (cookiesFile) {
    const n = await loadCookies(page, cookiesFile);
    if (n > 0) console.log(`[Session] Restored ${n} cookies from ${cookiesFile}`);
    // Convenience: page.saveCookies() with no arg writes back to the same file.
    const _save = page.saveCookies.bind(page);
    page.saveCookies = (file) => _save(file || cookiesFile);
  }

  // Attach the input delay to the page (used for simulating human-like mouse hovering before click/type).
  page.inputDelay = inputDelay;

  // The 2Captcha extension auto-detects and solves captchas via its own content
  // scripts once the API key is configured — no page.goto patching is required.

  return { browser, page };
}

module.exports = {
  init,
  // HTTP-first tiered fetching (no browser required for static targets).
  httpGet,
  tieredFetch,
  needsBrowser,
  // Fingerprint utilities.
  generateFingerprint,
};
