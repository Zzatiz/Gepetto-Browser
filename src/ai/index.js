// src/ai/index.js
//
// OPTIONAL AI plugin for Gepetto-Browser. The core scraper does NOT import this
// module — require it explicitly:  const ai = require('gepetto-browser/ai').
// Requires the optional dependency @anthropic-ai/sdk + an Anthropic API key.
//
// Sell it as a plugin: every run returns `usage` (token counts) and `cost`
// (base + billable, with your `markup` multiplier) for usage-based upcharge.
'use strict';

const { runAgent } = require('./agent');
const { buildDigest } = require('./digest');
const { costOf, PRICING } = require('./client');

/** Attach `page.ai(prompt, opts)` to a page for inline use. */
function attachAI(page) {
  page.ai = (prompt, opts = {}) => runAgent(page, Object.assign({ prompt }, opts));
  page.digest = (opts) => buildDigest(page, opts);
  return page;
}

/**
 * One-call agentic scrape: launch a stealth browser, navigate, run the agent,
 * return the structured result, and close. This is the "API call" surface from
 * the plan — the user passes what they need + which model.
 *
 * @param {object} opts
 *   url (required), prompt (required), model, apiKey, schema, markup, maxSteps,
 *   onStep, proxy, headless (default true), keepOpen (default false), launch (extra init() opts)
 * @returns the runAgent result (+ browser/page if keepOpen)
 */
async function aiScrape(opts = {}) {
  const { url, prompt, headless = true, keepOpen = false, proxy = null, launch = {} } = opts;
  if (!url || !prompt) throw new Error('aiScrape: `url` and `prompt` are required');

  // Lazy-require the core so the AI module stays decoupled from it.
  const { init } = require('../index');
  const { browser, page } = await init(Object.assign({
    headless, disableXvfb: headless, fingerprint: true, turnstile: true, inputDelay: 0, proxy,
  }, launch));

  try {
    const goto = page.gotoResilient ? page.gotoResilient.bind(page) : page.goto.bind(page);
    await goto(url, { timeout: 60000 });
    const result = await runAgent(page, {
      prompt,
      model: opts.model,
      apiKey: opts.apiKey,
      schema: opts.schema,
      markup: opts.markup,
      maxSteps: opts.maxSteps,
      onStep: opts.onStep,
      digestOptions: opts.digestOptions,
    });
    if (keepOpen) return Object.assign(result, { browser, page });
    return result;
  } finally {
    if (!keepOpen) await browser.close().catch(() => {});
  }
}

module.exports = { runAgent, aiScrape, attachAI, buildDigest, costOf, PRICING };
