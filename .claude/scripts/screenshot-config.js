#!/usr/bin/env node
/**
 * Screenshot utility that navigates through dashboard to an existing config.
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

  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const outputPath = path.join(screenshotsDir, `editor-${Date.now()}.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  try {
    const email = process.env.VERIFY_EMAIL;
    const password = process.env.VERIFY_PASSWORD;

    if (!email || !password) {
      throw new Error('VERIFY_EMAIL and VERIFY_PASSWORD must be set in .env.local');
    }

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

    // Click on first config card (not the "New Board" button)
    console.error('Looking for configuration...');
    await page.waitForTimeout(2000); // Wait for page to load

    // Look for config cards that link to /editor/ with a UUID (not /editor/new)
    const configCards = await page.locator('a[href*="/editor/"]').all();
    let foundConfig = false;

    for (const card of configCards) {
      const href = await card.getAttribute('href');
      console.error('Found link: ' + href);
      // Skip /editor/new, look for UUID-based paths
      if (href && href.includes('/editor/') && !href.includes('/editor/new')) {
        await card.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000); // Wait for cables to render
        foundConfig = true;
        break;
      }
    }

    if (foundConfig) {
      console.error('Taking screenshot...');
      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(outputPath);
    } else {
      console.error('No configuration found - taking dashboard screenshot');
      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(outputPath);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
