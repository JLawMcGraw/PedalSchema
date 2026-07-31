#!/usr/bin/env node
/**
 * Import researched jack layouts into Supabase.
 *
 * Usage: node import-pedal-jacks.js [pedal_jacks.json]
 *        DRY_RUN=1 node import-pedal-jacks.js    # report, change nothing
 *
 * Idempotent: safe to re-run as research fills in. A pedal's jack rows are
 * replaced wholesale by what the file says, so the file is the source of truth
 * and correcting a mistake means correcting the file.
 *
 * Enforces the contract from 20260731000001_add_jack_provenance.sql:
 *   jack rows exist => jacks_source_url is set
 *   confidence 'unknown' => no jack rows at all (a recorded absence, not a guess)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DRY_RUN = !!process.env.DRY_RUN;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const VALID_SIDES = new Set(['top', 'bottom', 'left', 'right']);
const VALID_TYPES = new Set([
  'input', 'output', 'send', 'return', 'power', 'expression', 'midi_in', 'midi_out',
]);

/**
 * Is this catalogue row the pedal this entry describes?
 *
 * Two things make a plain string compare wrong, in opposite directions:
 *
 *  - The scraper concatenated each name with its tagline and no separator, so
 *    the OC-5 is stored as "OC-5Octave" and the IR-2 as "IR-2Amp & Cabinet".
 *    Those ARE the pedal and must match.
 *  - "W" is BOSS's Waza Craft suffix, and a Waza Craft pedal is a DIFFERENT
 *    product with its own board. "DS-1" must never match "DS-1W", nor
 *    "DS-1WDistortion". Getting this wrong writes one pedal's jack layout onto
 *    another's.
 *
 * The tell is what follows the model number: a tagline starts a word
 * (uppercase then lowercase, "Octave"), while a model suffix does not
 * ("W", "WDistortion"), and a longer model number continues with a digit
 * ("IR-2" vs "IR-200Amp & IR Cabinet").
 */
function isSamePedal(entryName, rowName) {
  if (rowName === entryName) return true;
  if (!rowName.startsWith(entryName)) return false;
  const rest = rowName.slice(entryName.length);
  if (/^[0-9]/.test(rest)) return false; // longer model number
  if (/^W(?![a-z])/.test(rest)) return false; // Waza Craft variant
  return /^[A-Z][a-z]/.test(rest) || /^[^A-Za-z0-9]/.test(rest); // tagline
}

/** Reject anything the schema or the contract would not accept, before touching the DB. */
function validate(entry) {
  const errors = [];
  const where = `${entry.manufacturer} ${entry.name}`;

  if (!entry.sourceUrl) errors.push(`${where}: no sourceUrl - we never serve a layout we cannot attribute`);
  if (!['confirmed', 'unknown'].includes(entry.confidence)) {
    errors.push(`${where}: confidence must be 'confirmed' or 'unknown', got ${entry.confidence}`);
  }
  const jacks = entry.jacks || [];
  if (entry.confidence === 'unknown' && jacks.length > 0) {
    errors.push(`${where}: confidence 'unknown' must record NO jacks - that is the point of it`);
  }
  if (entry.confidence === 'confirmed' && jacks.length === 0) {
    errors.push(`${where}: confidence 'confirmed' with no jacks - use 'unknown' instead`);
  }
  for (const j of jacks) {
    if (!VALID_TYPES.has(j.jackType)) errors.push(`${where}: unknown jackType ${j.jackType}`);
    if (!VALID_SIDES.has(j.side)) errors.push(`${where}: unknown side ${j.side}`);
    if (!(j.positionPercent >= 0 && j.positionPercent <= 100)) {
      errors.push(`${where}: positionPercent ${j.positionPercent} outside 0-100`);
    }
  }
  return errors;
}

(async () => {
  const file = process.argv[2] || path.join(__dirname, 'pedal_jacks.json');
  const { pedals } = JSON.parse(fs.readFileSync(file, 'utf8'));

  const errors = pedals.flatMap(validate);
  if (errors.length > 0) {
    console.error('Refusing to import - the file is not valid:');
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }

  let confirmed = 0;
  let unknown = 0;
  let missing = 0;

  for (const entry of pedals) {
    // Match on manufacturer + name. The scraper concatenated some names with
    // their taglines ("IR-2Amp & Cabinet"), so match a prefix too rather than
    // silently skipping those rows.
    const { data: rows, error: findError } = await supabase
      .from('pedals')
      .select('id,name')
      .eq('manufacturer', entry.manufacturer)
      .like('name', `${entry.name}%`);

    if (findError) {
      console.error(`  ${entry.name}: lookup failed - ${findError.message}`);
      process.exitCode = 1;
      continue;
    }
    const matches = (rows || []).filter((r) => isSamePedal(entry.name, r.name));
    if (matches.length === 0) {
      console.log(`  MISSING  ${entry.manufacturer} ${entry.name} - not in the catalogue`);
      missing++;
      continue;
    }

    for (const row of matches) {
      const label = `${entry.name}${row.name !== entry.name ? ` (as "${row.name}")` : ''}`;
      if (DRY_RUN) {
        console.log(`  would set ${label}: ${entry.confidence}, ${(entry.jacks || []).length} jacks`);
        continue;
      }

      const { error: delError } = await supabase.from('pedal_jacks').delete().eq('pedal_id', row.id);
      if (delError) {
        console.error(`  ${label}: clearing old jacks failed - ${delError.message}`);
        process.exitCode = 1;
        continue;
      }

      if ((entry.jacks || []).length > 0) {
        const { error: insError } = await supabase.from('pedal_jacks').insert(
          entry.jacks.map((j) => ({
            pedal_id: row.id,
            jack_type: j.jackType,
            side: j.side,
            position_percent: Math.round(j.positionPercent),
            label: j.label ?? null,
          }))
        );
        if (insError) {
          console.error(`  ${label}: inserting jacks failed - ${insError.message}`);
          process.exitCode = 1;
          continue;
        }
      }

      const { error: provError } = await supabase
        .from('pedals')
        .update({
          jacks_source_url: entry.sourceUrl,
          jacks_verified_at: new Date().toISOString(),
          jacks_confidence: entry.confidence,
          jacks_notes: entry.notes ?? null,
        })
        .eq('id', row.id);
      if (provError) {
        console.error(`  ${label}: recording provenance failed - ${provError.message}`);
        process.exitCode = 1;
        continue;
      }

      console.log(`  ${entry.confidence === 'confirmed' ? 'OK      ' : 'UNKNOWN '} ${label}: ${(entry.jacks || []).length} jacks`);
      if (entry.confidence === 'confirmed') confirmed++;
      else unknown++;
    }
  }

  console.log(`\n${confirmed} confirmed, ${unknown} recorded unknown, ${missing} not found${DRY_RUN ? ' (DRY RUN - nothing written)' : ''}`);
})();
