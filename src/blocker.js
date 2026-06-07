// src/blocker.js
//
// Resource & ad/tracker blocking via request interception. Blocking heavy
// resources (images/media/fonts) and known ad/analytics domains speeds up page
// loads AND reduces bot-like signatures (real users have ad-blockers; a client
// that loads every tracker is unusual). Opt-in via the `blockResources` /
// `blockAds` init options.
'use strict';

// Compact curated list of common ad / analytics / tracker domains. Extend via
// the `adDomains` option. (Substring-matched against the request URL host.)
const DEFAULT_AD_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com',
  'googletagservices.com', 'adservice.google.com', '2mdn.net', 'connect.facebook.net',
  'facebook.net', 'analytics.tiktok.com', 'scorecardresearch.com', 'adnxs.com', 'criteo.com',
  'criteo.net', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'adsrvr.org', 'moatads.com', 'hotjar.com', 'mixpanel.com',
  'segment.com', 'segment.io', 'fullstory.com', 'quantserve.com', 'clarity.ms', 'mc.yandex.ru',
  'snowplowanalytics.com', 'branch.io', 'appsflyer.com', 'adcolony.com', 'applovin.com',
  'chartbeat.com', 'nr-data.net', 'optimizely.com', 'crazyegg.com', 'mouseflow.com',
  'luckyorange.com', 'amplitude.com', 'heap.io', 'intercom.io', 'drift.com', 'zdassets.com',
  'onesignal.com', 'addthis.com', 'sharethis.com', 'adform.net', 'casalemedia.com',
  'contextweb.com', 'smartadserver.com', 'teads.tv', '3lift.com', 'indexww.com', 'gumgum.com',
  'media.net', 'revcontent.com', 'mgid.com', 'adroll.com', 'bat.bing.com',
];

/**
 * Enable request interception that blocks resources/ads.
 * @param {object} page
 * @param {object} [options]
 *   blockTypes: array of puppeteer resourceTypes to block (default ['image','media','font']).
 *               Pass true to use the default; pass [] / false to block none.
 *   blockAds:   boolean (default true) — block known ad/tracker domains.
 *   adDomains:  extra domains to block.
 *   allowList:  substrings; any request URL containing one is always allowed.
 */
async function enableResourceBlocking(page, options = {}) {
  let { blockTypes = ['image', 'media', 'font'], blockAds = true, adDomains = [], allowList = [] } = options;
  if (blockTypes === true) blockTypes = ['image', 'media', 'font'];
  if (!Array.isArray(blockTypes)) blockTypes = [];
  const typeSet = new Set(blockTypes);
  const ads = blockAds ? DEFAULT_AD_DOMAINS.concat(adDomains || []) : [];

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    try {
      const url = request.url();
      if (allowList.some((a) => url.includes(a))) return request.continue();
      if (typeSet.has(request.resourceType())) return request.abort();
      if (ads.length) {
        let host = '';
        try { host = new URL(url).host; } catch (e) { host = url; }
        if (ads.some((d) => host.includes(d))) return request.abort();
      }
      return request.continue();
    } catch (e) {
      try { request.continue(); } catch (e2) {}
    }
  });
}

module.exports = { enableResourceBlocking, DEFAULT_AD_DOMAINS };
