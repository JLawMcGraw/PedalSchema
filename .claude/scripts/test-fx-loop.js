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

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[GREEDY]') || text.includes('[OPTIMIZER]') || text.includes('[Cable]')) {
      console.log(text);
    }
  });

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

    await page.goto('http://localhost:3000' + href + '?debug=true');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Enable effects loop
    console.log('\n=== ENABLING EFFECTS LOOP ===');
    const routingTab = page.getByRole('tab', { name: /routing/i });
    await routingTab.click();
    await page.waitForTimeout(500);

    // Find and enable effects loop switch
    const effectsSwitch = page.locator('button[role="switch"]').first();
    const effectsState = await effectsSwitch.getAttribute('data-state');
    console.log('Effects loop current state:', effectsState);
    if (effectsState !== 'checked') {
      await effectsSwitch.click();
      await page.waitForTimeout(1000);
      console.log('Enabled effects loop');
    }

    // Enable modulation in loop (clean modulation toggle)
    const switches = page.locator('button[role="switch"]');
    const switchCount = await switches.count();
    console.log('Found', switchCount, 'switches');

    // The modulation toggle is typically the 2nd or 3rd switch
    for (let i = 1; i < switchCount; i++) {
      const switchEl = switches.nth(i);
      const label = await switchEl.locator('..').textContent();
      console.log(`Switch ${i}: ${label?.substring(0, 30) || 'no label'}`);

      if (label?.toLowerCase().includes('modulation')) {
        const state = await switchEl.getAttribute('data-state');
        if (state !== 'checked') {
          await switchEl.click();
          await page.waitForTimeout(500);
          console.log('Enabled modulation in loop');
        }
        break;
      }
    }

    // Wait for signal chain to recalculate
    await page.waitForTimeout(1000);

    // Take screenshot before optimize
    const beforePath = path.join(__dirname, '../screenshots/fx-loop-before.png');
    await page.screenshot({ path: beforePath, fullPage: false });
    console.log('\nBefore screenshot:', beforePath);

    // Click Optimize Layout
    console.log('\n=== CLICKING OPTIMIZE LAYOUT ===');
    const optimizeBtn = page.locator('button:has-text("Optimize Layout")');
    if (await optimizeBtn.count() > 0) {
      await optimizeBtn.click();
      await page.waitForTimeout(3000);
    }

    // Take screenshot after optimize
    const afterPath = path.join(__dirname, '../screenshots/fx-loop-after.png');
    await page.screenshot({ path: afterPath, fullPage: false });
    console.log('\nAfter screenshot:', afterPath);

    // Extract cable info
    const cableInfo = await page.evaluate(() => {
      const paths = document.querySelectorAll('path[stroke]');
      const cables = [];
      paths.forEach((p, idx) => {
        const stroke = p.getAttribute('stroke');
        const d = p.getAttribute('d');
        if (d && stroke && !stroke.includes('none') && d.startsWith('M')) {
          cables.push({
            index: idx,
            stroke: stroke,
            isRed: stroke === '#ef4444' || stroke.includes('red'),
            pathLength: d.length
          });
        }
      });
      return cables;
    });

    console.log('\n=== CABLE ANALYSIS ===');
    console.log('Total cables:', cableInfo.length);
    const redCables = cableInfo.filter(c => c.isRed);
    if (redCables.length > 0) {
      console.log('RED (invalid) cables:', redCables.length);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main();
