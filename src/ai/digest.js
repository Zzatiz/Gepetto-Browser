// src/ai/digest.js
//
// Efficient page digest for the AI layer. Instead of dumping the whole DOM /
// document.body.innerText (slow, token-heavy, and mostly noise), this extracts
// only what an LLM needs to UNDERSTAND the page and decide what to do next:
// title, meta, headings, a bounded slice of the main content, and the
// interactive elements (links/buttons/inputs) each tagged with a short stable
// `ref` the agent uses to act on them.
'use strict';

// Runs in the page context. Must be self-contained.
function digestInPage(opts) {
  const o = opts || {};
  const MAX_INTERACTIVE = o.maxInteractive || 80;
  const MAX_HEADINGS = o.maxHeadings || 20;
  const MAX_TEXT = o.maxText || 1600;
  const MAX_LABEL = 90;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
      return true;
    } catch (e) { return false; }
  };

  // Title + meta.
  const out = { url: location.href, title: document.title || '' };
  const md = document.querySelector('meta[name="description"]');
  if (md) out.description = clean(md.getAttribute('content')).slice(0, 300);

  // Headings.
  out.headings = [];
  document.querySelectorAll('h1, h2, h3').forEach((h) => {
    if (out.headings.length >= MAX_HEADINGS) return;
    const t = clean(h.innerText);
    if (t) out.headings.push({ tag: h.tagName.toLowerCase(), text: t.slice(0, MAX_LABEL) });
  });

  // Main content slice (prefer a landmark, fall back to body) — bounded.
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  out.text = clean(main ? main.innerText : '').slice(0, MAX_TEXT);

  // Interactive elements, each tagged with a stable ref.
  out.elements = [];
  let n = 0;
  const seen = new Set();
  const SEL = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [onclick]';
  const nodes = document.querySelectorAll(SEL);
  for (const el of nodes) {
    if (out.elements.length >= MAX_INTERACTIVE) break;
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || (tag === 'a' ? 'link' : tag);
    let text = clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '');
    text = text.slice(0, MAX_LABEL);
    let href = '';
    if (tag === 'a' && el.getAttribute('href')) {
      try { const u = new URL(el.href); href = (u.pathname + u.search).slice(0, 120); } catch (e) {}
    }
    // Dedup near-identical entries to save tokens.
    const key = tag + '|' + type + '|' + text + '|' + href;
    if (seen.has(key)) continue;
    if (!text && !href && tag !== 'input' && tag !== 'textarea') continue;
    seen.add(key);
    const ref = 'e' + (++n);
    el.setAttribute('data-gp-ref', ref);
    const item = { ref, tag, type };
    if (text) item.text = text;
    if (href) item.href = href;
    const name = el.getAttribute('name'); if (name) item.name = name;
    const ph = el.getAttribute('placeholder'); if (ph) item.placeholder = clean(ph).slice(0, MAX_LABEL);
    out.elements.push(item);
  }
  out.scroll = { y: Math.round(window.scrollY), maxY: Math.round(document.body.scrollHeight - window.innerHeight) };
  return out;
}

/**
 * Build a compact digest of the current page. Waits briefly for the page to be
 * settled, then extracts via digestInPage.
 */
async function buildDigest(page, opts = {}) {
  try {
    return await page.evaluate(digestInPage, opts);
  } catch (e) {
    return { url: (await page.url().catch(() => '')), title: '', error: 'digest_failed: ' + e.message, headings: [], elements: [], text: '' };
  }
}

module.exports = { buildDigest, digestInPage };
