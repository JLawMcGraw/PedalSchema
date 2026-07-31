#!/usr/bin/env node
/**
 * Dump a configuration's exact store state to a JSON file, so the engine can
 * be replayed offline against precisely what the app had.
 * Usage: node .claude/scripts/dump-state.js [configId] [outFile]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const { loadEnv, login, BASE_URL } = require('./lib/twin');
(async () => {
  loadEnv();
  const out = process.argv[3] || '/tmp/livestate.json';
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } }).then(c => c.newPage());
  try {
    await login(page);
    let href = process.argv[2] ? '/editor/' + process.argv[2] : null;
    if (!href) {
      await page.goto(BASE_URL + '/dashboard');
      await page.waitForLoadState('networkidle');
      const hrefs = await page.$$eval('a[href^="/editor/"]:not([href="/editor/new"])',
        as => [...new Set(as.map(a => a.getAttribute('href')))]);
      // pick the config with the most pedals
      let best = null;
      for (const h of hrefs) {
        await page.goto(BASE_URL + h);
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => typeof window.__getPedalSchemaState === 'function');
        const st = await page.evaluate(() => window.__getPedalSchemaState());
        if (!best || st.placedPedals.length > best.st.placedPedals.length) best = { h, st };
      }
      fs.writeFileSync(out, JSON.stringify(best.st, null, 1));
      console.log(`${best.h}: ${best.st.placedPedals.length} pedals -> ${out}`);
      return;
    }
    await page.goto(BASE_URL + href);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => typeof window.__getPedalSchemaState === 'function');
    const st = await page.evaluate(() => window.__getPedalSchemaState());
    fs.writeFileSync(out, JSON.stringify(st, null, 1));
    console.log(`${href}: ${st.placedPedals.length} pedals -> ${out}`);
  } finally { await browser.close(); }
})();
