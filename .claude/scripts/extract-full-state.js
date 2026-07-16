#!/usr/bin/env node
/**
 * Extract full pedal state including location (front_of_amp vs effects_loop)
 */
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
  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  // Capture console logs for state
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('PEDAL_STATE') || text.includes('LAYOUT_STATE')) {
      console.log(text);
    }
  });

  try {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Go to dashboard and click first config
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const card = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    await card.click();
    await page.waitForURL(url => url.pathname.includes('/editor/') && !url.pathname.includes('/new'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Inject code to extract and log state
    await page.evaluate(() => {
      // Try to access the React state or zustand store
      const root = document.getElementById('__next');
      if (root && root._reactRootContainer) {
        console.log('React root found');
      }
      
      // Look for the store in window or try to find it via React devtools
      // This is a workaround - ideally we'd have a debug endpoint
    });

    // Extract state from the Signal Chain panel on the right
    const chainItems = await page.evaluate(() => {
      // Find chain items in the Signal Chain panel
      const items = [];
      
      // Look for chain items in the panel
      const panel = document.querySelector('[class*="signal-chain"]') || 
                   document.querySelector('.overflow-y-auto');
      
      if (!panel) return items;
      
      const chainEntries = panel.querySelectorAll('[draggable="true"]');
      chainEntries.forEach(entry => {
        const nameEl = entry.querySelector('.font-medium');
        const mfrEl = entry.querySelector('.text-muted-foreground');
        const badge = entry.querySelector('.rounded-full');
        
        items.push({
          name: nameEl?.textContent || 'Unknown',
          manufacturer: mfrEl?.textContent || '',
          position: badge?.textContent || '?'
        });
      });
      
      return items;
    });
    
    console.log('=== SIGNAL CHAIN (from UI panel) ===');
    chainItems.forEach(item => {
      console.log(`  ${item.position}. ${item.name} (${item.manufacturer})`);
    });

    // Try to access effects loop state
    const effectsLoopEnabled = await page.evaluate(() => {
      const switchEl = document.querySelector('button[role="switch"][data-state="checked"]');
      return !!switchEl;
    });
    console.log(`\nEffects loop enabled: ${effectsLoopEnabled}`);
    
    // Disable effects loop for simpler test
    console.log('\n=== DISABLING EFFECTS LOOP ===');
    const routingTab = page.getByRole('tab', { name: /routing/i });
    if (await routingTab.isVisible()) {
      await routingTab.click();
      await page.waitForTimeout(500);
      
      // Find and click the switch to disable
      const effectsSwitch = page.locator('button[role="switch"]').first();
      if (await effectsSwitch.isVisible()) {
        const state = await effectsSwitch.getAttribute('data-state');
        if (state === 'checked') {
          await effectsSwitch.click();
          await page.waitForTimeout(1000);
          console.log('Effects loop disabled');
        }
      }
    }

    // Now test optimizer with simple linear chain
    console.log('\n=== TESTING OPTIMIZER (no effects loop) ===');
    
    // Extract positions BEFORE
    const beforePositions = await page.evaluate(() => {
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
    
    console.log('Before:');
    beforePositions.forEach(p => console.log(`  Chain ${p.chainPosition}: ${p.name} at centerX=${p.centerX}`));

    // Click optimize
    const optimizeBtn = page.getByRole('button', { name: /optimize/i });
    await optimizeBtn.click();
    await page.waitForTimeout(4000);

    // Extract positions AFTER
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
    
    console.log('\nAfter:');
    afterPositions.forEach(p => console.log(`  Chain ${p.chainPosition}: ${p.name} at centerX=${p.centerX}`));

    // Check order
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
    
    if (allCorrect) {
      console.log('✓ ALL PEDALS IN CORRECT SIGNAL FLOW ORDER (right to left)');
    }
    
    // Take screenshot
    const screenshotsDir = path.join(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    const outputPath = path.join(screenshotsDir, `verify-optimizer-${Date.now()}.png`);
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`\nScreenshot: ${outputPath}`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main();
