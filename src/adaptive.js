// src/adaptive.js
//
// Self-healing selectors (inspired by Scrapling's AutoMatch). When you select an
// element, its "signature" (tag, id, classes, key attributes, normalized text,
// structural path) is saved to a JSON store keyed by domain+selector. If the site
// later changes its markup and the original selector stops matching, findAdaptive
// re-scans the DOM and returns the element most similar to the saved signature —
// no AI, just DOM similarity scoring.
//
// Exposed on each page as page.findAdaptive(selector, opts).
'use strict';

const fs = require('fs');
const path = require('path');

function hostnameOf(url) {
  try { return new URL(url).hostname || 'unknown'; } catch (e) { return 'unknown'; }
}

function readStore(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return {}; }
}
function writeStore(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
}

// --- in-page: compute an element's signature -------------------------------
/* istanbul ignore next */
function computeSignature(el) {
  const KEEP = ['id', 'name', 'type', 'role', 'href', 'placeholder', 'aria-label', 'title', 'alt'];
  const attrs = {};
  for (const a of Array.from(el.attributes || [])) {
    if (KEEP.includes(a.name) || a.name.startsWith('data-')) attrs[a.name] = a.value;
  }
  const pathParts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && pathParts.length < 6) {
    let seg = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
    }
    pathParts.unshift(seg);
    cur = parent;
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: Array.from(el.classList || []),
    attrs,
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    path: pathParts.join(' > '),
  };
}

// --- in-page: find the best match for a saved signature --------------------
/* istanbul ignore next */
function findBestMatch(saved, threshold) {
  function tokens(s) { return (s || '').toLowerCase().split(/\s+/).filter(Boolean); }
  function jaccard(a, b) {
    const A = new Set(a), B = new Set(b);
    if (A.size === 0 && B.size === 0) return 1;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    const uni = new Set([...a, ...b]).size || 1;
    return inter / uni;
  }
  function sig(el) {
    const KEEP = ['id', 'name', 'type', 'role', 'href', 'placeholder', 'aria-label', 'title', 'alt'];
    const attrs = {};
    for (const a of Array.from(el.attributes || [])) {
      if (KEEP.includes(a.name) || a.name.startsWith('data-')) attrs[a.name] = a.value;
    }
    const pathParts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && pathParts.length < 6) {
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      pathParts.unshift(seg);
      cur = parent;
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList || []),
      attrs,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      path: pathParts.join(' > '),
    };
  }
  function score(a, b) {
    let s = 0, w = 0;
    w += 1; if (a.tag === b.tag) s += 1;
    if (b.id) { w += 3; if (a.id === b.id) s += 3; }
    if (b.classes.length) { w += 2; s += 2 * jaccard(a.classes, b.classes); }
    const bk = Object.keys(b.attrs);
    if (bk.length) { w += 2; let m = 0; for (const k of bk) if (a.attrs[k] === b.attrs[k]) m++; s += 2 * (m / bk.length); }
    if (b.text) { w += 2; s += 2 * jaccard(tokens(a.text), tokens(b.text)); }
    if (b.path) {
      w += 2;
      s += 2 * jaccard(a.path.split(' > '), b.path.split(' > '));
    }
    return w ? s / w : 0;
  }

  // Prefer scanning same-tag candidates for performance; fall back to all.
  let candidates = Array.from(document.getElementsByTagName(saved.tag || '*'));
  if (candidates.length === 0) candidates = Array.from(document.querySelectorAll('*'));
  let best = null, bestScore = 0;
  for (const el of candidates) {
    const sc = score(sig(el), saved);
    if (sc > bestScore) { bestScore = sc; best = el; }
  }
  return bestScore >= threshold ? best : null;
}

/**
 * Find an element, self-healing if the selector no longer matches.
 * @returns ElementHandle or null
 */
async function findAdaptive(page, selector, opts = {}) {
  const {
    autoSave = true,
    storeFile = path.join(process.cwd(), '.gepetto-selectors.json'),
    threshold = 0.5,
    domain,
  } = opts;
  const key = (domain || hostnameOf(page.url())) + '::' + selector;

  // 1. Try the literal selector first.
  let el = null;
  try { el = await page.$(selector); } catch (e) {}
  if (el) {
    if (autoSave) {
      try {
        const signature = await page.evaluate(computeSignature, el);
        const store = readStore(storeFile);
        store[key] = signature;
        writeStore(storeFile, store);
      } catch (e) {}
    }
    return el;
  }

  // 2. Selector failed — relocate by similarity to the saved signature.
  const store = readStore(storeFile);
  const saved = store[key];
  if (!saved) return null;
  try {
    const handle = await page.evaluateHandle(findBestMatch, saved, threshold);
    const found = handle.asElement();
    if (!found) { await handle.dispose(); return null; }
    return found;
  } catch (e) {
    return null;
  }
}

function attachAdaptive(page) {
  page.findAdaptive = (selector, opts) => findAdaptive(page, selector, opts);
}

module.exports = { findAdaptive, attachAdaptive };
