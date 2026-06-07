// src/ai/client.js
//
// Thin wrapper around the OPTIONAL @anthropic-ai/sdk. The SDK is lazy-required
// so the core scraper never depends on it — the AI layer is a sellable plugin.
// Also handles token accounting (for usage-based upcharge) and pricing.
'use strict';

// Per-million-token pricing (USD). Source: Claude API model table.
const PRICING = {
  'claude-haiku-4-5':  { input: 1.0,  output: 5.0,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-opus-4-8':   { input: 5.0,  output: 25.0, cacheRead: 0.5,  cacheWrite: 6.25 },
};

function getClient(apiKey) {
  let SDK;
  try {
    SDK = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error(
      'The Gepetto AI layer requires the optional dependency "@anthropic-ai/sdk".\n' +
      'Install it to enable the AI plugin:  npm install @anthropic-ai/sdk'
    );
  }
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('No Anthropic API key. Pass { apiKey } or set ANTHROPIC_API_KEY.');
  }
  const Anthropic = SDK.default || SDK;
  return new Anthropic({ apiKey: key });
}

// Fresh, zeroed usage accumulator.
function newUsage(model) {
  return {
    model,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    get totalTokens() { return this.inputTokens + this.outputTokens + this.cacheReadTokens + this.cacheCreationTokens; },
  };
}

function addUsage(acc, u) {
  if (!u) return;
  acc.calls += 1;
  acc.inputTokens += u.input_tokens || 0;
  acc.outputTokens += u.output_tokens || 0;
  acc.cacheReadTokens += u.cache_read_input_tokens || 0;
  acc.cacheCreationTokens += u.cache_creation_input_tokens || 0;
}

// Compute base cost; `markup` (e.g. 2.0) is your upcharge multiplier for billing.
function costOf(usage, markup = 1) {
  const p = PRICING[usage.model] || PRICING['claude-haiku-4-5'];
  const base =
    (usage.inputTokens / 1e6) * p.input +
    (usage.outputTokens / 1e6) * p.output +
    (usage.cacheReadTokens / 1e6) * p.cacheRead +
    (usage.cacheCreationTokens / 1e6) * p.cacheWrite;
  return {
    baseUsd: +base.toFixed(6),
    billableUsd: +(base * markup).toFixed(6),
    markup,
  };
}

module.exports = { getClient, newUsage, addUsage, costOf, PRICING };
