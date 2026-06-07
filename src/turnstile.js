// src/turnstile.js
//
// Cloudflare Turnstile checkbox solver. Improvements over the original
// brute-force approach:
//   1. If the challenge is already solved (the cf-turnstile-response token has a
//      value), do nothing — avoids re-clicking a solved widget every tick.
//   2. Prefer the real Turnstile iframe (src*="challenges.cloudflare.com") and
//      click its centre, instead of clicking arbitrary ~300px empty divs.
//   3. Fall back to the original empty-widget heuristic only when no iframe is found.
'use strict';

async function checkTurnstile({ page }) {
  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => resolve(false), 8000);
    try {
      // 1. Already solved? The response token field will be populated.
      const solved = await page.evaluate(() => {
        const fields = document.querySelectorAll('[name="cf-turnstile-response"]');
        for (const f of fields) {
          if (f && f.value && f.value.length > 0) return true;
        }
        return false;
      });
      if (solved) {
        clearTimeout(timeout);
        return resolve('solved');
      }

      // 2. Prefer the actual Turnstile iframe and click its centre.
      const frames = await page.$$('iframe[src*="challenges.cloudflare.com"]');
      if (frames && frames.length > 0) {
        for (const frame of frames) {
          try {
            const box = await frame.boundingBox();
            if (box && box.width > 0 && box.height > 0) {
              // The checkbox sits near the left of the widget.
              const x = box.x + Math.min(30, box.width / 2);
              const y = box.y + box.height / 2;
              await page.mouse.click(x, y);
            }
          } catch (e) {}
        }
        clearTimeout(timeout);
        return resolve(true);
      }

      // 3. Fallback heuristic: a ~300px-wide empty widget container.
      const coordinates = await page.evaluate(() => {
        const coords = [];
        const collect = (strict) => {
          document.querySelectorAll('div').forEach((item) => {
            try {
              const rect = item.getBoundingClientRect();
              const style = window.getComputedStyle(item);
              const okStyle = !strict || (style.margin === '0px' && style.padding === '0px');
              if (okStyle && rect.width > 290 && rect.width <= 310 && !item.querySelector('*')) {
                coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
              }
            } catch (err) {}
          });
        };
        collect(true);
        if (coords.length === 0) collect(false);
        return coords;
      });
      for (const coord of coordinates) {
        try {
          const x = coord.x + 30;
          const y = coord.y + coord.h / 2;
          await page.mouse.click(x, y);
        } catch (e) {}
      }
      clearTimeout(timeout);
      resolve(coordinates.length > 0);
    } catch (e) {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

module.exports = { checkTurnstile };
