#!/usr/bin/env node
/**
 * Screenshot the editor by clicking on the first configuration
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local
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

  if (!email || !password) {
    console.error('VERIFY_EMAIL and VERIFY_PASSWORD must be set in .env.local');
    process.exit(1);
  }

  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const outputPath = path.join(screenshotsDir, `editor-${Date.now()}.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  try {
    // Login
    console.error('Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    console.error('Login successful');

    // Go to dashboard
    console.error('Going to dashboard...');
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on first configuration card (exclude /editor/new)
    console.error('Clicking on configuration...');
    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    console.error('Cards found:', await page.locator('a[href^="/editor/"]').count());
    if (await card.count() > 0) {
      const href = await card.getAttribute('href');
      console.error('Navigating to:', href);
      await card.click();
      await page.waitForURL(url => url.pathname.includes('/editor/') && !url.pathname.includes('/new'), { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      // Take screenshot
      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(outputPath);
    } else {
      console.error('No configuration cards found');
      process.exit(1);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
