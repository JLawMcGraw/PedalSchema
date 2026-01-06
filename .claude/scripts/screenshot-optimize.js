#!/usr/bin/env node
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
}

async function main() {
  loadEnv();
  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;

  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const outputPath = path.join(screenshotsDir, `optimize-${Date.now()}.png`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 3200, height: 2400 },
    deviceScaleFactor: 3
  });
  const page = await context.newPage();

  try {
    // Capture collision, path, and box messages
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('COLLISION') || text.includes('PATH:') || text.includes('Box ') || text.includes('PEDAL BOXES') || text.includes('STRATEGY') || text.includes('DEBUG')) console.log(text);
    });

    // Login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Go to dashboard and click first config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    await card.click();
    await page.waitForURL(url => url.pathname.includes('/editor/') && !url.pathname.includes('/new'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Enable effects loop first
    const routingTab = page.getByRole('tab', { name: /routing/i });
    if (await routingTab.isVisible()) {
      await routingTab.click();
      await page.waitForTimeout(500);
      const effectsLoopSwitch = page.locator('button[role="switch"]').first();
      if (await effectsLoopSwitch.isVisible()) {
        const isChecked = await effectsLoopSwitch.getAttribute('data-state');
        if (isChecked !== 'checked') {
          await effectsLoopSwitch.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Click Optimize Layout button
    const optimizeBtn = page.getByRole('button', { name: /optimize/i });
    await optimizeBtn.click();
    await page.waitForTimeout(4000); // Wait for layout animation and re-render

    // Zoom in a bit to see cables better
    const zoomIn = page.locator('button:has-text("+")').first();
    if (await zoomIn.isVisible()) {
      await zoomIn.click();
      await page.waitForTimeout(300);
    }

    // Take high-res screenshot
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(outputPath);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
