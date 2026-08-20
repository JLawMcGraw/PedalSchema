#!/usr/bin/env node
/**
 * Does a pedal-loop configuration survive a save and reload?
 *
 * RoutingConfig - which pedal is the loop hub and what runs in its send/return
 * - had nowhere to be stored: the save wrote name, amp, three boolean flags and
 * the pedal rows, and nothing else. Configuring an NS-2 loop lasted exactly as
 * long as the browser tab. It hid behind a sibling mechanism that DOES persist
 * (PlacedPedal.useLoop has a column), so the feature looked half-working.
 *
 * Works on a throwaway clone and deletes it. Never touches a real board.
 *
 * Usage: node .claude/scripts/verify-loop-persist.js
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login, openEditor } = require('./lib/twin');
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const uuid = () => require('crypto').randomUUID();

(async () => {
  const { data: src } = await sb.from('configurations').select('*').eq('name', 'J$ Home').single();
  const { data: srcPedals } = await sb.from('configuration_pedals').select('*')
    .eq('configuration_id', src.id).order('chain_position');
  const cfgId = uuid();
  await sb.from('configurations').insert({
    ...src, id: cfgId, name: 'ZZ loop-persist check', share_slug: null,
    created_at: undefined, updated_at: undefined, routing_config: null,
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

  try {
    await login(page);
    await openEditor(page, cfgId);

    // Configure the loop exactly as the Routing panel does
    const built = await page.evaluate(() => {
      const s = window.__getPedalSchemaState();
      const byName = (n) => s.placedPedals.find((p) => s.pedalsById[p.pedalId].name === n);
      const ns2 = byName('NS-2');
      const members = s.placedPedals
        .filter((p) => ['overdrive', 'distortion', 'fuzz', 'boost']
          .includes(s.pedalsById[p.pedalId].category))
        .map((p) => p.id);
      window.__pedalSchemaSetLoop(ns2.id, members);
      return { hub: ns2.id, members };
    });
    console.log(`configured: hub + ${built.members.length} loop members\n`);

    const inMemory = await page.evaluate(() => window.__getPedalSchemaState().routingConfig);
    check(inMemory.pedalConfigs.length === 1, 'the store holds the loop config before saving',
      JSON.stringify(inMemory.pedalConfigs));

    await page.click('[data-save-board]');
    await page.waitForTimeout(2500);

    const { data: row } = await sb.from('configurations').select('routing_config').eq('id', cfgId).single();
    check(!!row.routing_config, 'routing_config reached the database',
      JSON.stringify(row.routing_config));
    check(row.routing_config?.pedalConfigs?.[0]?.pedalId === built.hub,
      'the stored hub is the NS-2');
    check((row.routing_config?.pedalConfigs?.[0]?.loopPedalIds ?? []).length === built.members.length,
      `all ${built.members.length} loop members stored`);
    check(row.routing_config?.useEffectsLoop === undefined,
      'flags with their own columns are NOT duplicated into the blob');

    // Reload from scratch - the real test
    await page.goto('about:blank');
    await openEditor(page, cfgId);
    const reloaded = await page.evaluate(() => window.__getPedalSchemaState().routingConfig);
    check(reloaded.pedalConfigs.length === 1, 'the loop config is still there after a reload',
      JSON.stringify(reloaded.pedalConfigs));
    check(reloaded.pedalConfigs?.[0]?.loopPedalIds?.length === built.members.length,
      'with its members intact');

    // The derived cables carry the JACK each end lands on; the snapshot's
    // labels do not, which is what made a first version of this check look
    // like a failure when the app was fine.
    const loopCables = await page.evaluate(() => {
      const d = window.__getPedalSchemaDerived();
      return d.cables
        .filter((c) => ['send', 'return'].includes(c.fromJack) || ['send', 'return'].includes(c.toJack))
        .map((c) => `${c.fromJack ?? 'out'} -> ${c.toJack ?? 'in'}`);
    });
    check(loopCables.length > 0, 'and the routed board actually uses the send/return jacks',
      loopCables.join(', ') || 'none');
  } catch (err) {
    console.error('ERROR:', err.message);
    fail++;
  } finally {
    await browser.close();
    await sb.from('configuration_pedals').delete().eq('configuration_id', cfgId);
    await sb.from('configurations').delete().eq('id', cfgId);
    console.log('\ncleaned up the clone');
  }
  console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
