#!/usr/bin/env node
/**
 * Capture console output from the editor page for cable path verification
 */

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

  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[CABLE') || text.includes('[BOXES]') || text.includes('[PATH]')) {
      consoleLogs.push(text);
    }
  });

  try {
    const email = process.env.VERIFY_EMAIL;
    const password = process.env.VERIFY_PASSWORD;

    // Login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Go to dashboard and find a config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const configCards = await page.locator('a[href*="/editor/"]').all();
    for (const card of configCards) {
      const href = await card.getAttribute('href');
      if (href && href.includes('/editor/') && !href.includes('/editor/new')) {
        await card.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000); // Wait for cables to render
        break;
      }
    }

    // Output collected console logs
    console.log('=== Cable Routing Debug Output ===\n');
    consoleLogs.forEach(log => console.log(log));

    if (consoleLogs.length === 0) {
      console.log('No cable debug output captured. DEBUG_PATHS might be false or no cables rendered.');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main();
