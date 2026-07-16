#!/usr/bin/env node
/**
 * Capture cable routing console logs for verification
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

  const configUrl = process.argv[2] || 'http://localhost:3000/editor/993877d9-800e-4205-a563-18f248d482b5';
  const logs = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[CABLE') || text.includes('[Cable]') || text.includes('[BOXES]')) {
      logs.push(text);
    }
  });

  // Login
  console.error('Logging in...');
  await page.goto('http://localhost:3000/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
  await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**');
  console.error('Login successful');

  // Navigate to config
  console.error(`Navigating to ${configUrl}...`);
  await page.goto(configUrl);
  await page.waitForTimeout(3000); // Wait for cables to render

  // Take screenshot
  const screenshotPath = path.join(__dirname, '../screenshots', `cables-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.error(`Screenshot: ${screenshotPath}`);

  // Output logs
  console.log('=== CABLE ROUTING LOGS ===');
  logs.forEach(log => console.log(log));
  console.log('=== END LOGS ===');

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
