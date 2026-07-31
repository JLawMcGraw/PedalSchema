#!/usr/bin/env node
/**
 * How much of the catalogue's jack data is real, and what is left to research.
 *
 * Jack data decides where a cable physically attaches and whether the optimizer
 * may rotate a pedal at all (rotation needs a signal jack on the top or bottom
 * edge - src/lib/engine/layout/rotation-eligibility.ts). A pedal with no jack
 * rows silently falls back to a default assumption, which is survivable but
 * invisible. This makes it visible.
 *
 * Checks the contract from 20260731000001_add_jack_provenance.sql:
 *   jack rows exist        => jacks_source_url IS NOT NULL
 *   confidence 'unknown'   => no jack rows
 *   jacks_verified_at NULL => never researched (NOT the same as 'unknown')
 *
 * Usage: node .claude/scripts/verify-pedal-jacks.js [--list]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

(async () => {
  const listAll = process.argv.includes('--list');

  const { data: pedals, error } = await supabase
    .from('pedals')
    .select('id,name,manufacturer,width_inches,depth_inches,jacks_source_url,jacks_verified_at,jacks_confidence')
    .order('manufacturer')
    .order('name');
  if (error) {
    console.error('Could not read pedals:', error.message);
    process.exit(1);
  }

  const { data: jacks } = await supabase.from('pedal_jacks').select('pedal_id,jack_type,side');
  const byPedal = new Map();
  for (const j of jacks || []) {
    if (!byPedal.has(j.pedal_id)) byPedal.set(j.pedal_id, []);
    byPedal.get(j.pedal_id).push(j);
  }

  const confirmed = [];
  const unknown = [];
  const unresearched = [];
  const violations = [];

  for (const p of pedals) {
    const rows = byPedal.get(p.id) || [];
    const where = `${p.manufacturer} ${p.name}`;

    if (rows.length > 0 && !p.jacks_source_url) {
      violations.push(`${where}: has ${rows.length} jack rows but no jacks_source_url - a layout we cannot attribute`);
    }
    if (p.jacks_confidence === 'unknown' && rows.length > 0) {
      violations.push(`${where}: marked unknown but carries ${rows.length} jack rows`);
    }
    if (!p.jacks_verified_at) unresearched.push({ p, rows });
    else if (p.jacks_confidence === 'unknown') unknown.push(p);
    else confirmed.push(p);
  }

  const rotatable = confirmed.filter((p) => {
    const rows = byPedal.get(p.id) || [];
    return rows.some((j) => ['input', 'output'].includes(j.jack_type) && ['top', 'bottom'].includes(j.side));
  });

  console.log(`catalogue            ${pedals.length} pedals`);
  console.log(`confirmed            ${confirmed.length}`);
  console.log(`researched, unknown  ${unknown.length}`);
  console.log(`NOT researched       ${unresearched.length}   (${unresearched.filter((u) => u.rows.length > 0).length} of them carry unattributed jack rows)`);
  console.log(`rotation candidates  ${rotatable.length}   (confirmed pedals with a signal jack on the top/bottom edge)`);

  if (violations.length > 0) {
    console.log(`\ncontract violations (${violations.length}):`);
    for (const v of violations) console.log('  ' + v);
  }

  if (listAll) {
    console.log('\noutstanding:');
    for (const { p, rows } of unresearched) {
      console.log(`  ${(p.manufacturer + ' ' + p.name).padEnd(46)} ${rows.length ? `${rows.length} unattributed jack rows` : 'no jack data'}`);
    }
  } else if (unresearched.length > 0) {
    console.log('\nrun with --list to see what is outstanding');
  }

  // Unattributed jack rows are a contract violation, but they are the STARTING
  // state of the whole catalogue, so they must not fail the check on their own.
  process.exitCode = violations.some((v) => v.includes('marked unknown but carries')) ? 1 : 0;
})();
