// src/test.js
const { init } = require('./index');

(async () => {
  try {
    const { browser, page } = await init({
      // Puppeteer launch settings:
      headless: false, // Launch in non-headless mode
      args: ['--custom-flag=example'], // Additional chrome flags (appended to defaults if configFlags is not set)
      configFlags: ['--window-size=1280,720', '--no-sandbox'], // Completely override default chrome flags
      screenSize: { width: 1280, height: 720 }, // Desired viewport dimensions
      
      // // Proxy settings:
      // proxy: { 
      //   type: 'http', 
      //   host: '127.0.0.1', 
      //   port: '8080', 
      //   username: 'user', 
      //   password: 'pass'
      // },
      
      // Captcha & turnstile features:
      captcha: false,    // When true, user is prompted for a 2Captcha API key and the extension config is updated
      turnstile: true,  // Toggle turnstile solving
      
      // Additional configuration:
      customConfig: { someCustomKey: 'someValue' }, // Additional puppeteer.launch options
      disableXvfb: true,    // Whether to disable xvfb on Linux
      plugins: [],           // Array of puppeteer-extra plugins
      ignoreAllFlags: false, // Whether to ignore default chrome flags
      fingerprint: true,     // Toggle fingerprint protection
      
      // AutoLaunch settings:
      autoLaunch: true,      // Automatically launch the browser on connect
      
      // User Agent and input simulation:
      userAgent: "random",   // If "random", a random agent is chosen from Agents.txt
      inputDelay: 2.0,       // Total delay (in seconds) to simulate human-like mouse hovering before click/type
      
      // Executable path:
      executablePath: '/usr/bin/google-chrome-stable' // On Debian-based systems, defaults to this
    });
    
    // Test navigation:
    await page.goto('https://google.com');
    await browser.close();
    console.log('Test completed successfully.');
  } catch (error) {
    console.error('Test failed:', error);
  }
})();
