// src/stealth/index.js
//
// Orchestrates the stealth layer for a page:
//   1. Resolves the `fingerprint` option into a coherent profile.
//   2. Injects JS-level evasions (evaluateOnNewDocument) into every document.
//   3. Sets a matching User-Agent + Client Hints via CDP so the HTTP-layer
//      identity agrees with the JS-layer identity (a mismatch is itself a tell).
'use strict';

const { generateFingerprint } = require('./fingerprint');
const { applyEvasions } = require('./evasions');

/**
 * Turn the user's `fingerprint` option into a profile object (or null).
 * Accepts: true (random), a number/string seed, or a ready-made profile object.
 */
function resolveFingerprint(option, chromeMajor) {
  if (!option) return null;
  if (option === true) return generateFingerprint(true, chromeMajor);
  if (typeof option === 'object') return option;
  return generateFingerprint(option, chromeMajor); // number or string seed
}

async function getChromeMajor(browser) {
  try {
    const v = await browser.version(); // e.g. "Chrome/142.0.7444.162"
    const m = v.match(/\/(\d+)\./);
    if (m) return parseInt(m[1], 10);
  } catch (e) {}
  return undefined;
}

/**
 * Apply the full stealth layer to a page.
 * @returns the resolved profile (or null when fingerprinting is disabled).
 */
async function applyStealth(page, browser, options = {}) {
  const { fingerprint, userAgent } = options;
  const chromeMajor = await getChromeMajor(browser);
  const profile = resolveFingerprint(fingerprint, chromeMajor);
  if (!profile) return null;

  // 1. JS-level evasions for every current and future document.
  await page.evaluateOnNewDocument(applyEvasions, profile);

  // 2. Coherent UA + Client Hints. A user-supplied non-"random" UA wins, but we
  //    still align Client Hints so the two don't contradict each other.
  const ua = (userAgent && userAgent !== 'random') ? userAgent : profile.userAgent;
  const ch = profile.clientHints;
  const metadata = {
    brands: ch.brands,
    fullVersionList: ch.fullVersionList,
    fullVersion: ch.fullVersion,
    platform: ch.platform,
    platformVersion: ch.platformVersion,
    architecture: ch.architecture,
    bitness: ch.bitness,
    model: ch.model,
    mobile: ch.mobile,
    wow64: false,
  };

  // Primary path: puppeteer's setUserAgent(ua, metadata) issues the override on
  // the page's own session, which is what populates navigator.userAgentData.
  try {
    await page.setUserAgent(ua, metadata);
  } catch (e) {
    // Fallback: raw CDP on the page session, then UA-only as a last resort.
    try {
      const client = await page.createCDPSession();
      await client.send('Network.setUserAgentOverride', {
        userAgent: ua,
        acceptLanguage: profile.languages.join(','),
        platform: profile.platform,
        userAgentMetadata: metadata,
      });
    } catch (e2) {
      try { await page.setUserAgent(ua); } catch (e3) {}
    }
  }

  return profile;
}

/**
 * Launch flags that harden stealth at the browser level. Merged into the
 * Chrome args before launch.
 */
function stealthLaunchFlags() {
  return [
    '--disable-blink-features=AutomationControlled',
    '--force-webrtc-ip-handling-policy=default_public_interface_only',
  ];
}

module.exports = { applyStealth, resolveFingerprint, generateFingerprint, stealthLaunchFlags };
