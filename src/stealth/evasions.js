// src/stealth/evasions.js
//
// The page-context stealth payload. `applyEvasions` is serialized and injected
// via page.evaluateOnNewDocument so it runs at the very start of EVERY document
// (main frame + iframes), before any anti-bot script can read the originals.
//
// It must be a self-contained function — it cannot reference Node closures, only
// its single `profile` argument. Every patch is wrapped in try/catch so one
// failure can never break page execution.
'use strict';

function applyEvasions(profile) {
  const p = profile || {};

  // --- toString masking ----------------------------------------------------
  // Detection scripts call fn.toString() to check whether a built-in has been
  // monkey-patched. We map every replacement back to a "[native code]" string.
  const nativeMap = new WeakMap();
  const origFnToString = Function.prototype.toString;
  function makeNative(fn, name) {
    try { nativeMap.set(fn, 'function ' + (name || fn.name || '') + '() { [native code] }'); } catch (e) {}
    return fn;
  }
  const patchedToString = function toString() {
    if (nativeMap.has(this)) return nativeMap.get(this);
    return origFnToString.call(this);
  };
  try {
    nativeMap.set(patchedToString, 'function toString() { [native code] }');
    Function.prototype.toString = patchedToString;
  } catch (e) {}

  function defineGetter(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, {
        get: makeNative(getter, 'get ' + prop),
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  // --- navigator.webdriver -------------------------------------------------
  defineGetter(Navigator.prototype, 'webdriver', function () { return false; });

  // --- navigator identity --------------------------------------------------
  if (p.platform) defineGetter(Navigator.prototype, 'platform', function () { return p.platform; });
  if (p.vendor) defineGetter(Navigator.prototype, 'vendor', function () { return p.vendor; });
  if (p.languages && p.languages.length) {
    defineGetter(Navigator.prototype, 'languages', function () { return Object.freeze(p.languages.slice()); });
    if (p.language) defineGetter(Navigator.prototype, 'language', function () { return p.language; });
  }
  if (p.hardwareConcurrency) defineGetter(Navigator.prototype, 'hardwareConcurrency', function () { return p.hardwareConcurrency; });
  if (p.deviceMemory) defineGetter(Navigator.prototype, 'deviceMemory', function () { return p.deviceMemory; });

  // --- screen --------------------------------------------------------------
  if (p.screen) {
    defineGetter(Screen.prototype, 'width', function () { return p.screen.width; });
    defineGetter(Screen.prototype, 'height', function () { return p.screen.height; });
    defineGetter(Screen.prototype, 'availWidth', function () { return p.screen.availWidth || p.screen.width; });
    defineGetter(Screen.prototype, 'availHeight', function () { return p.screen.availHeight || p.screen.height; });
    defineGetter(Screen.prototype, 'colorDepth', function () { return p.screen.colorDepth || 24; });
    defineGetter(Screen.prototype, 'pixelDepth', function () { return p.screen.pixelDepth || 24; });
    // Headless reports outerWidth/Height as 0 — a classic tell.
    try {
      if (window.outerWidth === 0) defineGetter(window, 'outerWidth', function () { return window.innerWidth; });
      if (window.outerHeight === 0) defineGetter(window, 'outerHeight', function () { return window.innerHeight + (p.os === 'mac' ? 25 : 80); });
    } catch (e) {}
  }

  // --- window.chrome -------------------------------------------------------
  // Only fill in what's missing so we don't clobber a real headful chrome object.
  try {
    if (!window.chrome) window.chrome = {};
    const c = window.chrome;
    if (!c.runtime) c.runtime = {};
    if (!c.app) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      };
    }
    if (!c.csi) c.csi = makeNative(function csi() { return {}; }, 'csi');
    if (!c.loadTimes) c.loadTimes = makeNative(function loadTimes() { return {}; }, 'loadTimes');
  } catch (e) {}

  // --- permissions <-> Notification coherence ------------------------------
  try {
    const perms = window.navigator.permissions;
    if (perms && perms.query) {
      const origQuery = perms.query.bind(perms);
      perms.query = makeNative(function query(params) {
        if (params && params.name === 'notifications' && typeof Notification !== 'undefined') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return origQuery(params);
      }, 'query');
    }
  } catch (e) {}

  // --- WebGL vendor / renderer --------------------------------------------
  // The #1 headless tell: SwiftShader software rendering. Spoof to a real GPU.
  if (p.webgl) {
    const VENDOR = 37445;   // UNMASKED_VENDOR_WEBGL
    const RENDERER = 37446; // UNMASKED_RENDERER_WEBGL
    function patchGL(proto) {
      if (!proto || !proto.getParameter) return;
      const orig = proto.getParameter;
      proto.getParameter = makeNative(function getParameter(param) {
        if (param === VENDOR) return p.webgl.vendor;
        if (param === RENDERER) return p.webgl.renderer;
        return orig.call(this, param);
      }, 'getParameter');
    }
    try { patchGL(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype); } catch (e) {}
    try { patchGL(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype); } catch (e) {}
  }

  // --- deterministic canvas noise -----------------------------------------
  // Defeats canvas fingerprinting by perturbing ~1/64 pixels by one bit. The
  // noise is seeded, so it's identical within a session (consistent identity)
  // but different from the real device. Non-destructive: we noise a copy.
  if (p.noiseSeed) {
    const seed = p.noiseSeed >>> 0;
    function perturb(data) {
      let s = seed;
      for (let i = 0; i < data.length; i += 4) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        if ((s & 0x3f) === 0) {
          data[i] ^= (s & 1);
          data[i + 1] ^= ((s >> 1) & 1);
          data[i + 2] ^= ((s >> 2) & 1);
        }
      }
    }
    try {
      const Ctx = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
      const origGetImageData = Ctx && Ctx.getImageData;
      if (origGetImageData) {
        Ctx.getImageData = makeNative(function getImageData(x, y, w, h) {
          const data = origGetImageData.call(this, x, y, w, h);
          try { perturb(data.data); } catch (e) {}
          return data;
        }, 'getImageData');
      }
      const HC = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
      if (HC && origGetImageData) {
        const origToDataURL = HC.toDataURL;
        HC.toDataURL = makeNative(function toDataURL() {
          try {
            const w = this.width, h = this.height;
            if (w > 0 && h > 0) {
              const copy = document.createElement('canvas');
              copy.width = w; copy.height = h;
              const cctx = copy.getContext('2d');
              cctx.drawImage(this, 0, 0);
              const id = origGetImageData.call(cctx, 0, 0, w, h);
              perturb(id.data);
              cctx.putImageData(id, 0, 0);
              return origToDataURL.apply(copy, arguments);
            }
          } catch (e) {}
          return origToDataURL.apply(this, arguments);
        }, 'toDataURL');
      }
    } catch (e) {}

    // --- deterministic audio noise ----------------------------------------
    try {
      const AB = window.AudioBuffer && window.AudioBuffer.prototype;
      if (AB && AB.getChannelData) {
        const origGet = AB.getChannelData;
        const noised = new WeakSet();
        AB.getChannelData = makeNative(function getChannelData(channel) {
          const out = origGet.call(this, channel);
          if (!noised.has(this)) {
            noised.add(this);
            let s = seed;
            for (let i = 0; i < out.length; i += 100) {
              s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
              out[i] = out[i] + (s / 4294967296 - 0.5) * 1e-7;
            }
          }
          return out;
        }, 'getChannelData');
      }
    } catch (e) {}
  }

  // --- WebRTC local/private IP leak ----------------------------------------
  // Belt-and-suspenders to the launch flag: drop ICE candidates exposing
  // private/local addresses so the real IP can't leak past the proxy.
  try {
    const OrigPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (OrigPC) {
      const isPrivate = function (c) {
        return /(\b10\.|\b127\.|\b192\.168\.|\b172\.(1[6-9]|2\d|3[01])\.|\.local\b)/i.test(c || '');
      };
      const Wrapped = function RTCPeerConnection() {
        const pc = new (Function.prototype.bind.apply(OrigPC, [null].concat(Array.prototype.slice.call(arguments))))();
        const origAdd = pc.addEventListener.bind(pc);
        pc.addEventListener = makeNative(function addEventListener(type, listener, opts) {
          if (type === 'icecandidate' && typeof listener === 'function') {
            const filtered = function (event) {
              if (event && event.candidate && isPrivate(event.candidate.candidate)) return;
              return listener.call(this, event);
            };
            return origAdd(type, filtered, opts);
          }
          return origAdd(type, listener, opts);
        }, 'addEventListener');
        let _on = null;
        try {
          Object.defineProperty(pc, 'onicecandidate', {
            get: function () { return _on; },
            set: function (fn) {
              _on = fn;
              if (fn) pc.addEventListener('icecandidate', function (e) { if (_on) _on.call(pc, e); });
            },
            configurable: true,
          });
        } catch (e) {}
        return pc;
      };
      Wrapped.prototype = OrigPC.prototype;
      window.RTCPeerConnection = makeNative(Wrapped, 'RTCPeerConnection');
      if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }
  } catch (e) {}
}

module.exports = { applyEvasions };
