/**
 * Debug Fixture Test Script
 *
 * Creates a test configuration with 8-12 pedals that exercises:
 * - FX loop enabled with modulationInLoop = true
 * - Dense pedal placement to trigger cable routing issues
 * - Mix of front-of-amp and effects loop pedals
 *
 * Usage: node .claude/scripts/test-fixture.js
 */

const { chromium } = require('playwright');

const FIXTURE_CONFIG = {
  // Simulated pedal configuration for testing
  // This matches what would be stored in the database
  pedals: [
    // Front of amp chain (right to left toward amp input)
    { name: 'TU-3', category: 'tuner', chainPosition: 1 },
    { name: 'CS-3', category: 'compressor', chainPosition: 2 },
    { name: 'SD-1', category: 'overdrive', chainPosition: 3 },
    { name: 'DS-1', category: 'distortion', chainPosition: 4 },
    { name: 'NS-2', category: 'noise_gate', chainPosition: 5 },
    // Effects loop chain (after amp preamp)
    { name: 'CE-5', category: 'modulation', chainPosition: 6, location: 'effects_loop' },
    { name: 'BF-3', category: 'modulation', chainPosition: 7, location: 'effects_loop' },
    { name: 'DD-8', category: 'delay', chainPosition: 8, location: 'effects_loop' },
    { name: 'RV-6', category: 'reverb', chainPosition: 9, location: 'effects_loop' },
  ],
  settings: {
    useEffectsLoop: true,
    modulationInLoop: true,
  }
};

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'log' || type === 'warn' || type === 'error') {
      console.log(`[BROWSER ${type.toUpperCase()}]`, msg.text());
    }
  });

  // Navigate to editor with debug flags
  const url = 'http://localhost:3000/editor/new?debug=optimizer&debug=cables';
  console.log(`Opening ${url}`);
  await page.goto(url);

  // Wait for the editor to load
  await page.waitForSelector('svg', { timeout: 10000 });
  console.log('Editor loaded');

  // Wait a bit for initial render
  await page.waitForTimeout(2000);

  // Take initial screenshot
  const screenshotPath = `.claude/scripts/fixture-initial.png`;
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Screenshot saved to ${screenshotPath}`);

  // Extract current state for analysis
  const state = await page.evaluate(() => {
    // Try to access Zustand store
    const storeData = window.__ZUSTAND_STORE_DATA__;
    if (storeData) {
      return {
        placedPedals: storeData.placedPedals,
        cables: storeData.cables,
      };
    }
    return { error: 'Store not accessible' };
  });

  console.log('\n=== Current State ===');
  console.log(JSON.stringify(state, null, 2));

  // Keep browser open for manual inspection
  console.log('\nBrowser open for inspection. Press Ctrl+C to close.');

  // Wait indefinitely (user can close manually)
  await new Promise(() => {});
}

main().catch(console.error);
