// src/connect.js
const puppeteer = require('puppeteer');
const Xvfb = require('xvfb');
const { pageController } = require('./pageController');

async function connect(options) {
  const {
    args = [],
    headless = false,
    customConfig = {},
    proxy = {},
    turnstile = false,
    disableXvfb = false,
    plugins = [],
    ignoreAllFlags = false,
    fingerprint = false,
    autoLaunch = true,
    executablePath = null  // <-- NEW OPTION
  } = options;

  let xvfbSession = null;
  // On Linux, start xvfb if not disabled.
  if (process.platform === 'linux' && !disableXvfb) {
    try {
      xvfbSession = new Xvfb({
        silent: true,
        xvfb_args: ['-screen', '0', '1920x1080x24', '-ac']
      });
      xvfbSession.startSync();
    } catch (err) {
      console.log('You are running on Linux but xvfb could not be started:', err.message);
    }
  }

  // Build launch options for puppeteer.
  const launchOptions = Object.assign({}, customConfig, {
    headless: headless,
    args: args.concat(
      proxy.host && proxy.port
        ? [`--proxy-server=${proxy.type}://${proxy.host}:${proxy.port}`]
        : []
    ),
    executablePath  // <-- NEW OPTION FORWARDING
  });

  let browser;
  if (autoLaunch) {
    browser = await puppeteer.launch(launchOptions);
  } else {
    throw new Error('Non-autoLaunch mode is not implemented. Set autoLaunch to true.');
  }

  let pages = await browser.pages();
  let page = pages.length > 0 ? pages[0] : await browser.newPage();

  // Run the pageController to patch the page (e.g. ghost-cursor, turnstile, and input simulation).
  page = await pageController({
    browser,
    page,
    proxy,
    turnstile,
    xvfbSession,
    plugins
  });

  return { browser, page };
}

module.exports = { connect };
