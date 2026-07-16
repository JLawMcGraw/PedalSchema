#!/usr/bin/env node
/**
 * Extract pedal positions after optimization for mathematical verification
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

async function extractPedalPositions(page) {
  return await page.evaluate(() => {
    // Find all pedal groups - they have class "pedal"
    const pedalGroups = document.querySelectorAll('g.pedal');
    const positions = [];
    
    pedalGroups.forEach(g => {
      // Get the main rect (first rect is shadow if dragging, or the pedal body)
      const rects = g.querySelectorAll('rect');
      const mainRect = rects.length > 0 ? rects[0] : null;
      
      if (!mainRect) return;
      
      // Get pedal name from first text element
      const texts = g.querySelectorAll('text');
      const nameText = texts[0]?.textContent || 'Unknown';
      
      // Get chain position from the circle badge text (last text element with a number)
      let chainPos = '?';
      texts.forEach(t => {
        const txt = t.textContent?.trim();
        if (txt && /^\d+$/.test(txt)) {
          chainPos = txt;
        }
      });
      
      // Get rect coordinates from attributes
      const x = parseFloat(mainRect.getAttribute('x') || '0');
      const y = parseFloat(mainRect.getAttribute('y') || '0');
      const width = parseFloat(mainRect.getAttribute('width') || '0');
      const height = parseFloat(mainRect.getAttribute('height') || '0');
      
      positions.push({
        name: nameText,
        chainPosition: chainPos,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        centerX: Math.round(x + width/2),
        rightEdge: Math.round(x + width)
      });
    });
    
    // Sort by chain position
    return positions.sort((a, b) => parseInt(a.chainPosition) - parseInt(b.chainPosition));
  });
}

async function main() {
  loadEnv();
  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

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

    // Extract BEFORE optimization positions
    console.log('=== BEFORE OPTIMIZATION ===');
    const beforePositions = await extractPedalPositions(page);
    
    console.log(`Found ${beforePositions.length} pedals:`);
    beforePositions.forEach(p => {
      console.log(`  Chain ${p.chainPosition}: ${p.name} x=${p.x}, rightEdge=${p.rightEdge}, centerX=${p.centerX}`);
    });

    // Click Optimize Layout button
    console.log('\n=== CLICKING OPTIMIZE ===');
    const optimizeBtn = page.getByRole('button', { name: /optimize/i });
    await optimizeBtn.click();
    await page.waitForTimeout(4000);

    // Extract AFTER optimization positions
    console.log('\n=== AFTER OPTIMIZATION ===');
    const afterPositions = await extractPedalPositions(page);
    
    console.log(`Found ${afterPositions.length} pedals:`);
    afterPositions.forEach(p => {
      console.log(`  Chain ${p.chainPosition}: ${p.name} x=${p.x}, rightEdge=${p.rightEdge}, centerX=${p.centerX}`);
    });

    // VERIFICATION: Signal Flow Order Analysis
    console.log('\n=== VERIFICATION: SIGNAL FLOW ORDER ===');
    if (afterPositions.length >= 2) {
      // Sort by X position (descending = rightmost first)
      const byX = [...afterPositions].sort((a, b) => b.centerX - a.centerX);
      
      console.log('Pedals sorted by X position (rightmost to leftmost):');
      byX.forEach((p, i) => {
        console.log(`  ${i + 1}. Chain ${p.chainPosition} (${p.name}): centerX=${p.centerX}`);
      });
      
      // Check correlation between chain position and X position
      // Lower chain position should have higher X (more right = closer to guitar)
      console.log('\n=== CORRELATION CHECK ===');
      let correctOrder = 0;
      let totalPairs = 0;
      
      for (let i = 0; i < afterPositions.length; i++) {
        for (let j = i + 1; j < afterPositions.length; j++) {
          const p1 = afterPositions[i];
          const p2 = afterPositions[j];
          totalPairs++;
          
          // p1 has lower chain position, so should have higher X
          if (p1.centerX >= p2.centerX) {
            correctOrder++;
          } else {
            console.log(`  ✗ Chain ${p1.chainPosition} (x=${p1.centerX}) is LEFT of Chain ${p2.chainPosition} (x=${p2.centerX})`);
          }
        }
      }
      
      console.log(`\nSignal flow correctness: ${correctOrder}/${totalPairs} pairs (${Math.round(correctOrder/totalPairs*100)}%)`);
      
      // Check first vs last
      const first = afterPositions.find(p => p.chainPosition === '1');
      const last = afterPositions[afterPositions.length - 1];
      const rightmost = byX[0];
      const leftmost = byX[byX.length - 1];
      
      console.log(`\nFirst pedal (Chain 1): ${first?.name} at x=${first?.centerX}`);
      console.log(`Rightmost pedal: ${rightmost.name} (Chain ${rightmost.chainPosition}) at x=${rightmost.centerX}`);
      console.log(`Last pedal (Chain ${last.chainPosition}): ${last.name} at x=${last.centerX}`);
      console.log(`Leftmost pedal: ${leftmost.name} (Chain ${leftmost.chainPosition}) at x=${leftmost.centerX}`);
      
      if (first && first.centerX >= rightmost.centerX - 30) {
        console.log('\n✓ PASS: First pedal in chain is rightmost (closest to guitar)');
      } else {
        console.log('\n✗ FAIL: First pedal is NOT rightmost');
      }
      
      if (last.centerX <= leftmost.centerX + 30) {
        console.log('✓ PASS: Last pedal in chain is leftmost (closest to amp)');
      } else {
        console.log('✗ FAIL: Last pedal is NOT leftmost');
      }
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main();
