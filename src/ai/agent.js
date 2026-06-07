// src/ai/agent.js
//
// The agentic loop: give Claude a compact page digest + a goal, let it drive the
// browser via tools (click/type/scroll/navigate), feed back the new digest after
// each action, and finish with structured data. Optimized for low latency
// (Haiku, no thinking, small payloads, bounded steps) and metered for upcharge.
'use strict';

const { buildDigest } = require('./digest');
const { execute } = require('./actions');
const { getClient, newUsage, addUsage, costOf } = require('./client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `You are Gepetto, a web-automation agent controlling a real Chrome browser.
Each turn you receive a COMPACT DIGEST of the current page: url, title, headings, a slice of the main text, and INTERACTIVE ELEMENTS — each with a short "ref" (e.g. e7), a tag/type, and a label or href. You act by calling a tool that references an element by its "ref".

Rules:
- Pursue the user's goal in as few steps as possible.
- To navigate: click the element whose label matches what you want, or call gepetto_navigate with a URL.
- To search or fill a field: call gepetto_type with the field's ref and the text; set submit:true to press Enter.
- After each action you get the UPDATED digest — re-read it before deciding.
- If the items the user asked for are ALREADY present in the digest's elements or text, extract them and call gepetto_finish immediately — do NOT scroll or click unnecessarily.
- Only scroll/click when the needed content is clearly not yet visible.
- When you have what the user asked for, call gepetto_finish with a structured "data" object holding the actual result, plus a short "summary".
- Only use information actually present on the page. Never fabricate.
Be decisive and efficient.`;

function buildTools(finishSchema) {
  const dataSchema = finishSchema || { type: 'object', description: 'The structured result/answer extracted from the page.', additionalProperties: true };
  return [
    {
      name: 'gepetto_navigate',
      description: 'Navigate the browser to a URL.',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
    {
      name: 'gepetto_click',
      description: 'Click an interactive element by its ref (e.g. "e5").',
      input_schema: { type: 'object', properties: { ref: { type: 'string' }, reason: { type: 'string', description: 'why (brief)' } }, required: ['ref'] },
    },
    {
      name: 'gepetto_type',
      description: 'Type text into an input/textarea by its ref. Set submit:true to press Enter after.',
      input_schema: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['ref', 'text'] },
    },
    {
      name: 'gepetto_scroll',
      description: 'Scroll the page to reveal more content.',
      input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } }, required: ['direction'] },
    },
    {
      name: 'gepetto_wait',
      description: 'Wait for dynamic content to load.',
      input_schema: { type: 'object', properties: { ms: { type: 'number' } } },
    },
    {
      name: 'gepetto_finish',
      description: 'Finish the task and return the structured result. Put the actual answer/scraped content in "data".',
      input_schema: { type: 'object', properties: { summary: { type: 'string' }, data: dataSchema }, required: ['summary'] },
    },
  ];
}

/**
 * Run the agent against an already-loaded page.
 *
 * @param {object} page - a gepetto page (has gotoResilient, realClick, etc.)
 * @param {object} options
 *   prompt (string, required) - what the user wants
 *   model (default 'claude-haiku-4-5')
 *   apiKey (else ANTHROPIC_API_KEY)
 *   maxSteps (default 8)
 *   maxTokens (default 4096)
 *   schema - optional JSON schema for the finish `data`
 *   markup (default 1) - billing multiplier applied to cost
 *   onStep(step) - optional progress callback
 *   digestOptions - passed to buildDigest
 * @returns {Promise<{ok, summary, data, steps, usage, cost, finalUrl, model}>}
 */
async function runAgent(page, options = {}) {
  const {
    prompt,
    model = 'claude-haiku-4-5',
    apiKey,
    maxSteps = 8,
    maxTokens = 4096,
    schema = null,
    markup = 1,
    onStep = null,
    digestOptions = {},
    settleMs = 1800,
  } = options;
  if (!prompt) throw new Error('runAgent: `prompt` is required');

  const client = getClient(apiKey);
  const usage = newUsage(model);
  const tools = buildTools(schema);
  const system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];

  // Let JS-rendered content settle before the first read (SPAs like YouTube
  // finish loading results after domcontentloaded).
  await sleep(settleMs);
  const digest = await buildDigest(page, digestOptions);
  const messages = [{
    role: 'user',
    content: `TASK: ${prompt}\n\nCURRENT PAGE DIGEST (JSON):\n${JSON.stringify(digest)}`,
  }];

  const steps = [];
  let finished = false;
  let result = { summary: '', data: null };

  for (let i = 0; i < maxSteps && !finished; i++) {
    let resp;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        tool_choice: { type: 'any' }, // force a tool each turn to keep progress
        messages,
      });
    } catch (e) {
      return finalize({ ok: false, error: 'api_error: ' + e.message });
    }
    addUsage(usage, resp.usage);
    messages.push({ role: 'assistant', content: resp.content });

    const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      // No tool call — treat any text as the summary and stop.
      const txt = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      result = { summary: txt || '(no action taken)', data: null };
      break;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      if (tu.name === 'gepetto_finish') {
        result = { summary: (tu.input && tu.input.summary) || '', data: (tu.input && tu.input.data) != null ? tu.input.data : null };
        steps.push({ action: 'finish', input: tu.input, outcome: 'finished' });
        if (onStep) try { onStep(steps[steps.length - 1]); } catch (e) {}
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'ok' });
        finished = true;
        continue;
      }
      const { outcome } = await execute(page, tu.name, tu.input || {});
      const step = { action: tu.name, input: tu.input, outcome };
      steps.push(step);
      if (onStep) try { onStep(step); } catch (e) {}
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: outcome });
    }

    if (finished) break;

    // Give the model the refreshed page state after the actions (let any
    // navigation / dynamic content settle first).
    await sleep(Math.min(settleMs, 1200));
    const fresh = await buildDigest(page, digestOptions);
    messages.push({
      role: 'user',
      content: [
        ...toolResults,
        { type: 'text', text: `UPDATED PAGE DIGEST (JSON):\n${JSON.stringify(fresh)}` },
      ],
    });
  }

  return finalize({ ok: finished, summary: result.summary, data: result.data });

  async function finalize(extra) {
    let finalUrl = '';
    try { finalUrl = page.url(); } catch (e) {}
    return Object.assign(
      { ok: false, summary: '', data: null, steps, usage, cost: costOf(usage, markup), finalUrl, model },
      extra
    );
  }
}

module.exports = { runAgent, SYSTEM };
