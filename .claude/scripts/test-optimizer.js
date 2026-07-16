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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  // Capture all console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[OPTIMIZER]') || text.includes('[GREEDY]') || text.includes('[Cable]') || text.includes('[PATH]')) {
      console.log(text);
    }
  });

  try {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Go to dashboard and get first config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = await card.getAttribute('href');

    // Add debug flag to URL
    const debugUrl = 'http://localhost:3000' + href + '?debug=true';
    console.log('Navigating to:', debugUrl);
    await page.goto(debugUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take before screenshot
    const beforePath = path.join(__dirname, '../screenshots/optimizer-before.png');
    await page.screenshot({ path: beforePath, fullPage: false });
    console.log('\n=== BEFORE SCREENSHOT ===');
    console.log('Saved:', beforePath);

    // Click Optimize Layout button
    console.log('\n=== CLICKING OPTIMIZE LAYOUT ===');
    const optimizeBtn = page.locator('button:has-text("Optimize Layout")');

    const btnExists = await optimizeBtn.count();
    console.log('Optimize button found:', btnExists > 0);

    if (btnExists > 0) {
      await optimizeBtn.click();
      console.log('Button clicked, waiting for optimization...');
      await page.waitForTimeout(5000);
    }

    // Take after screenshot
    const afterPath = path.join(__dirname, '../screenshots/optimizer-after.png');
    await page.screenshot({ path: afterPath, fullPage: false });
    console.log('\n=== AFTER SCREENSHOT ===');
    console.log('Saved:', afterPath);

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main();
