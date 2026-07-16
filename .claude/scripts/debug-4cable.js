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

  // Capture all console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[CABLE]') || text.includes('[ROUTING]') || text.includes('4-cable')) {
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

    // Go to editor
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = await card.getAttribute('href');

    await page.goto('http://localhost:3000' + href);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Go to Routing tab and enable effects loop
    console.log('=== CHECKING ROUTING TAB ===');
    const routingTab = page.getByRole('tab', { name: /routing/i });
    await routingTab.click();
    await page.waitForTimeout(500);

    // Take screenshot of routing panel
    const routingScreenshot = path.join(__dirname, '../screenshots/routing-panel-' + Date.now() + '.png');
    await page.screenshot({ path: routingScreenshot, fullPage: false });
    console.log('Routing panel screenshot: ' + routingScreenshot);

    // Check effects loop switch state
    const effectsSwitch = page.locator('button[role="switch"]').first();
    const switchState = await effectsSwitch.getAttribute('data-state');
    console.log('Effects loop switch state: ' + switchState);

    // Enable effects loop if not already
    if (switchState !== 'checked') {
      console.log('\n=== ENABLING EFFECTS LOOP ===');
      await effectsSwitch.click();
      await page.waitForTimeout(2000);
    }

    // Extract cable data
    console.log('\n=== EXTRACTING CABLE DATA ===');
    const cableData = await page.evaluate(() => {
      const cables = [];
      const paths = document.querySelectorAll('path[stroke]');
      paths.forEach((p, idx) => {
        const stroke = p.getAttribute('stroke');
        const d = p.getAttribute('d');
        if (d && d.includes('M') && stroke && !stroke.includes('none')) {
          // Parse path to get start/end points
          const matches = d.match(/M\s*([\d.]+)[,\s]+([\d.]+)/);
          const lMatches = d.match(/L\s*([\d.]+)[,\s]+([\d.]+)/g);
          cables.push({
            index: idx,
            stroke: stroke,
            startPoint: matches ? { x: parseFloat(matches[1]), y: parseFloat(matches[2]) } : null,
            pathLength: lMatches ? lMatches.length + 1 : 1,
            isRed: stroke.includes('#ef4444') || stroke.includes('red') || stroke.includes('#f87171')
          });
        }
      });
      return cables.filter(c => c.startPoint);
    });

    console.log('Total cables found: ' + cableData.length);
    const redCables = cableData.filter(c => c.isRed);
    console.log('Red cables: ' + redCables.length);
    if (redCables.length > 0) {
      console.log('Red cable details:');
      redCables.forEach(c => {
        console.log('  Cable ' + c.index + ': stroke=' + c.stroke + ', start=(' +
          (c.startPoint ? c.startPoint.x.toFixed(0) + ',' + c.startPoint.y.toFixed(0) : 'unknown') + ')');
      });
    }

    // Extract pedal positions and their locations
    console.log('\n=== PEDAL LOCATIONS ===');
    const pedalInfo = await page.evaluate(() => {
      const info = [];
      const groups = document.querySelectorAll('g.pedal');
      groups.forEach(g => {
        const texts = g.querySelectorAll('text');
        const rect = g.querySelector('rect');
        let name = texts[0]?.textContent || 'Unknown';
        let chainPos = '?';
        texts.forEach(t => {
          const txt = t.textContent?.trim();
          if (txt && /^\d+$/.test(txt)) chainPos = txt;
        });
        const x = rect ? parseFloat(rect.getAttribute('x') || '0') : 0;
        const y = rect ? parseFloat(rect.getAttribute('y') || '0') : 0;
        info.push({ name, chainPos, x: Math.round(x), y: Math.round(y) });
      });
      return info.sort((a, b) => parseInt(a.chainPos) - parseInt(b.chainPos));
    });

    pedalInfo.forEach(p => {
      console.log('  Chain ' + p.chainPos + ': ' + p.name + ' at (' + p.x + ', ' + p.y + ')');
    });

    // Check for amp send/return connections
    console.log('\n=== AMP CONNECTIONS ===');
    const ampGroup = await page.evaluate(() => {
      const ampEl = document.querySelector('g.amp');
      if (!ampEl) return null;
      const transform = ampEl.getAttribute('transform');
      const circles = ampEl.querySelectorAll('circle');
      const jackPositions = [];
      circles.forEach(c => {
        const cx = parseFloat(c.getAttribute('cx') || '0');
        const cy = parseFloat(c.getAttribute('cy') || '0');
        jackPositions.push({ cx, cy });
      });
      return { transform, jacks: jackPositions };
    });

    if (ampGroup) {
      console.log('Amp transform: ' + ampGroup.transform);
      console.log('Amp jacks: ' + JSON.stringify(ampGroup.jacks));
    } else {
      console.log('No amp element found');
    }

    // Take final screenshot
    const finalScreenshot = path.join(__dirname, '../screenshots/4cable-debug-' + Date.now() + '.png');
    await page.screenshot({ path: finalScreenshot, fullPage: false });
    console.log('\nFinal screenshot: ' + finalScreenshot);

  } catch (error) {
    console.error('Error: ' + error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main();
