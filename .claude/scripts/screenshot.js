#!/usr/bin/env node
/**
 * Screenshot utility for Claude verification.
 *
 * Usage:
 *   node .claude/scripts/screenshot.js <url> [options]
 *
 * Options:
 *   --output, -o <path>   Output file path (default: .claude/screenshots/<timestamp>.png)
 *   --auth                Login first using VERIFY_EMAIL and VERIFY_PASSWORD from .env.local
 *   --wait <ms>           Additional wait time after page load (default: 1000)
 *   --full                Capture full page (default: viewport only)
 *
 * Examples:
 *   node .claude/scripts/screenshot.js http://localhost:3000/login
 *   node .claude/scripts/screenshot.js http://localhost:3000/editor/new --auth
 *   node .claude/scripts/screenshot.js http://localhost:3000/editor/new --auth --full
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    // Split by newlines, handling both CRLF and LF
    content.split(/\r?\n/).forEach(line => {
      // Skip empty lines and comments
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
}

function parseArgs(args) {
  const result = {
    url: null,
    output: null,
    auth: false,
    wait: 1000,
    full: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--auth') {
      result.auth = true;
    } else if (arg === '--full') {
      result.full = true;
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--wait') {
      result.wait = parseInt(args[++i], 10);
    } else if (!arg.startsWith('-') && !result.url) {
      result.url = arg;
    }
  }

  return result;
}

async function login(page, baseUrl) {
  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;

  if (!email || !password) {
    throw new Error('VERIFY_EMAIL and VERIFY_PASSWORD must be set in .env.local for --auth mode');
  }

  console.error('Logging in...');
  await page.goto(`${baseUrl}/login`);
  await page.waitForLoadState('networkidle');

  // Fill login form
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  // Submit
  await page.click('button[type="submit"]');

  // Wait for navigation away from login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  console.error('Login successful');
}

async function main() {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('Usage: node screenshot.js <url> [--auth] [--output path] [--wait ms] [--full]');
    process.exit(1);
  }

  // Ensure screenshots directory exists
  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Generate output path if not specified
  const outputPath = args.output || path.join(
    screenshotsDir,
    `verify-${Date.now()}.png`
  );

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    // Extract base URL for login
    const urlObj = new URL(args.url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    // Login if auth mode
    if (args.auth) {
      await login(page, baseUrl);
    }

    // Navigate to target URL
    console.error(`Navigating to ${args.url}...`);
    await page.goto(args.url);
    await page.waitForLoadState('networkidle');

    // Additional wait if specified
    if (args.wait > 0) {
      await page.waitForTimeout(args.wait);
    }

    // Take screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: args.full
    });

    // Output the path (this is what Claude reads)
    console.log(outputPath);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
