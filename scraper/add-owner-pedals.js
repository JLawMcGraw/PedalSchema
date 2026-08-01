#!/usr/bin/env node
/**
 * Add hand-researched pedals to the catalogue.
 *
 * The BOSS catalogue came from a scraper; these did not. Each entry below
 * carries the URL its DIMENSIONS were read from, in `notes`, because the
 * pedals table has provenance columns for images and jacks but none for
 * measurements - and a dimension nobody can re-check is how a 5.08 quietly
 * becomes a 5.10 and disables a feature.
 *
 * Jack layouts are deliberately NOT set here. The migration contract
 * (20260731000001) is: jack rows exist => jacks_source_url is set, and
 * confidence 'unknown' => no jack rows at all. PastFX blocks automated
 * fetching and the Way Huge / Strymon manuals are image-only, so these land as
 * 'unknown' and are picked up by verify-pedal-jacks.js until sourced.
 *
 * Usage: node add-owner-pedals.js
 *        DRY_RUN=1 node add-owner-pedals.js
 *
 * Idempotent: matches on (manufacturer, name) and updates in place.
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const DRY_RUN = !!process.env.DRY_RUN;

const MM = 25.4;
const inches = (mm) => Math.round((mm / MM) * 100) / 100;

const PEDALS = [
  {
    name: 'Chorus Ensemble Deluxe',
    manufacturer: 'PastFX',
    category: 'modulation',
    // 1590BB enclosure, 120 x 94 x 50 mm. The long axis of a 1590BB runs
    // front-to-back on a board, so 120mm is DEPTH and 94mm is WIDTH.
    width_inches: inches(94),
    depth_inches: inches(120),
    height_inches: inches(50),
    voltage: 9,
    // Published as a 110-130mA range; the high end is recorded because a
    // power budget that rounds down calls an inadequate supply adequate.
    current_ma: 130,
    polarity: 'center_negative',
    preferred_location: 'effects_loop',
    notes:
      'CE-1 clone (MN3002 BBD), mono + stereo outputs. Dimensions: 1590BB ' +
      'enclosure, 120 x 94 x 50mm, per https://www.pastfx.com/index.php/effects/' +
      'chorus-ensembles/chorus-ensemble-deluxe. Current draw published as a ' +
      '110-130mA range; the 130 high end is recorded. Enclosure ORIENTATION ' +
      '(120mm as depth, 94mm as width) follows standard 1590BB pedal layout ' +
      'and has not been confirmed against a photo of this pedal.',
  },
  {
    name: 'Flint',
    manufacturer: 'Strymon',
    category: 'reverb', // tremolo + reverb; reverb is what fixes its chain position
    width_inches: 4.0,
    depth_inches: 4.5,
    height_inches: 2.4,
    voltage: 9,
    current_ma: 300,
    polarity: 'center_negative',
    preferred_location: 'effects_loop',
    notes:
      'V2 (tremolo & reverb). Dimensions and 300mA minimum quoted from ' +
      'https://www.strymon.net/product/flint/ - "4.5" deep (11.43 cm) x 4" ' +
      'wide (10.16 cm) x 2.4" tall (6.1 cm)", "maximum 9 volts DC ' +
      'center-negative, with a minimum of 300mA". V1 draws 250mA. Categorised ' +
      'as reverb rather than tremolo because the reverb is what pins it to the ' +
      'end of the chain.',
  },
  {
    name: 'Aqua-Puss',
    manufacturer: 'Way Huge',
    category: 'delay',
    // Smalls series enclosure: 104 x 61 x 53 mm (L x W x H)
    width_inches: inches(61),
    depth_inches: inches(104),
    height_inches: inches(53),
    voltage: 9,
    current_ma: 16,
    polarity: 'center_negative',
    preferred_location: 'effects_loop',
    notes:
      'WM71 Smalls (MkIII), NOT the larger WHE701 - the original is 3.75 x ' +
      '4.7in and would place quite differently. Smalls enclosure 104 x 61 x ' +
      '53mm, 16mA, 20-300ms analog delay, true hardwire relay bypass. Owner ' +
      'confirmed this is the Smalls version.',
  },
  {
    name: 'Conspiracy Theory',
    manufacturer: 'Way Huge',
    category: 'overdrive',
    width_inches: inches(61),
    depth_inches: inches(104),
    height_inches: inches(53),
    voltage: 9,
    // Published as 18.5mA; the column is an integer, so rounded UP - see the
    // power-budget note on Chorus Ensemble Deluxe above.
    current_ma: 19,
    polarity: 'center_negative',
    preferred_location: 'front_of_amp',
    notes:
      'WM20 Smalls Professional Overdrive. Dimensions "61 x 104 x 53 mm" and ' +
      '18.5mA draw per https://www.thomannmusic.com/way_huge_conspiracy_theory_' +
      'overdrive.htm; 18.5 rounded UP to 19 because current_ma is an integer ' +
      'and a power budget must not round in the flattering direction. Shares ' +
      'the Smalls enclosure with the WM71 Aqua-Puss.',
  },
];

(async () => {
  for (const p of PEDALS) {
    const { data: existing, error: findErr } = await supabase
      .from('pedals')
      .select('id,name,width_inches,depth_inches')
      .eq('manufacturer', p.manufacturer)
      .eq('name', p.name)
      .maybeSingle();
    if (findErr) { console.error('lookup failed:', findErr.message); process.exit(1); }

    const row = {
      ...p,
      is_system: true,
      jacks_confidence: 'unknown',
      updated_at: new Date().toISOString(),
    };

    const label = `${p.manufacturer} ${p.name}`.padEnd(34);
    const dims = `${p.width_inches} x ${p.depth_inches} x ${p.height_inches}in, ${p.current_ma}mA`;

    if (DRY_RUN) {
      console.log(`${existing ? 'WOULD UPDATE' : 'WOULD INSERT'} ${label} ${dims}`);
      continue;
    }

    if (existing) {
      const { error } = await supabase.from('pedals').update(row).eq('id', existing.id);
      if (error) { console.error('update failed:', error.message); process.exit(1); }
      console.log(`updated  ${label} ${dims}`);
    } else {
      const { error } = await supabase.from('pedals').insert(row);
      if (error) { console.error('insert failed:', error.message); process.exit(1); }
      console.log(`inserted ${label} ${dims}`);
    }
  }
})();
