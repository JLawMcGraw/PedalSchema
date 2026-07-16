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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Go to dashboard and get first config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = await card.getAttribute('href');

    await page.goto('http://localhost:3000' + href);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('=== BEFORE OPTIMIZE ===');

    // Extract pedal positions from the DOM
    const beforeData = await page.evaluate(() => {
      const canvas = document.querySelector('.relative.overflow-hidden');
      if (!canvas) return { error: 'Canvas not found' };

      // Find all pedal elements
      const pedalElements = canvas.querySelectorAll('[style*="transform"]');
      const pedals = [];

      pedalElements.forEach(el => {
        const transform = el.style.transform;
        const match = transform.match(/translate\((-?\d+\.?\d*)px,\s*(-?\d+\.?\d*)px\)/);
        if (match) {
          const textContent = el.textContent || '';
          // Try to find pedal name
          const nameEl = el.querySelector('.font-semibold, .font-bold, .text-xs');
          const name = nameEl?.textContent || textContent.slice(0, 30);
          if (name && !name.includes('guitar') && !name.includes('amp')) {
            pedals.push({
              name: name.trim(),
              x: parseFloat(match[1]),
              y: parseFloat(match[2])
            });
          }
        }
      });

      return pedals;
    });

    if (Array.isArray(beforeData)) {
      // Sort by X position (right to left = higher X first)
      beforeData.sort((a, b) => b.x - a.x);
      console.log('Pedals sorted by X (signal flow order):');
      beforeData.forEach((p, i) => console.log(`  ${i+1}. ${p.name}: x=${p.x.toFixed(0)}, y=${p.y.toFixed(0)}`));
    }

    // Click Optimize
    console.log('\n=== CLICKING OPTIMIZE ===');
    const optimizeBtn = page.locator('button:has-text("Optimize Layout")');
    await optimizeBtn.click();
    await page.waitForTimeout(3000);

    console.log('\n=== AFTER OPTIMIZE ===');

    const afterData = await page.evaluate(() => {
      const canvas = document.querySelector('.relative.overflow-hidden');
      if (!canvas) return { error: 'Canvas not found' };

      const pedalElements = canvas.querySelectorAll('[style*="transform"]');
      const pedals = [];

      pedalElements.forEach(el => {
        const transform = el.style.transform;
        const match = transform.match(/translate\((-?\d+\.?\d*)px,\s*(-?\d+\.?\d*)px\)/);
        if (match) {
          const textContent = el.textContent || '';
          const nameEl = el.querySelector('.font-semibold, .font-bold, .text-xs');
          const name = nameEl?.textContent || textContent.slice(0, 30);
          if (name && !name.includes('guitar') && !name.includes('amp')) {
            pedals.push({
              name: name.trim(),
              x: parseFloat(match[1]),
              y: parseFloat(match[2])
            });
          }
        }
      });

      return pedals;
    });

    if (Array.isArray(afterData)) {
      afterData.sort((a, b) => b.x - a.x);
      console.log('Pedals sorted by X (signal flow order):');
      afterData.forEach((p, i) => console.log(`  ${i+1}. ${p.name}: x=${p.x.toFixed(0)}, y=${p.y.toFixed(0)}`));
    }

    // Take screenshot
    const screenshotPath = path.join(__dirname, '../screenshots/verify-layout.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('\nScreenshot:', screenshotPath);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main();
