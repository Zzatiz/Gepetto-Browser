// src/stealth/fingerprint.js
//
// Generates a coherent, optionally-seeded browser fingerprint profile.
//
// Anti-bot systems don't just read individual signals — they cross-check them
// for consistency (a "Windows" UA with an Apple GPU, or a 24-core machine with
// 800x600 screen, is an instant tell). This module bundles the signals that
// must agree into one profile so they stay internally consistent.
//
//   - fingerprint: true        -> a fresh random-but-coherent identity
//   - fingerprint: 12345        -> deterministic identity from a seed (repeatable)
//   - fingerprint: "my-user"   -> deterministic identity from a string seed
//   - fingerprint: { ... }      -> a custom profile you supply yourself
//
'use strict';

// Deterministic PRNG (mulberry32): same seed -> same sequence, so a given
// fingerprint seed reproduces the exact same identity on every run.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a hash so string seeds map to a stable 32-bit integer.
function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// OS profiles, each paired with WebGL renderers / screen sizes that real
// machines on that OS actually report. These ANGLE strings mirror common
// consumer hardware.
const PLATFORMS = {
  windows: {
    platform: 'Win32',
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    chPlatform: 'Windows',
    chPlatformVersion: '15.0.0',
    taskbar: 48,
    webgl: [
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ],
    screens: [ { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1536, h: 864 }, { w: 1366, h: 768 } ],
  },
  mac: {
    platform: 'MacIntel',
    uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
    chPlatform: 'macOS',
    chPlatformVersion: '14.6.0',
    taskbar: 25,
    webgl: [
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)' },
      { vendor: 'Google Inc. (Intel Inc.)', renderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)' },
    ],
    screens: [ { w: 1512, h: 982 }, { w: 1728, h: 1117 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 } ],
  },
};

const HARDWARE_CONCURRENCY = [4, 8, 8, 12, 16];
const DEVICE_MEMORY = [8, 8, 16, 4];

// Chrome's Client Hints "brand" list uses a GREASE entry plus the real brands.
function buildBrands(major) {
  return [
    { brand: 'Not(A:Brand', version: '99' },
    { brand: 'Google Chrome', version: String(major) },
    { brand: 'Chromium', version: String(major) },
  ];
}
function buildFullVersionList(major) {
  const full = `${major}.0.0.0`;
  return [
    { brand: 'Not(A:Brand', version: '99.0.0.0' },
    { brand: 'Google Chrome', version: full },
    { brand: 'Chromium', version: full },
  ];
}

/**
 * Generate a coherent fingerprint profile.
 * @param {boolean|number|string} seedInput - true for random, or a seed.
 * @param {number} [chromeMajor] - real Chrome major version (keeps UA/CH aligned with the binary).
 */
function generateFingerprint(seedInput, chromeMajor) {
  const rawSeed = (seedInput === true || seedInput == null) ? randomSeed() : seedInput;
  const seed = hashSeed(rawSeed);
  const rng = makeRng(seed);

  const osKey = pick(rng, ['windows', 'windows', 'mac']); // weight toward Windows (most common)
  const os = PLATFORMS[osKey];
  const gpu = pick(rng, os.webgl);
  const scr = pick(rng, os.screens);
  const major = chromeMajor || 142;

  const userAgent =
    `Mozilla/5.0 (${os.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${major}.0.0.0 Safari/537.36`;

  return {
    seed,
    os: osKey,
    platform: os.platform,
    userAgent,
    vendor: 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    hardwareConcurrency: pick(rng, HARDWARE_CONCURRENCY),
    deviceMemory: pick(rng, DEVICE_MEMORY),
    screen: {
      width: scr.w,
      height: scr.h,
      availWidth: scr.w,
      availHeight: scr.h - os.taskbar,
      colorDepth: 24,
      pixelDepth: 24,
    },
    webgl: gpu,
    // Seed for deterministic canvas/audio noise injected in the page context.
    noiseSeed: Math.floor(rng() * 1e9),
    clientHints: {
      platform: os.chPlatform,
      platformVersion: os.chPlatformVersion,
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false,
      fullVersion: `${major}.0.0.0`,
      brands: buildBrands(major),
      fullVersionList: buildFullVersionList(major),
    },
  };
}

module.exports = { generateFingerprint, hashSeed, makeRng };
