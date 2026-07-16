const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const altPath = '/Users/jlawrence/Desktop/DEV/pedal-schema/.env.local';
  if (fs.existsSync(altPath)) {
    const content = fs.readFileSync(altPath, 'utf8');
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

  // Capture optimizer logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[OPTIMIZER]')) {
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

    await page.goto('http://localhost:3000' + href + '?debug=optimizer');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // ENABLE effects loop
    console.log('=== ENABLING EFFECTS LOOP ===');
    const routingTab = page.getByRole('tab', { name: /routing/i });
    if (await routingTab.isVisible()) {
      await routingTab.click();
      await page.waitForTimeout(500);

      const effectsSwitch = page.locator('button[role="switch"]').first();
      if (await effectsSwitch.isVisible()) {
        const state = await effectsSwitch.getAttribute('data-state');
        if (state !== 'checked') {
          await effectsSwitch.click();
          await page.waitForTimeout(1000);
          console.log('Effects loop enabled');
        } else {
          console.log('Effects loop already enabled');
        }
      }
    }

    // Click optimize
    console.log('\n=== CLICKING OPTIMIZE ===');
    const optimizeBtn = page.getByRole('button', { name: /optimize/i });
    await optimizeBtn.click();
    await page.waitForTimeout(4000);

    // Extract positions
    const positions = await page.evaluate(() => {
      const pedalGroups = document.querySelectorAll('g.pedal');
      const results = [];
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
        results.push({
          name: texts[0]?.textContent || 'Unknown',
          chainPosition: parseInt(chainPos),
          centerX: Math.round(x + width/2)
        });
      });
      return results.sort((a, b) => a.chainPosition - b.chainPosition);
    });

    console.log('\n=== FINAL POSITIONS (Effects Loop Enabled) ===');
    positions.forEach(p => console.log('  Chain ' + p.chainPosition + ': ' + p.name + ' at centerX=' + p.centerX));

    // Check for red cables
    const redCables = await page.evaluate(() => {
      const paths = document.querySelectorAll('path');
      let redCount = 0;
      paths.forEach(p => {
        const stroke = p.getAttribute('stroke');
        if (stroke && (stroke.includes('#ef4444') || stroke.includes('red'))) {
          redCount++;
        }
      });
      return redCount;
    });
    console.log('\n=== CABLE CHECK ===');
    console.log('Red cables found: ' + redCables);

    // Take screenshot
    const outputPath = '/Users/jlawrence/Desktop/DEV/pedal-schema/.claude/screenshots/effects-loop-' + Date.now() + '.png';
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log('Screenshot: ' + outputPath);

  } catch (error) {
    console.error('Error: ' + error.message);
  } finally {
    await browser.close();
  }
}

main();
