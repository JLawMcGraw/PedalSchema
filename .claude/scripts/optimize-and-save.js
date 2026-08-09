#!/usr/bin/env node
/**
 * Run Optimize on a saved board and PERSIST the result, through the real UI.
 *
 * verify-optimize.js proves Optimize runs on the worker and settles; it never
 * saves, so nothing has ever exercised optimize-then-persist end to end on a
 * dense board. That is the path a real user takes, and the one where a 22-pedal
 * board is most likely to find something: the chain-position uniqueness
 * constraint had to be made DEFERRABLE (20260801000005) precisely because a
 * whole-chain upsert collides mid-statement, and a re-ordered dense board is
 * exactly what triggers it.
 *
 * Saving goes through the toolbar button rather than a store hook on purpose -
 * handleSave prunes before it upserts, and a hook that skipped the button would
 * skip the ordering that made the reorder saveable.
 *
 * Reports placements and cable strategies before and after, and re-reads the
 * database to prove the write landed.
 *
 * Usage: node .claude/scripts/optimize-and-save.js "<config name>" [--dry-run]
 */
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
// Shared with every other verification script: BASE_URL honours $BASE_URL and
// defaults to :3000, and login uses VERIFY_EMAIL / VERIFY_PASSWORD. Reusing it
// rather than re-deriving a URL is why this does not read NEXT_PUBLIC_SITE_URL,
// which points at a different port.
const { loadEnv, login, BASE_URL } = require('./lib/twin');

loadEnv();

const BUDGET_MS = 60000;
const NAME = process.argv[2] || 'test';
const DRY = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const snap = () => {
  const s = window.__getPedalSchemaSnapshot();
  const tally = {};
  for (const c of s.cables) tally[c.strategy] = (tally[c.strategy] || 0) + 1;
  return {
    tally,
    invalid: s.cables.filter((c) => !c.valid).length,
    positions: s.pedals
      .map((p) => `${p.id}:${p.xInches.toFixed(2)},${p.yInches.toFixed(2)},${p.rotationDegrees}`)
      .sort(),
  };
};

(async () => {
  const { data: cfgs, error: cfgErr } = await supabase
    .from('configurations').select('id,name');
  if (cfgErr) { console.error('Could not list configurations:', cfgErr.message); process.exit(1); }
  const cfg = cfgs.find((c) => c.name === NAME);
  if (!cfg) {
    console.error(`No configuration named "${NAME}". Have: ${cfgs.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  const dbPositions = async () => {
    const { data, error } = await supabase
      .from('configuration_pedals')
      .select('id,x_inches,y_inches,rotation_degrees,chain_position')
      .eq('configuration_id', cfg.id);
    if (error) { console.error('DB read failed:', error.message); process.exit(1); }
    return data
      .map((r) => `${r.id}:${r.x_inches},${r.y_inches},${r.rotation_degrees},${r.chain_position}`)
      .sort();
  };

  const dbBefore = await dbPositions();

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  let failed = false;
  try {
    await login(page);
    await page.goto(`${BASE_URL}/editor/${cfg.id}`);
    await page.waitForFunction(
      () => !!window.__getPedalSchemaSnapshot && window.__getPedalSchemaSnapshot().pedals.length > 0,
      null, { timeout: 30000 }
    );

    const before = await page.evaluate(snap);
    console.log(`CONFIG  ${cfg.name}  (${before.positions.length} pedals)`);
    console.log(`BEFORE  strategies ${JSON.stringify(before.tally)}  invalid=${before.invalid}`);

    const outcome = await page.evaluate((budget) => {
      const t = performance.now();
      return Promise.race([
        window.__pedalSchemaOptimize().then(() => ({ done: true, ms: performance.now() - t })),
        new Promise((r) => setTimeout(() => r({ done: false, ms: budget }), budget)),
      ]);
    }, BUDGET_MS).catch((e) => ({ done: false, error: String(e) }));

    if (!outcome.done) {
      console.log(`  FAIL  Optimize did not settle within ${BUDGET_MS}ms${outcome.error ? ': ' + outcome.error : ''}`);
      failed = true;
    } else {
      console.log(`  optimize settled in ${outcome.ms.toFixed(0)}ms`);
    }

    const after = await page.evaluate(snap);
    const moved = after.positions.filter((p, i) => p !== before.positions[i]).length;
    console.log(`AFTER   strategies ${JSON.stringify(after.tally)}  invalid=${after.invalid}`);
    console.log(`        ${moved} of ${after.positions.length} placements changed`);

    if (after.invalid > before.invalid) {
      console.log(`  FAIL  optimize INCREASED unroutable cables ${before.invalid} -> ${after.invalid}`);
      failed = true;
    }

    if (DRY) {
      console.log('\n(dry run - not saved)');
    } else {
      const saveBtn = page.getByRole('button', { name: /^Save$/ });
      if (await saveBtn.isDisabled()) {
        console.log('\n  Save is disabled - nothing changed, so nothing to persist.');
      } else {
        await saveBtn.click();
        await page.waitForFunction(
          () => !document.body.innerText.includes('Saving...'),
          null, { timeout: 30000 }
        );
        if (/Save failed/i.test(await page.innerText('body'))) {
          console.log('  FAIL  the toolbar reports "Save failed"');
          failed = true;
        }
        await page.waitForTimeout(1200);

        const dbAfter = await dbPositions();
        const dbMoved = dbAfter.filter((r, i) => r !== dbBefore[i]).length;
        console.log(`\nDB      ${dbMoved} of ${dbAfter.length} rows changed on disk`);
        if (moved > 0 && dbMoved === 0) {
          console.log('  FAIL  the layout moved on screen but nothing persisted');
          failed = true;
        }
      }
    }

    if (pageErrors.length) {
      console.log(`\n  FAIL  ${pageErrors.length} page error(s):`);
      for (const e of pageErrors.slice(0, 5)) console.log(`    ${e}`);
      failed = true;
    }
  } finally {
    await browser.close();
  }

  console.log(failed ? '\nFAIL' : DRY ? '\nPASS - optimized (dry run, nothing written)' : '\nPASS - optimized and persisted');
  process.exitCode = failed ? 1 : 0;
})();
