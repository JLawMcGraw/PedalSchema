#!/usr/bin/env node
/**
 * Does the editor give back the board it was given?
 *
 * On 2026-08-10 it did not, and nothing noticed for as long as the bug
 * existed. `applyDefaultOrdering` had a non-total comparator, so pedals whose
 * category sort keys tied were left in whatever order the PostgREST embed
 * happened to return - and the app rendered a chain the database did not hold.
 * Two cables went unroutable as a result.
 *
 * Every gate that existed missed it, and they missed it for the same reason:
 * none of them completed a ROUND TRIP.
 *
 *   saved-board-fingerprint   replays the database through the engine, and
 *                             sorts its input by chainPosition on the way in -
 *                             supplying the determinism the app lacked
 *   verify-optimize           drives the real UI, but never reloads
 *   verify-save-reorder       covers the DEFERRABLE constraint on the WRITE,
 *                             not what comes back on the next read
 *
 * So this checks the two halves nothing else does:
 *
 *   READ   what the editor shows == what the rows say, and it is not dirty
 *   WRITE  pressing Save with no edits changes neither the rows nor the
 *          geometry - the half where an ordering bug on the way OUT would live
 *
 * The write half really does write. It is the only way to test a save, and a
 * no-edit save is what a user does constantly. Take a backup first if you are
 * running this against anything you care about; `--read-only` skips it.
 *
 * Usage:
 *   node .claude/scripts/verify-round-trip.js
 *   node .claude/scripts/verify-round-trip.js --read-only
 */
const { chromium } = require('playwright');
const { loadEnv, login, BASE_URL, waitForCanvas, dragPedalByInches } = require('./lib/twin');
const { createClient } = require('@supabase/supabase-js');

const READ_ONLY = process.argv.includes('--read-only');

const fail = [];
const check = (ok, msg) => {
  if (!ok) fail.push(msg);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

/** The fields a save round-trips. Compared as a whole, not field by field. */
const ROW_KEYS = [
  'id', 'pedal_id', 'x_inches', 'y_inches', 'rotation_degrees', 'chain_position',
  'location', 'chain_position_locked', 'rotation_locked', 'is_active', 'use_loop',
];

const rowSig = (r) =>
  ROW_KEYS.map((k) => `${k}=${JSON.stringify(r[k] ?? null)}`).join(' ');

async function storedRows(sb, configId) {
  const { data, error } = await sb
    .from('configuration_pedals')
    .select('*')
    .eq('configuration_id', configId);
  // Check `error`, not just `data`. Reading `data?.length ?? 0` on a failed
  // query reports a broken query as a measured zero - the exact trap this
  // project hit on 2026-08-08 and then rebuilt inside the tool checking it.
  if (error) throw new Error(`configuration_pedals read failed: ${error.message}`);
  return new Map(data.map((r) => [r.id, r]));
}

/** Everything the canvas derives, in a form two runs can be compared on. */
async function readDerived(page) {
  return page.evaluate(() => {
    const s = window.__getPedalSchemaState();
    const d = window.__getPedalSchemaDerived();
    const snap = window.__getPedalSchemaSnapshot();
    return {
      isDirty: snap.isDirty,
      saveError: snap.saveError,
      chain: s.placedPedals.map((p) => [p.id, p.chainPosition]),
      positions: s.placedPedals.map((p) => [p.id, p.xInches, p.yInches]),
      geometry: d.routedCables.map((rc) =>
        `${rc.strategy}|${rc.valid}|${rc.path.map((pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`).join(' ')}`
      ),
      invalid: d.routedCables.filter((rc) => !rc.valid).length,
    };
  });
}

(async () => {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: configs, error } = await sb.from('configurations').select('id,name');
  if (error) { console.error('configurations read failed:', error.message); process.exit(1); }

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1100 } }).then((c) => c.newPage());
  try {
    await login(page);

    for (const config of configs) {
      console.log(`\n${config.name}  (${config.id.slice(0, 8)})`);

      // --- READ half --------------------------------------------------------
      const before = await storedRows(sb, config.id);
      await page.goto(`${BASE_URL}/editor/${config.id}`);
      await page.waitForLoadState('networkidle');
      await waitForCanvas(page);
      const loaded = await readDerived(page);

      console.log(`  ${before.size} pedals, ${loaded.geometry.length} cables, ${loaded.invalid} unroutable`);

      check(loaded.isDirty === false,
        'clean on load - loading alone marked nothing changed');

      const drift = loaded.chain.filter(([id, pos]) => before.get(id)?.chain_position !== pos);
      check(drift.length === 0,
        `every chainPosition matches its row (${drift.length} of ${loaded.chain.length} drifted)` +
        (drift.length ? ': ' + drift.map(([id, p]) => `${id.slice(0, 8)} shows ${p}, row says ${before.get(id)?.chain_position}`).join(', ') : ''));

      if (READ_ONLY) continue;

      // --- WRITE half -------------------------------------------------------
      // A real drag, then save, then reload. The edit does not need to be zero
      // - it needs to be KNOWN, so that what comes back can be compared with
      // what was on screen when Save was pressed. That is the half an ordering
      // bug on the way OUT would live in, and the half nothing else covers.
      //
      // The original rows are put back from the snapshot taken above before
      // this script exits, so it is re-runnable and leaves no trace.
      // An empty configuration is a BOARD, not an error - the owner can make
      // one and leave it, and "dadfad" (created 2026-08-14) is exactly that.
      // There is no pedal to drag, so the write half has nothing to say; it
      // used to index [0] of an empty list and die on `undefined.id`, failing
      // the whole gate over a board that was fine. The same fix verify-optimize
      // needed, for the same reason.
      const target = [...before.values()][0];
      if (!target) {
        console.log('  ----  no pedals to drag; write half skipped');
        continue;
      }
      await dragPedalByInches(page, target.id, 0.25, 0);

      const edited = await readDerived(page);
      check(edited.isDirty === true, 'a drag marks the board dirty');

      await page.locator('button:has-text("Save")').first().click();
      await page.waitForFunction(
        () => window.__getPedalSchemaSnapshot().isDirty === false ||
              window.__getPedalSchemaSnapshot().saveError !== null,
        { timeout: 20000 }
      );
      const saved = await readDerived(page);
      check(saved.saveError === null, `save reported no error (${saved.saveError ?? 'none'})`);

      await page.goto(`${BASE_URL}/editor/${config.id}`);
      await page.waitForLoadState('networkidle');
      await waitForCanvas(page);
      const reloaded = await readDerived(page);

      check(reloaded.isDirty === false, 'clean after reloading a board that was just saved');
      check(JSON.stringify(reloaded.chain) === JSON.stringify(edited.chain),
        'the chain order that was saved is the chain order that comes back');
      /*
       * POSITIONS, AT STORAGE PRECISION - not the geometry.
       *
       * Comparing `edited.geometry` to `reloaded.geometry` cannot hold, and
       * failed intermittently for as long as this check existed. x_inches is
       * DECIMAL(5,2); a drag lands wherever the pointer maths puts it, so the
       * in-memory value carries full float precision and the stored one does
       * not. Measured on the `test` board: the drag landed at
       * x=10.732727272727272, Postgres kept 10.73, and that 0.0027in - 0.109px
       * at 40px/in - moved two cable path points across a Math.round boundary
       * (663.509 -> 663.400). 2 of 24 cables "differed". Nothing was wrong.
       *
       * So compare what the database can actually hold. Rounding the saved
       * side to 2dp makes this EXACT rather than tolerant, and nothing is
       * lost: routed geometry is a pure function of position and chain order,
       * and both are now compared exactly - the ordering bug this gate was
       * built for still cannot get past it.
       */
      const q = (n) => Math.round(n * 100) / 100;
      const savedPos = new Map(edited.positions.map(([id, x, y]) => [id, [q(x), q(y)]]));
      const drifted = reloaded.positions.filter(([id, x, y]) => {
        const was = savedPos.get(id);
        return !was || was[0] !== x || was[1] !== y;
      });
      check(
        drifted.length === 0,
        `every position saved is the position that comes back, at storage precision (${drifted.length} of ${reloaded.positions.length} drifted)` +
          (drifted.length
            ? ': ' + drifted.map(([id, x, y]) => `${id.slice(0, 8)} shows ${x},${y}, saved ${savedPos.get(id)}`).join(', ')
            : '')
      );
      check(reloaded.invalid === edited.invalid,
        `unroutable count survives the round trip (${edited.invalid} -> ${reloaded.invalid})`);

      // --- restore ----------------------------------------------------------
      for (const row of before.values()) {
        const { error: upErr } = await sb
          .from('configuration_pedals')
          .update({ x_inches: row.x_inches, y_inches: row.y_inches, chain_position: row.chain_position })
          .eq('id', row.id);
        if (upErr) throw new Error(`restore failed for ${row.id}: ${upErr.message}`);
      }
      const restored = await storedRows(sb, config.id);
      const stillOff = [...before.keys()].filter((id) => rowSig(before.get(id)) !== rowSig(restored.get(id) ?? {}));
      check(stillOff.length === 0,
        `board restored to its pre-test rows (${stillOff.length} still differ)`);
    }

    console.log(fail.length === 0
      ? `\nPASS - every saved board is a fixed point of load, save and reload`
      : `\nFAIL - ${fail.length} check(s) failed`);
  } catch (err) {
    console.error('ERROR:', err.message);
    fail.push(err.message);
  } finally {
    await browser.close();
  }
  process.exit(fail.length === 0 ? 0 : 1);
})();
