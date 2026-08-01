#!/usr/bin/env node
/**
 * Can a chain REORDER be saved, and is the uniqueness guarantee still intact?
 *
 * configuration_pedals has UNIQUE(configuration_id, chain_position). It was
 * IMMEDIATE, and Postgres checks an immediate unique constraint row by row as a
 * statement runs - so the save path, which upserts the whole chain in one
 * statement, failed on any edit that renumbered it:
 *
 *   23505 duplicate key value violates unique constraint
 *   Key (configuration_id, chain_position)=(..., 2) already exists.
 *
 * Migration 20260801000005 made it DEFERRABLE INITIALLY DEFERRED. This checks
 * BOTH halves of that change, because relaxing when a constraint is enforced is
 * one edit away from not enforcing it at all: a reorder must save, and a
 * genuinely duplicated final state must still be refused.
 *
 * Works on a throwaway configuration and deletes it afterwards. Never touches a
 * real board.
 *
 * Usage: node .claude/scripts/verify-save-reorder.js
 */
const path = require('path');
const { loadEnv } = require('./lib/twin');
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const uuid = () => require('crypto').randomUUID();

(async () => {
  const { data: src } = await sb.from('configurations').select('*').limit(1).single();
  const { data: pedals } = await sb.from('pedals').select('id').limit(3);
  const cfgId = uuid();
  await sb.from('configurations').insert({
    id: cfgId, user_id: src.user_id, name: 'ZZ save-reorder check', board_id: src.board_id,
  });

  const a = uuid(), b = uuid(), c = uuid();
  const row = (id, pid, pos) => ({
    id, configuration_id: cfgId, pedal_id: pid,
    x_inches: 0, y_inches: 0, chain_position: pos, location: 'front_of_amp',
  });
  let pass = 0, fail = 0;
  const check = (ok, label, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`        ${detail}`);
    ok ? pass++ : fail++;
  };

  try {
    let r = await sb.from('configuration_pedals').insert([row(a, pedals[0].id, 1), row(b, pedals[1].id, 2)]);
    check(!r.error, 'ordinary insert works', r.error?.message);

    r = await sb.from('configuration_pedals')
      .upsert([row(a, pedals[0].id, 2), row(b, pedals[1].id, 1)], { onConflict: 'id' });
    check(!r.error, 'a REORDER saves - the intermediate collision is allowed', r.error?.message);

    r = await sb.from('configuration_pedals')
      .upsert([row(a, pedals[0].id, 5), row(b, pedals[1].id, 5)], { onConflict: 'id' });
    check(!!r.error && r.error.code === '23505',
      'a duplicated FINAL state is still refused - the guarantee survives',
      r.error ? r.error.code : 'NO ERROR: uniqueness is no longer enforced');

    r = await sb.from('configuration_pedals').insert(row(c, pedals[2].id, 2));
    check(!!r.error && r.error.code === '23505',
      'inserting onto an occupied position is still refused',
      r.error ? r.error.code : 'NO ERROR: uniqueness is no longer enforced');

    const { data: final } = await sb.from('configuration_pedals')
      .select('chain_position').eq('configuration_id', cfgId).order('chain_position');
    const nums = final.map((x) => x.chain_position);
    check(JSON.stringify(nums) === '[1,2]',
      'the rejected writes left the table in its last good state', JSON.stringify(nums));
  } finally {
    await sb.from('configuration_pedals').delete().eq('configuration_id', cfgId);
    await sb.from('configurations').delete().eq('id', cfgId);
  }

  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
