#!/usr/bin/env node
/**
 * Repair two defects the scraper left in the pedal catalogue.
 *
 * 1. CONCATENATED NAMES. Pedals were imported as name + tagline with no
 *    separator: "OC-5Octave", "IR-2Amp & Cabinet", "BP-1WBooster/Preamp".
 *    The tagline is real information, so it moves to `notes` rather than being
 *    thrown away, and the name becomes just the model.
 *
 * 2. DUPLICATE ROWS. Some pedals exist twice - once from the original seed,
 *    once from the scrape - with slightly different dimensions (CS-3 as
 *    2.9 x 5.1 and again as 2.87 x 5.08). A user can then unknowingly put
 *    "the same" pedal on a board twice from two catalogue entries.
 *
 *    Merging is done by REPOINTING, never by deleting anything a board refers
 *    to: configuration_pedals rows move to the surviving pedal first, and the
 *    duplicate is removed only once nothing references it. Placed pedals are
 *    never deleted - if a board really has two CS-3s on it, it still does
 *    afterwards.
 *
 *    The SEEDED row survives, because it carries jack data and hand-checked
 *    metadata; the scraped row's manufacturer dimensions are copied onto it,
 *    since 73 x 129 mm is the real figure and 2.9 x 5.1 in was rounded.
 *
 * Usage: DRY_RUN=1 node fix-catalogue-duplicates.js   # report only
 *        node fix-catalogue-duplicates.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const DRY_RUN = !!process.env.DRY_RUN;

/**
 * Split "OC-5Octave" into model and tagline.
 *
 * A BOSS model is letters, a hyphen, digits, and optionally a "W" (Waza Craft)
 * or other single-capital suffix. The tagline that follows starts a word:
 * a capital then a lowercase letter. "DS-1WDistortion" is model "DS-1W" plus
 * tagline "Distortion" - the W belongs to the MODEL and must not be shaved off,
 * because DS-1W and DS-1 are different pedals.
 */
/**
 * No regex can do this reliably: "CH-1SUPER Chorus" splits after CH-1 while
 * "CP-1XCompressor" splits after CP-1X, and both read as uppercase-then-
 * uppercase. Guessing turned CP-1X into "CP-1".
 *
 * The scrape already knows the answer - boss_pedals.json carries the correct
 * `model` alongside the concatenated `name` - so look it up instead. Anything
 * absent from the scrape is left completely alone.
 */
const SCRAPED = (() => {
  const byName = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'boss_pedals.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.pedals || Object.values(raw)[0];
    for (const p of list) if (p.model && p.name) byName.set(p.name, p.model);
  } catch { /* no scrape file - every name is then left as-is */ }
  return byName;
})();

function splitName(name) {
  const model = SCRAPED.get(name);
  if (!model || model === name || !name.startsWith(model)) return { model: name, tagline: null };
  const tagline = name.slice(model.length).trim();
  return { model, tagline: tagline || null };
}

(async () => {
  const { data: pedals, error } = await supabase
    .from('pedals')
    .select('id,name,manufacturer,notes,width_inches,depth_inches,image_url,is_system,created_at')
    .order('created_at');
  if (error) throw error;

  const { data: placed } = await supabase.from('configuration_pedals').select('id,pedal_id');
  const useCount = new Map();
  for (const p of placed || []) useCount.set(p.pedal_id, (useCount.get(p.pedal_id) || 0) + 1);

  // --- 1. names ------------------------------------------------------------
  console.log('=== concatenated names ===');
  const renames = [];
  for (const p of pedals) {
    const { model, tagline } = splitName(p.name);
    if (model === p.name) continue;
    renames.push({ p, model, tagline });
    console.log(`  "${p.name}" -> "${model}"  (tagline "${tagline}" -> notes)`);
  }
  if (renames.length === 0) console.log('  none');

  if (!DRY_RUN) {
    for (const { p, model, tagline } of renames) {
      const notes = p.notes && p.notes.includes(tagline) ? p.notes : [p.notes, tagline].filter(Boolean).join(' - ');
      const { error: e } = await supabase.from('pedals').update({ name: model, notes }).eq('id', p.id);
      if (e) console.error(`  FAILED to rename ${p.name}: ${e.message}`);
    }
  }

  // --- 2. duplicates -------------------------------------------------------
  // Group by manufacturer + model AFTER the rename, so the pairs line up.
  const groups = new Map();
  for (const p of pedals) {
    const { model } = splitName(p.name);
    const key = `${p.manufacturer}|${model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  console.log('\n=== duplicate catalogue entries ===');
  let merges = 0;
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    merges++;
    // Keep the seeded row: it has jack data and curated metadata. Ties break on
    // whichever was created first, which is the seed by construction.
    const keep = rows.find((r) => r.is_system && useCount.has(r.id)) || rows[0];
    const drop = rows.filter((r) => r.id !== keep.id);

    console.log(`  ${key}`);
    console.log(`    keep  ${keep.id.slice(0, 8)} "${keep.name}" ${keep.width_inches}x${keep.depth_inches} (${useCount.get(keep.id) || 0} on boards)`);
    for (const d of drop) {
      console.log(`    merge ${d.id.slice(0, 8)} "${d.name}" ${d.width_inches}x${d.depth_inches} (${useCount.get(d.id) || 0} on boards) -> repoint then delete`);
    }

    if (DRY_RUN) continue;

    // Manufacturer dimensions from the scraped row are the better figure
    const scraped = drop.find((d) => d.width_inches && d.depth_inches);
    if (scraped) {
      await supabase
        .from('pedals')
        .update({ width_inches: scraped.width_inches, depth_inches: scraped.depth_inches })
        .eq('id', keep.id);
    }

    for (const d of drop) {
      // Repoint every board reference BEFORE removing anything
      const { error: repointError } = await supabase
        .from('configuration_pedals')
        .update({ pedal_id: keep.id })
        .eq('pedal_id', d.id);
      if (repointError) {
        console.error(`    ABORT ${d.name}: repointing failed - ${repointError.message}`);
        continue;
      }
      // Only now is it safe: nothing on any board points here
      const { count } = await supabase
        .from('configuration_pedals')
        .select('id', { count: 'exact', head: true })
        .eq('pedal_id', d.id);
      if (count && count > 0) {
        console.error(`    ABORT ${d.name}: ${count} board rows still reference it`);
        continue;
      }
      await supabase.from('pedal_jacks').delete().eq('pedal_id', d.id);
      const { error: delError } = await supabase.from('pedals').delete().eq('id', d.id);
      if (delError) console.error(`    FAILED to delete ${d.name}: ${delError.message}`);
    }
  }
  if (merges === 0) console.log('  none');

  console.log(`\n${renames.length} renamed, ${merges} duplicate groups merged${DRY_RUN ? ' (DRY RUN - nothing written)' : ''}`);
})();
