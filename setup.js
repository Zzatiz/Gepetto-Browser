#!/usr/bin/env node

// setup.js
const { execSync } = require('child_process');
const os = require('os');

const isLinux = os.platform() === 'linux';
const isDebianBased = () => {
  try {
    const result = execSync('cat /etc/os-release').toString();
    return result.includes('debian') || result.includes('ubuntu');
  } catch (err) {
    return false;
  }
};

const npmDependencies = [
  'axios',
  'ghost-cursor',
  'https-proxy-agent',
  'puppeteer',
  'tree-kill',
  'xvfb'
];

/**
 * Install system dependencies on Linux
 */
function installLinuxPackages() {
  console.log('\n[Setup] Installing required Linux packages...');
  try {
    execSync('sudo apt-get update', { stdio: 'inherit' });
    execSync('sudo apt-get install -y xvfb libnss3 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 libxrandr2 libasound2 libpangocairo-1.0-0 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3', { stdio: 'inherit' });
    console.log('[Setup] Linux packages installed successfully.');
  } catch (err) {
    console.error('[Setup] Failed to install Linux packages:', err.message);
    process.exit(1);
  }
}

/**
 * Install npm dependencies
 */
function installNpmDependencies() {
  console.log('\n[Setup] Installing required npm packages...');
  try {
    npmDependencies.forEach(dep => {
      console.log(`[Setup] Installing ${dep}...`);
      execSync(`npm install ${dep}`, { stdio: 'inherit' });
    });
    console.log('[Setup] All npm packages installed successfully.');
  } catch (err) {
    console.error('[Setup] Failed to install npm packages:', err.message);
    process.exit(1);
  }
}

(async () => {
  if (isLinux && isDebianBased()) {
    console.log('[Setup] Detected Debian-based Linux system.');
    installLinuxPackages();
  } else if (isLinux) {
    console.log('[Setup] Detected non-Debian Linux system.');
    console.log('[Setup] Please manually install required dependencies for Puppeteer.');
  }

  installNpmDependencies();
})();
