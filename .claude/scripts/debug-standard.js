const { chromium } = require('playwright');
const fs = require('fs');

const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('MT-2') && text.includes('NS-2')) {
      console.log(text);
    }
    if (text.includes('COLLISION') || text.includes('RE-ROUTE')) {
      console.log(text);
    }
    if (text.includes('[BOXES]')) {
      console.log(text);
    }
  });

  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
  await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

  await page.goto('http://localhost:3000/editor/993877d9-800e-4205-a563-18f248d482b5');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Make sure 4-cable method is OFF
  const routingTab = page.locator('button:has-text("Routing")');
  await routingTab.click();
  await page.waitForTimeout(500);

  const toggle = page.locator('text=4-Cable Method').locator('..').locator('button[role="switch"]');
  const isChecked = await toggle.getAttribute('data-state');
  if (isChecked === 'checked') {
    await toggle.click();
    console.log('Turned OFF 4-cable method');
    await page.waitForTimeout(1000);
  } else {
    console.log('4-cable method already OFF');
  }

  // Optimize
  console.log('--- OPTIMIZING (4-cable OFF) ---');
  const optimizeBtn = page.locator('button:has-text("Optimize Layout")');
  await optimizeBtn.click();
  await page.waitForTimeout(4000);

  // Take screenshot
  await page.screenshot({ path: '.claude/screenshots/standard-optimized.png' });
  console.log('Screenshot: .claude/screenshots/standard-optimized.png');

  await browser.close();
})();
