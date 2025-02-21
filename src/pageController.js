// src/pageController.js
const { createCursor } = require('ghost-cursor');
const { checkTurnstile } = require('./turnstile');
const kill = require('tree-kill');

/**
 * Returns a random integer between min and max (inclusive).
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulates human mouse movement by moving to a random set of points.
 * Picks a random number (5–10) of moves (limited by the totalDelay) and distributes the totalDelay across them.
 * At each point, the mouse is moved and the script waits the corresponding time.
 *
 * @param {object} page - Puppeteer page.
 * @param {number} totalDelay - Total delay (in seconds) to simulate before the click/type.
 */
async function simulateHumanMovement(page, totalDelay) {
  const viewport = page.viewport();
  const minDwell = 0.5;
  let maxMoves = Math.floor(totalDelay / minDwell);
  // Pick a random number of moves between 5 and 10, but not more than maxMoves.
  let n = Math.min(getRandomInt(5, 10), maxMoves);
  if (n < 1) n = 1;
  let durations = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let d = Math.random() * (1 - 0.5) + 0.5; // random between 0.5 and 1 seconds
    durations.push(d);
    sum += d;
  }
  // Scale durations so that they sum to totalDelay.
  durations = durations.map(d => d * totalDelay / sum);
  // For each move, pick a random point in the viewport, move the mouse, and wait.
  for (let d of durations) {
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    await page.mouse.move(x, y, { steps: 10 });
    await new Promise(resolve => setTimeout(resolve, d * 1000));
  }
}

/**
 * Patches the page:
 * - Sets up ghost-cursor.
 * - Starts turnstile solving (if enabled).
 * - Authenticates proxy if needed.
 * - Overrides page.click and page.type to simulate human-like mouse hovering before the action.
 */
async function pageController({ browser, page, proxy, turnstile, xvfbSession, plugins }) {
  let solveStatus = turnstile;

  page.on('close', () => {
    solveStatus = false;
  });

  browser.on('disconnected', async () => {
    solveStatus = false;
    if (xvfbSession) {
      try { xvfbSession.stopSync(); } catch (err) {}
    }
  });

  // Start turnstile solver in background.
  (async function turnstileSolver() {
    while (solveStatus) {
      try {
        await checkTurnstile({ page });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }
  })();

  // If proxy requires authentication, set it up.
  if (proxy.username && proxy.password) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }

  // Call any plugin hooks.
  if (plugins && plugins.length > 0) {
    plugins.forEach(plugin => {
      if (plugin.onPageCreated) plugin.onPageCreated(page);
    });
  }

  // Patch new documents to fix MouseEvent properties.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(MouseEvent.prototype, 'screenX', {
      get: function () { return this.clientX + window.screenX; }
    });
    Object.defineProperty(MouseEvent.prototype, 'screenY', {
      get: function () { return this.clientY + window.screenY; }
    });
  });

  // Set up ghost-cursor.
  const cursor = createCursor(page);
  page.realCursor = cursor;
  page.realClick = cursor.click;

  // If an input delay is set, override page.click and page.type to simulate human movement.
  if (page.inputDelay && page.inputDelay > 0) {
    const originalClick = page.click.bind(page);
    page.click = async function (selector, options) {
      await simulateHumanMovement(page, page.inputDelay);
      return originalClick(selector, options);
    };

    const originalType = page.type.bind(page);
    page.type = async function (selector, text, options) {
      await simulateHumanMovement(page, page.inputDelay);
      return originalType(selector, text, options);
    };
  }

  return page;
}

module.exports = { pageController };
