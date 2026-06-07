// src/ai/actions.js
//
// Executes the agent's chosen actions against the live page, using natural
// (ghost-cursor) mouse movement where possible. Each returns a short outcome
// string that is fed back to the model.
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function refSelector(ref) {
  return `[data-gp-ref="${String(ref).replace(/"/g, '')}"]`;
}

async function ensureInView(page, selector) {
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
    }, selector);
    await sleep(150);
  } catch (e) {}
}

// Natural click: prefer ghost-cursor (page.realClick), fall back to page.click.
async function naturalClick(page, selector) {
  await ensureInView(page, selector);
  if (typeof page.realClick === 'function') {
    try { await page.realClick(selector); return; } catch (e) {}
  }
  await page.click(selector);
}

async function doClick(page, input) {
  const sel = refSelector(input.ref);
  const exists = await page.$(sel);
  if (!exists) return `error: no element with ref ${input.ref}`;
  try {
    await Promise.race([
      naturalClick(page, sel),
      sleep(8000).then(() => { throw new Error('click timeout'); }),
    ]);
    return `clicked ${input.ref}`;
  } catch (e) {
    return `error clicking ${input.ref}: ${e.message}`;
  }
}

async function doType(page, input) {
  const sel = refSelector(input.ref);
  const exists = await page.$(sel);
  if (!exists) return `error: no element with ref ${input.ref}`;
  try {
    await naturalClick(page, sel);
    // Clear existing value first.
    await page.evaluate((s) => { const el = document.querySelector(s); if (el && 'value' in el) el.value = ''; }, sel);
    await page.type(sel, String(input.text || ''), { delay: 35 });
    if (input.submit) {
      await sleep(120);
      await page.keyboard.press('Enter');
    }
    return `typed into ${input.ref}${input.submit ? ' and submitted' : ''}`;
  } catch (e) {
    return `error typing into ${input.ref}: ${e.message}`;
  }
}

async function doScroll(page, input) {
  const dir = (input.direction || 'down').toLowerCase();
  // The model often passes a small "number of steps" rather than pixels; treat
  // anything under 100 as "one screen" so scrolls are actually effective.
  const amount = (typeof input.amount === 'number' && input.amount >= 100)
    ? Math.min(5000, input.amount)
    : 800;
  const dy = dir === 'up' ? -amount : amount;
  try {
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'instant' in window ? 'instant' : 'auto' }), dy);
    await sleep(400);
    return `scrolled ${dir} ${amount}px`;
  } catch (e) {
    return `error scrolling: ${e.message}`;
  }
}

async function doNavigate(page, input) {
  try {
    const goto = page.gotoResilient ? page.gotoResilient.bind(page) : page.goto.bind(page);
    await goto(input.url, { timeout: 45000 });
    return `navigated to ${input.url}`;
  } catch (e) {
    return `error navigating to ${input.url}: ${e.message}`;
  }
}

async function doWait(page, input) {
  const ms = Math.max(100, Math.min(15000, input.ms || 1500));
  await sleep(ms);
  return `waited ${ms}ms`;
}

// Dispatch a tool call by name. Returns { outcome, finished?, result? }.
async function execute(page, name, input) {
  switch (name) {
    case 'gepetto_click': return { outcome: await doClick(page, input) };
    case 'gepetto_type': return { outcome: await doType(page, input) };
    case 'gepetto_scroll': return { outcome: await doScroll(page, input) };
    case 'gepetto_navigate': return { outcome: await doNavigate(page, input) };
    case 'gepetto_wait': return { outcome: await doWait(page, input) };
    case 'gepetto_finish': return { outcome: 'finished', finished: true, result: input };
    default: return { outcome: `unknown action: ${name}` };
  }
}

module.exports = { execute, refSelector };
