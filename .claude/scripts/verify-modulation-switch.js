#!/usr/bin/env node
/**
 * Does the Modulation switch actually change the board in the APP?
 *
 * The engine half was proven offline (chain-ordering tests, the config matrix,
 * the saved-board fingerprint). This asks the question those cannot: does the
 * store carry the flag through to the chain, the cables and Optimize, or does
 * it stop somewhere between the panel and the canvas.
 *
 * Reads the TWIN (window.__getPedalSchemaSnapshot / __getPedalSchemaState) -
 * the same derived state the canvas renders - rather than looking at pixels,
 * per CLAUDE.md. A screenshot would only show that something changed, not that
 * the right pedal moved to the right side of the drives.
 *
 * Runs on a throwaway clone of J$ Home and deletes it. J$ Home deliberately:
 * on `test` both modulation pedals are already in the loop in stored data, so
 * the switch is a no-op there in both directions and the board proves nothing.
 *
 * Usage: node .claude/scripts/verify-modulation-switch.js
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login, openEditor } = require('./lib/twin');
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const uuid = () => require('crypto').randomUUID();

const DRIVES = ['overdrive', 'distortion', 'fuzz'];
const MOD = ['modulation', 'tremolo'];

(async () => {
  const { data: src } = await sb.from('configurations').select('*').eq('name', 'J$ Home').single();
  const { data: srcPedals } = await sb.from('configuration_pedals').select('*')
    .eq('configuration_id', src.id).order('chain_position');
  const cfgId = uuid();
  await sb.from('configurations').insert({
    ...src, id: cfgId, name: 'ZZ modulation-switch check', share_slug: null,
    created_at: undefined, updated_at: undefined,
    // The switch only exists when the rig has a usable loop, so the clone is
    // opened with one on. Its stored state is loop=off, which would hide the
    // control the whole check is about.
    use_effects_loop: true, modulation_in_loop: false,
  });
  await sb.from('configuration_pedals').insert(
    srcPedals.map((p) => ({ ...p, id: uuid(), configuration_id: cfgId, created_at: undefined }))
  );

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());
  let fail = 0;
  const check = (ok, label, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`        ${detail}`);
    if (!ok) fail++;
  };

  /** Chain as the app holds it: every pedal's name, category, location, x. */
  const readChain = () => page.evaluate(({ DRIVES, MOD }) => {
    const s = window.__getPedalSchemaState();
    const rows = [...s.placedPedals]
      .sort((a, b) => a.chainPosition - b.chainPosition)
      .map((p) => ({
        name: s.pedalsById[p.pedalId].name,
        category: s.pedalsById[p.pedalId].category,
        location: p.location,
        locked: !!p.chainPositionLocked,
        chainPosition: p.chainPosition,
        x: Math.round(p.xInches * 100) / 100,
        y: Math.round(p.yInches * 100) / 100,
      }));
    const idx = (pred) => rows.findIndex(pred);
    return {
      rows,
      firstDrive: idx((r) => DRIVES.includes(r.category)),
      // The unlocked modulation pedals are the ones the switch may move; a
      // locked one is excluded from rule processing by contract.
      movableMod: rows.filter((r) => MOD.includes(r.category) && !r.locked).map((r) => r.name),
      modIndexes: rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => MOD.includes(r.category) && !r.locked)
        .map(({ r, i }) => ({ name: r.name, i, location: r.location })),
      cables: window.__getPedalSchemaSnapshot().cables.map((c) => `${c.from}->${c.to}`),
      positions: rows.map((r) => `${r.name}@${r.x},${r.y}`).join(' '),
    };
  }, { DRIVES, MOD });

  try {
    await login(page);
    await openEditor(page, cfgId);

    // The routing controls live behind a tab - nothing in the right panel
    // exists until it is selected, which is why an earlier version of this
    // script found zero switches on a page that renders five.
    await page.locator('[data-panel-tab="routing"]').click();
    await page.waitForTimeout(300);

    // Drive the real control, not the store, so this also proves the panel is
    // wired to it. The switch only renders when the rig has a usable loop.
    /*
     * A STABLE HANDLE, not the label text. This used to be
     * `div:has(> div > span:text-is("Modulation")) button[role="switch"]`,
     * which was a bet on both the copy and the DOM shape - and it lost both on
     * 2026-08-20, when the Routing panel went from six bordered cards to one
     * settings list and the row was renamed "Modulation in the loop". Because
     * this gate was not in verify-all.sh, nothing reported the loss.
     */
    const modSwitch = page.locator('button[role="switch"][data-setting="modulation-in-loop"]').first();
    const haveControl = await modSwitch.count();
    check(haveControl > 0, 'the Modulation switch is rendered when the loop is on',
      `switches on the Routing tab: ${await page.locator('button[role="switch"]').count()}`);

    const dirty = await readChain();
    console.log(`\n  movable modulation pedals: ${dirty.movableMod.join(', ') || 'NONE'}`);
    console.log(`  DIRTY chain: ${dirty.rows.map((r) => r.name).join(' -> ')}`);
    check(dirty.movableMod.length > 0,
      'the board has at least one modulation pedal the switch may move');

    // DIRTY (switch off): modulation sits before every drive, and in front.
    check(dirty.modIndexes.every((m) => m.i < dirty.firstDrive),
      'dirty: every movable modulation pedal is BEFORE the first drive',
      dirty.modIndexes.map((m) => `${m.name}@${m.i}`).join(' ') + `  firstDrive@${dirty.firstDrive}`);
    check(dirty.modIndexes.every((m) => m.location === 'front_of_amp'),
      'dirty: and none of them is in the effects loop',
      dirty.modIndexes.map((m) => `${m.name}=${m.location}`).join(' '));

    // CLEAN (switch on)
    await modSwitch.click();
    await page.waitForTimeout(400);
    const clean = await readChain();
    console.log(`  CLEAN chain: ${clean.rows.map((r) => r.name).join(' -> ')}`);
    check(clean.modIndexes.every((m) => m.location === 'effects_loop'),
      'clean: every movable modulation pedal moved INTO the effects loop',
      clean.modIndexes.map((m) => `${m.name}=${m.location}`).join(' '));
    check(clean.cables.join('|') !== dirty.cables.join('|'),
      'the CABLES the canvas draws changed with the switch',
      `${dirty.cables.length} cables -> ${clean.cables.length}`);

    // Back again - the round trip the one-directional rule could not do.
    await modSwitch.click();
    await page.waitForTimeout(400);
    const back = await readChain();
    check(back.rows.map((r) => r.name).join(' -> ') === dirty.rows.map((r) => r.name).join(' -> '),
      'switching back returns the chain to where it started',
      back.rows.map((r) => r.name).join(' -> '));
    check(back.modIndexes.every((m) => m.location === 'front_of_amp'),
      'and the modulation pedals come back out of the loop');

    // Optimize must MOVE PEDALS, which is the other half of the report.
    const beforeOptimize = back.positions;
    await page.evaluate(() => window.__pedalSchemaOptimize());
    await page.waitForTimeout(3000);
    const optimized = await readChain();
    check(optimized.positions !== beforeOptimize,
      'Optimize moves pedals with the switch in its dirty position');
    check(optimized.modIndexes.every((m) => m.i < optimized.firstDrive),
      'and the optimized board still has modulation before the drives',
      optimized.modIndexes.map((m) => `${m.name}@${m.i}`).join(' ') + `  firstDrive@${optimized.firstDrive}`);

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  } catch (error) {
    console.error('threw:', error.message);
    fail++;
  } finally {
    await browser.close();
    await sb.from('configuration_pedals').delete().eq('configuration_id', cfgId);
    await sb.from('configurations').delete().eq('id', cfgId);
    console.log('cleaned up the clone');
  }
  process.exit(fail === 0 ? 0 : 1);
})();
