// src/turnstile.js
async function checkTurnstile({ page }) {
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => { resolve(false); }, 5000);
      try {
        const elements = await page.$$('[name="cf-turnstile-response"]');
        if (elements.length <= 0) {
          const coordinates = await page.evaluate(() => {
            let coords = [];
            document.querySelectorAll('div').forEach(item => {
              try {
                const rect = item.getBoundingClientRect();
                const style = window.getComputedStyle(item);
                if (
                  style.margin === "0px" &&
                  style.padding === "0px" &&
                  rect.width > 290 &&
                  rect.width <= 310 &&
                  !item.querySelector('*')
                ) {
                  coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                }
              } catch (err) {}
            });
            if (coords.length <= 0) {
              document.querySelectorAll('div').forEach(item => {
                try {
                  const rect = item.getBoundingClientRect();
                  if (rect.width > 290 && rect.width <= 310 && !item.querySelector('*')) {
                    coords.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                  }
                } catch (err) {}
              });
            }
            return coords;
          });
          for (const coord of coordinates) {
            try {
              let x = coord.x + 30;
              let y = coord.y + coord.h / 2;
              await page.mouse.click(x, y);
            } catch (e) {}
          }
          clearTimeout(timeout);
          return resolve(true);
        }
        for (const element of elements) {
          try {
            const parent = await element.evaluateHandle(el => el.parentElement);
            const box = await parent.boundingBox();
            let x = box.x + 30;
            let y = box.y + box.height / 2;
            await page.mouse.click(x, y);
          } catch (e) {}
        }
        clearTimeout(timeout);
        resolve(true);
      } catch (e) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }
  
  module.exports = { checkTurnstile };
  