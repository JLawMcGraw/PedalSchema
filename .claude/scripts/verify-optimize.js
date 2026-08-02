#!/usr/bin/env node
/**
 * Optimize actually runs, in a real browser, on the worker.
 *
 * The engine suite cannot see this. Every test, the saved-board fingerprint
 * and the router-parity cases all run the engine in Node, where `window`
 * genuinely does not exist and a `typeof window` guard behaves. The optimizer
 * ships inside a Web Worker, which is built as a CLIENT bundle - so bundlers
 * fold that guard to `true` and the window access throws. See
 * src/lib/engine/debug-flag.ts.
 *
 * That has now bitten twice:
 *
 *  - Once as a throw inside onmessage. The worker's try/catch posted it back,
 *    runOptimize fell back inline, and the feature still worked - so the whole
 *    point of moving Optimize off the main thread was SILENTLY lost.
 *  - Once (2026-08-02, after P1.5 pulled cables/route-cables into the worker's
 *    module graph) as a module-level const. That throws during evaluation,
 *    before self.onmessage is assigned, so no handler ever exists: the message
 *    is never answered, worker.onerror never reaches the pending map, the
 *    promise never settles, and the button spins forever.
 *
 * So this checks three separate things, because each failed independently:
 *   1. the run SETTLES inside a budget          (catches the hang)
 *   2. NOTHING fell back inline                 (catches the silent degradation)
 *   3. no page errors                           (catches the throw itself)
 *
 * `src/lib/engine/__tests__/worker-safety.test.ts` guards the same class
 * statically, over the worker's import graph, and runs in CI. This one proves
 * the real thing works. Keep both: the static test is fast and catches the
 * known pattern; this catches whatever the next mechanism turns out to be.
 *
 * Usage: node .claude/scripts/verify-optimize.js [configId]
 */
const { chromium } = require('playwright');
const { loadEnv, login, BASE_URL } = require('./lib/twin');

/** Generous: a 20-pedal board measures ~200ms. This is a hang detector. */
const BUDGET_MS = 20000;

async function optimizeOnce(page, href) {
  await page.goto(BASE_URL + href);
  await page.waitForFunction(
    () => !!window.__getPedalSchemaSnapshot && window.__getPedalSchemaSnapshot().pedals.length > 0,
    null, { timeout: 30000 }
  );

  const before = await page.evaluate(() => {
    const s = window.__getPedalSchemaSnapshot();
    const tally = {};
    for (const c of s.cables) tally[c.strategy] = (tally[c.strategy] || 0) + 1;
    return {
      pedals: s.pedals.length,
      board: s.board && `${s.board.name} ${s.board.widthInches}x${s.board.depthInches}`,
      cables: s.cables.length,
      tally,
    };
  });

  const outcome = await page.evaluate((budget) => {
    const started = performance.now();
    return Promise.race([
      window.__pedalSchemaOptimize().then(() => ({ done: true, ms: performance.now() - started })),
      new Promise((r) => setTimeout(() => r({ done: false, ms: budget }), budget)),
    ]);
  }, BUDGET_MS).catch((e) => ({ done: false, error: String(e) }));

  const after = await page.evaluate(() => {
    const s = window.__getPedalSchemaSnapshot();
    const tally = {};
    for (const c of s.cables) tally[c.strategy] = (tally[c.strategy] || 0) + 1;
    return { tally, headline: s.lastOptimization && s.lastOptimization.headline };
  }).catch(() => ({ tally: {}, headline: null }));

  return { before, outcome, after };
}

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());

  const pageErrors = [];
  const inlineFallbacks = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (/worker failed, running inline/i.test(m.text())) inlineFallbacks.push(m.text());
  });

  let failures = 0;
  try {
    await login(page);

    let hrefs;
    if (process.argv[2]) {
      hrefs = ['/editor/' + process.argv[2]];
    } else {
      await page.goto(BASE_URL + '/dashboard');
      await page.waitForLoadState('networkidle');
      hrefs = await page.$$eval(
        'a[href^="/editor/"]:not([href="/editor/new"])',
        (as) => [...new Set(as.map((a) => a.getAttribute('href')))]
      );
    }

    for (const href of hrefs) {
      const { before, outcome, after } = await optimizeOnce(page, href);
      if (!before.pedals) continue;

      console.log(`\n${before.board}  -  ${before.pedals} pedals, ${before.cables} cables`);

      if (outcome.error) {
        console.log(`  FAIL  optimize threw: ${outcome.error}`);
        failures++;
      } else if (!outcome.done) {
        console.log(`  FAIL  never settled within ${BUDGET_MS}ms - the worker is not replying`);
        failures++;
      } else {
        console.log(`  PASS  settled in ${Math.round(outcome.ms)}ms`);
        console.log(`        ${after.headline ?? '(no summary)'}`);
      }

      // Lane adoption, before -> after. Not an assertion: it is the diagnostic
      // for the assignLanes cliff (a board that drops to ~0 lane-router cables
      // has hit the all-or-nothing fallback). See .claude/docs/8-2-next.md P6.
      const lanes = (t) => t['lane-router'] ?? 0;
      console.log(`        lane-router cables: ${lanes(before.tally)} -> ${lanes(after.tally)}`);
      console.log(`        after: ${JSON.stringify(after.tally)}`);
    }

    if (inlineFallbacks.length) {
      console.log(`\nFAIL  Optimize fell back to the main thread ${inlineFallbacks.length}x:`);
      inlineFallbacks.forEach((l) => console.log('      ' + l));
      console.log('      The worker is broken. The feature still "works" and the');
      console.log('      editor freezes during every run - this is the silent mode.');
      failures++;
    }
    if (pageErrors.length) {
      console.log(`\nFAIL  ${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 10).forEach((m) => console.log('      ' + m));
      failures++;
    }

    console.log(failures === 0
      ? '\nPASS - Optimize runs on the worker, settles, and never falls back inline'
      : `\nFAIL - ${failures} problem(s)`);
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
