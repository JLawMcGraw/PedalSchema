#!/usr/bin/env node
/**
 * Verify 4-cable method cable routing:
 * 1. Login and go to editor
 * 2. Enable 4-cable method toggle
 * 3. Click Optimize Layout
 * 4. Take screenshot
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

  // Ensure screenshots directory exists
  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
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

    // Go to editor with existing board
    console.error('Loading editor...');
    await page.goto('http://localhost:3000/editor/993877d9-800e-4205-a563-18f248d482b5');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on Routing tab to access 4-cable method toggle
    console.error('Opening Routing tab...');
    const routingTab = page.locator('button:has-text("Routing")');
    await routingTab.click();
    await page.waitForTimeout(500);

    // Take screenshot BEFORE enabling 4-cable method
    const beforePath = path.join(screenshotsDir, 'verify-4cable-before.png');
    await page.screenshot({ path: beforePath });
    console.error(`Before screenshot: ${beforePath}`);

    // Find and click the 4-cable method toggle
    console.error('Enabling 4-Cable Method...');
    const toggle = page.locator('text=4-Cable Method').locator('..').locator('button[role="switch"]');
    const isChecked = await toggle.getAttribute('data-state');

    if (isChecked !== 'checked') {
      await toggle.click();
      await page.waitForTimeout(1000);
      console.error('4-Cable Method enabled');
    } else {
      console.error('4-Cable Method already enabled');
    }

    // Click Optimize Layout button
    console.error('Clicking Optimize Layout...');
    const optimizeBtn = page.locator('button:has-text("Optimize Layout")');
    await optimizeBtn.click();

    // Wait for optimization to complete
    await page.waitForTimeout(3000);
    console.error('Optimization complete');

    // Take screenshot AFTER optimization
    const afterPath = path.join(screenshotsDir, 'verify-4cable-after.png');
    await page.screenshot({ path: afterPath });
    console.error(`After screenshot: ${afterPath}`);

    // Output the final screenshot path
    console.log(afterPath);

  } catch (error) {
    console.error(`Error: ${error.message}`);

    // Take error screenshot
    const errorPath = path.join(screenshotsDir, 'verify-4cable-error.png');
    await page.screenshot({ path: errorPath });
    console.error(`Error screenshot saved to: ${errorPath}`);
    console.log(errorPath);

    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
