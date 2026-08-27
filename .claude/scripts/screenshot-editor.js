#!/usr/bin/env node
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
  const page = await browser.newPage({
    viewport: {
      width: Number(process.env.VERIFY_WIDTH || 1602),
      height: Number(process.env.VERIFY_HEIGHT || 902),
    },
  });

  try {
    // Login
    console.error('Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
    console.error('Login successful');

    // Go to dashboard and click the config
    console.error('Going to dashboard...');
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Open the hero configuration through its real primary action. The board
    // title is plain text, so clicking its text can silently leave us on the
    // dashboard and replace the marketing editor image with the wrong page.
    console.error('Clicking configuration...');
    await page.click('text=Continue editing');
    await page.waitForURL(url => url.pathname.startsWith('/editor/'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Take screenshot
    const outputPath = process.env.VERIFY_OUTPUT || path.join(__dirname, '../../public/landing/editor-20260826.png');
    await page.screenshot({ path: outputPath });
    console.log(outputPath);

  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
