const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '../../.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    // Login
    console.error('Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    
    // Go to dashboard and click the config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    
    // Click on the first configuration card
    await page.click('text=J$ Home');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Click on "Routing" tab to see effects loop settings
    console.error('Clicking Routing tab...');
    await page.click('text=Routing');
    await page.waitForTimeout(1000);
    
    // Take screenshot
    const outputPath = path.join(__dirname, '../screenshots/routing-tab.png');
    await page.screenshot({ path: outputPath });
    console.log(outputPath);

  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
