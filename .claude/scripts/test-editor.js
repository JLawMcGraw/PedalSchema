#!/usr/bin/env node
/**
 * Screenshot the editor by clicking on an existing configuration
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    if (msg.text().includes('[Cable]') || msg.text().includes('[COLLISION]') || msg.text().includes('[PATH]') || msg.text().includes('[BOXES]')) {
      console.error('CONSOLE:', msg.text());
    }
  });

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
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Find and click the first configuration card (not the "new" link)
    const configLinks = await page.$$('a[href*="/editor/"]');
    let configLink = null;
    for (const link of configLinks) {
      const href = await link.getAttribute('href');
      if (href && !href.endsWith('/new')) {
        configLink = link;
        break;
      }
    }
    if (configLink) {
      const href = await configLink.getAttribute('href');
      console.error('Found config link:', href);
      await configLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
    } else {
      console.error('No existing configuration found');
      process.exit(1);
    }

    // Click the Routing tab to access effects loop toggle
    const routingTab = await page.$('button:has-text("Routing")');
    if (routingTab) {
      await routingTab.click();
      await page.waitForTimeout(500);

      // Find and click the effects loop toggle
      const toggle = await page.$('button[role="switch"]');
      if (toggle) {
        const isChecked = await toggle.getAttribute('data-state');
        console.error('Effects loop toggle state:', isChecked);
        if (isChecked !== 'checked') {
          await toggle.click();
          await page.waitForTimeout(2000);
          console.error('Effects loop enabled');
        }
      }
    }

    // Take screenshot
    const outputPath = path.join(screenshotsDir, 'editor-cables-' + Date.now() + '.png');
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(outputPath);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
