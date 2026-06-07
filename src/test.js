// src/test.js — smoke test / feature demo for Gepetto-Browser.
// Run with: npm test    (set GEPETTO_EXECUTABLE_PATH to override the Chrome path)
const { init, tieredFetch } = require('./index');

(async () => {
  // 1. HTTP-first path (no browser).
  try {
    const { mode, result } = await tieredFetch('https://example.com');
    console.log(`[http] ${mode} -> status ${result && result.status}`);
  } catch (e) {
    console.log('[http] skipped:', e.message);
  }

  // 2. Stealth browser.
  const { browser, page } = await init({
    headless: true,                 // flip to false to watch it
    disableXvfb: true,
    fingerprint: true,              // coherent fingerprint spoofing
    turnstile: true,                // auto-solve Cloudflare Turnstile
    blockResources: ['image', 'font'],
    inputDelay: 0,
    executablePath: process.env.GEPETTO_EXECUTABLE_PATH || undefined,

    // Example proxy usage (uncomment + add to proxies.txt or pass here):
    // proxy: { type: 'http', host: '127.0.0.1', port: '8080', username: 'u', password: 'p' },
    // proxyRotation: 'roundrobin',
    // geoip: true,
  });

  try {
    await page.gotoResilient('https://example.com', { timeout: 30000 });
    const fp = page.fingerprint;
    console.log('[browser] title :', await page.title());
    console.log('[browser] spoof :', fp.os, fp.platform, '| Chrome', fp.clientHints.fullVersion);
    console.log('[browser] webgl :', fp.webgl.renderer);

    // Self-healing selector demo.
    const h1 = await page.findAdaptive('h1');
    if (h1) console.log('[browser] h1 via findAdaptive:', await (await h1.getProperty('textContent')).jsonValue());

    console.log('Test completed successfully.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
