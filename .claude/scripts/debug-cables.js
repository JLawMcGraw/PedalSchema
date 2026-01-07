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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Cable]') || text.includes('[COLLISION]') || text.includes('A* Grid') || text.includes('A* found') || text.includes('[BOXES]') || text.includes('[DEBUG]')) {
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
  await page.waitForTimeout(3000);

  console.log('--- Screenshot taken ---');
  await page.screenshot({ path: path.join(__dirname, '../screenshots/debug-cables.png') });
  await browser.close();
}
main();
