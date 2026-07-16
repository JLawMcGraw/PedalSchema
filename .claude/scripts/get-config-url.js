#!/usr/bin/env node
/**
 * Get configuration URL from dashboard
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:3000/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
  await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**');

  // Get config link - look for specific config IDs (not /new)
  await page.waitForTimeout(2000);
  const links = await page.$$eval('a', els =>
    els.map(el => el.href).filter(h => h.includes('/editor/') && !h.includes('/new'))
  );

  if (links.length > 0) {
    console.log(links[0]);
  } else {
    // Try to get all links for debugging
    const allLinks = await page.$$eval('a', els => els.map(el => el.href));
    console.log('ALL_LINKS:', allLinks.join(', '));
    console.log('NO_CONFIG');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
