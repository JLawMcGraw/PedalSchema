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
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Cable]') || text.includes('[COLLISION]') || text.includes('[BOXES]') || text.includes('A* ') || text.includes('[PATH]')) {
      console.log(text);
    }
  });

  // Login
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
  await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

  // Go to existing config
  await page.goto('http://localhost:3000/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
  await card.click();
  await page.waitForURL(url => url.pathname.includes('/editor/') && !url.pathname.includes('/new'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click Optimize Layout button
  const optimizeBtn = page.getByText('Optimize Layout');
  if (await optimizeBtn.isVisible()) {
    await optimizeBtn.click();
    console.log('Clicked Optimize Layout');
    await page.waitForTimeout(2000);
  }

  // Click Cables tab
  await page.getByRole('tab', { name: 'Cables' }).click();
  await page.waitForTimeout(1500);

  const outputPath = path.join(__dirname, '../screenshots/optimized-cables.png');
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(outputPath);
  await browser.close();
}
main();
