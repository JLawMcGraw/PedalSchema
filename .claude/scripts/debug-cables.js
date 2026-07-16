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

  // Capture all cable debug logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Cable]') || text.includes('[PATH]') || text.includes('[BOXES]') ||
        text.includes('[AMP') || text.includes('[ROUTE') || text.includes('[VALIDATE') ||
        text.includes('[LIB-BOX]') || text.includes('expanded')) {
      console.log(text);
    }
  });

  try {
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = await card.getAttribute('href');

    const debugUrl = 'http://localhost:3000' + href + '?debug=cables&debug=libbox';
    console.log('Navigating to:', debugUrl);
    await page.goto(debugUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('\n=== ENABLING EFFECTS LOOP ===');
    const routingTab = page.getByRole('tab', { name: /routing/i });
    await routingTab.click();
    await page.waitForTimeout(500);

    const effectsSwitch = page.locator('button[role="switch"]').first();
    const state = await effectsSwitch.getAttribute('data-state');
    if (state !== 'checked') {
      await effectsSwitch.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForTimeout(1000);

    console.log('\n=== CABLE ANALYSIS ===');
    const cableInfo = await page.evaluate(() => {
      const cables = [];
      const paths = document.querySelectorAll('path[stroke]');
      paths.forEach((p, idx) => {
        const stroke = p.getAttribute('stroke');
        const d = p.getAttribute('d');
        if (d && stroke && !stroke.includes('none') && d.startsWith('M')) {
          const isRed = stroke === '#ef4444' || stroke.includes('red');
          cables.push({ index: idx, stroke, isRed, pathData: d.substring(0, 150) });
        }
      });
      return cables;
    });

    console.log('Cables found: ' + cableInfo.length);
    cableInfo.filter(c => c.isRed).forEach(c => {
      console.log('RED CABLE ' + c.index + ': stroke=' + c.stroke);
      console.log('  Path: ' + c.pathData);
    });

    const outputPath = path.join(__dirname, '../screenshots/debug-cables-' + Date.now() + '.png');
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log('\nScreenshot: ' + outputPath);

  } catch (error) {
    console.error('Error: ' + error.message);
  } finally {
    await browser.close();
  }
}

main();
