// src/index.js
const connect = require('./connect').connect;
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
  const configPath = path.join(__dirname, '../2captcha-solver/common/config.js');
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
function mergeArgs(userArgs, configFlags, screenSize) {
  if (configFlags && Array.isArray(configFlags) && configFlags.length > 0) {
    return configFlags;
  }
  const width = (screenSize && screenSize.width) || 1280;
  const height = (screenSize && screenSize.height) || 720;
  const defaultArgs = [
    `--window-size=${width},${height}`,
    '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,PrivacySandboxSettings4,AutomationControlled'
  ];
  return defaultArgs.concat(userArgs || []);
}

/**
 * Loads proxies from a proxies.txt file in the project root.
 * Expected format per line: protocol:host:port:username:password
 */
function loadProxiesFromFile() {
  const proxiesFilePath = path.join(process.cwd(), 'proxies.txt');
  try {
    const data = fs.readFileSync(proxiesFilePath, 'utf-8');
    return data.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const parts = line.split(':').map(p => p.trim());
        return {
          type: parts[0] || 'http',
          host: parts[1],
          port: parts[2],
          username: parts[3],
          password: parts[4]
        };
      });
  } catch (error) {
    console.error('[Proxies] Failed to load proxies:', error);
    return [];
  }
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
 *   - proxy: (Object) Proxy config. If omitted, proxies are loaded from file.
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
 */
async function init(options = {}) {
  const {
    headless = false,
    args = [],
    configFlags,
    screenSize = { width: 1280, height: 720 },
    proxy = null,
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
    executablePath = isDebianBased() ? '/usr/bin/google-chrome-stable' : null  // <-- NEW DEFAULT VALUE
  } = options;


  // Merge default launch arguments.
  let finalArgs = mergeArgs(args, configFlags, screenSize);

  // If captcha is enabled, prompt for 2Captcha API key and update the extension config.
  if (captcha) {
    const apiKey = await promptApiKey();
    await updateExtensionConfig(apiKey);
    // Add extension load flags pointing to the local extension folder (./extensionname)
    const extPath = path.join(process.cwd(), 'extensionname');
    finalArgs.push(`--disable-extensions-except=${extPath}`);
    finalArgs.push(`--load-extension=${extPath}`);
  }

  // If no proxy config is provided, try loading proxies from file.
  let finalProxy = proxy;
  if (!finalProxy) {
    const proxies = loadProxiesFromFile();
    if (proxies.length > 0) {
      // For simplicity, we use the first proxy (rotation can be implemented as needed)
      finalProxy = proxies[0];
    }
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
    executablePath
  };

  // Connect and launch the browser.
  const { browser, page } = await connect(connectOptions);

  // Set viewport to desired screen size.
  await page.setViewport({ width: screenSize.width, height: screenSize.height });

  // Set custom user agent if provided.
  if (userAgent) {
    let ua = userAgent;
    if (ua === "random") {
      ua = getRandomUserAgent();
    }
    await page.setUserAgent(ua);
  }

  // Attach the input delay to the page (used for simulating human-like mouse hovering before click/type).
  page.inputDelay = inputDelay;

  // If captcha solving is enabled, patch page.goto to visit the extension options page first.
  if (captcha) {
    const originalGoto = page.goto.bind(page);
    page.goto = async function (url, gotoOptions = {}) {
      try {
        const extPage = await browser.newPage();
        await extPage.goto('about:blank', { waitUntil: 'domcontentloaded' });
        // OPTIONAL: You can add interactions here if needed.
        await extPage.close();
        console.log(`[Captcha] Processed 2Captcha extension with updated API key.`);
      } catch (err) {
        console.error('[Captcha] Failed to process extension options:', err.message);
      }
      return await originalGoto(url, gotoOptions);
    };
  }

  return { browser, page };
}

module.exports = { init };
