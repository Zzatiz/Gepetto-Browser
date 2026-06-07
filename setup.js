#!/usr/bin/env node
// setup.js — postinstall helper.
//
// On Debian/Ubuntu it tries to install the system libraries Chrome needs. It is
// intentionally NON-FATAL: a failure here (no sudo, CI, container, non-Debian)
// must never break `npm install`. It does NOT reinstall npm dependencies — npm
// already installs everything declared in package.json.
'use strict';

const { execSync } = require('child_process');
const os = require('os');

function isDebianBased() {
  if (os.platform() !== 'linux') return false;
  try {
    const result = execSync('cat /etc/os-release').toString().toLowerCase();
    return result.includes('debian') || result.includes('ubuntu');
  } catch (err) {
    return false;
  }
}

const CHROME_LIBS = [
  'xvfb', 'libnss3', 'libx11-xcb1', 'libxcomposite1', 'libxcursor1', 'libxdamage1',
  'libxi6', 'libxtst6', 'libxrandr2', 'libasound2', 'libpangocairo-1.0-0',
  'libatk1.0-0', 'libatk-bridge2.0-0', 'libcups2', 'libdbus-1-3',
];

function tryInstallLinuxPackages() {
  console.log('\n[Setup] Detected Debian-based Linux — attempting to install Chrome system libraries...');
  try {
    execSync('sudo apt-get update', { stdio: 'inherit' });
    execSync(`sudo apt-get install -y ${CHROME_LIBS.join(' ')}`, { stdio: 'inherit' });
    console.log('[Setup] System libraries installed.');
  } catch (err) {
    // Never fail the npm install — just guide the user.
    console.warn('[Setup] Could not auto-install system libraries (this is fine).');
    console.warn('[Setup] If Chrome fails to launch, install them manually:');
    console.warn(`[Setup]   sudo apt-get install -y ${CHROME_LIBS.join(' ')}`);
  }
}

(function main() {
  try {
    if (isDebianBased()) {
      tryInstallLinuxPackages();
    } else if (os.platform() === 'linux') {
      console.log('[Setup] Non-Debian Linux — install Chrome dependencies for Puppeteer manually if needed.');
    }
  } catch (err) {
    // Swallow everything; postinstall must exit 0.
    console.warn('[Setup] Skipped optional setup:', err.message);
  }
})();
