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

  // Capture all optimizer debug logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[OPTIMIZER]') || text.includes('[FIND]')) {
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
    
    const debugUrl = `http://localhost:3000${href}?debug=optimizer`;
    console.log('Navigating to:', debugUrl);
    await page.goto(debugUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Disable effects loop
    const routingTab = page.getByRole('tab', { name: /routing/i });
    if (await routingTab.isVisible()) {
      await routingTab.click();
      await page.waitForTimeout(500);
      const effectsSwitch = page.locator('button[role="switch"]').first();
      if (await effectsSwitch.isVisible()) {
        const state = await effectsSwitch.getAttribute('data-state');
        if (state === 'checked') {
          await effectsSwitch.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    console.log('\n=== CLICKING OPTIMIZE ===\n');
    const optimizeBtn = page.getByRole('button', { name: /optimize/i });
    await optimizeBtn.click();
    await page.waitForTimeout(4000);

    const afterPositions = await page.evaluate(() => {
      const pedalGroups = document.querySelectorAll('g.pedal');
      const positions = [];
      pedalGroups.forEach(g => {
        const rects = g.querySelectorAll('rect');
        const mainRect = rects[0];
        if (!mainRect) return;
        const texts = g.querySelectorAll('text');
        let chainPos = '?';
        texts.forEach(t => {
          const txt = t.textContent?.trim();
          if (txt && /^\d+$/.test(txt)) chainPos = txt;
        });
        const x = parseFloat(mainRect.getAttribute('x') || '0');
        const width = parseFloat(mainRect.getAttribute('width') || '0');
        positions.push({
          name: texts[0]?.textContent || 'Unknown',
          chainPosition: parseInt(chainPos),
          centerX: Math.round(x + width/2)
        });
      });
      return positions.sort((a, b) => a.chainPosition - b.chainPosition);
    });
    
    console.log('\n=== FINAL POSITIONS ===');
    afterPositions.forEach(p => console.log(`  Chain ${p.chainPosition}: ${p.name} at centerX=${p.centerX}`));

    console.log('\n=== VERIFICATION ===');
    let allCorrect = true;
    for (let i = 0; i < afterPositions.length - 1; i++) {
      const current = afterPositions[i];
      const next = afterPositions[i + 1];
      if (current.centerX <= next.centerX) {
        console.log(`✗ Chain ${current.chainPosition} (x=${current.centerX}) should be RIGHT of Chain ${next.chainPosition} (x=${next.centerX})`);
        allCorrect = false;
      }
    }
    if (allCorrect) console.log('✓ ALL PEDALS IN CORRECT SIGNAL FLOW ORDER');

  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    await browser.close();
  }
}

main();
