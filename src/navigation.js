// src/navigation.js
//
// Resilient navigation: retry with exponential backoff, detect blocked / rate-
// limited / challenge responses, honor Retry-After, and wait for Cloudflare-style
// interstitials to clear (the background Turnstile solver handles the clicking).
//
// Exposed on each page as page.gotoResilient(url, opts).
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Text signatures of interstitial / challenge / block pages.
const CHALLENGE_SIGNATURES = [
  /just a moment/i,
  /checking your browser/i,
  /attention required/i,
  /cf-browser-verification/i,
  /verifying you are human/i,
  /needs to review the security of your connection/i,
  /enable javascript and cookies to continue/i,
  /access denied/i,
  /ddos protection by/i,
];

async function looksBlocked(page) {
  try {
    const html = await page.content();
    const title = await page.title();
    return CHALLENGE_SIGNATURES.some((re) => re.test(html) || re.test(title));
  } catch (e) {
    return false;
  }
}

// Poll until the challenge clears (or timeout). Returns true if it cleared.
async function waitForChallengeClear(page, totalMs, stepMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    await sleep(stepMs);
    if (!(await looksBlocked(page))) return true;
  }
  return !(await looksBlocked(page));
}

/**
 * Navigate to a URL with retries, backoff, and challenge handling.
 *
 * @param {object} page - puppeteer page
 * @param {string} url
 * @param {object} [opts]
 *   retries (default 3), backoffMs (default 1500), timeout (default 45000),
 *   waitUntil (default 'domcontentloaded'), challengeWaitMs (default 60000),
 *   onBlocked(attempt, status) callback (optional).
 * @returns the final HTTPResponse (or null).
 */
async function resilientGoto(page, url, opts = {}) {
  const {
    retries = 3,
    backoffMs = 1500,
    timeout = 45000,
    waitUntil = 'domcontentloaded',
    challengeWaitMs = 60000,
    onBlocked = null,
  } = opts;

  let lastResp = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await page.goto(url, { timeout, waitUntil });
      lastResp = resp;
      const status = resp ? resp.status() : 0;

      // Hard rate-limit / unavailable: honor Retry-After, else exponential backoff.
      if (status === 429 || status === 503) {
        if (onBlocked) { try { onBlocked(attempt, status); } catch (e) {} }
        if (attempt < retries) {
          const ra = resp.headers()['retry-after'];
          const raMs = ra ? parseInt(ra, 10) * 1000 : 0;
          await sleep(raMs > 0 ? raMs : backoffMs * Math.pow(2, attempt));
          continue;
        }
        return resp;
      }

      // Soft block / interstitial detected in the body: wait for it to clear.
      if (await looksBlocked(page)) {
        if (onBlocked) { try { onBlocked(attempt, status || 'challenge'); } catch (e) {} }
        const cleared = await waitForChallengeClear(page, challengeWaitMs);
        if (cleared) return resp;
        if (attempt < retries) {
          await sleep(backoffMs * Math.pow(2, attempt));
          continue;
        }
      }

      return resp;
    } catch (err) {
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  return lastResp;
}

function attachNavigation(page) {
  page.gotoResilient = (url, opts) => resilientGoto(page, url, opts);
  page.looksBlocked = () => looksBlocked(page);
}

module.exports = { resilientGoto, looksBlocked, waitForChallengeClear, attachNavigation };
