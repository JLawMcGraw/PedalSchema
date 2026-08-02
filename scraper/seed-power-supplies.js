#!/usr/bin/env node
/**
 * Seed the system power-supply catalogue.
 *
 * SAME DISCIPLINE AS pedal_jacks.json: every rating below is read off the
 * manufacturer's own specification page, quoted in `source`, and nothing is
 * inferred from a retailer listing or from what a supply "probably" does. A
 * wrong rating here is worse than a missing one - it reports headroom that
 * does not exist, which is the one direction the power module is not allowed
 * to be wrong in.
 *
 * NOTE the shape of a switchable output. Voltage and rating travel together in
 * alternateModes because a switchable output DERATES as voltage rises: Zuma
 * outputs 8-9 give 500mA at 9V but 250mA at 18V. Storing a bare voltage list
 * against one rating would report twice the real headroom for an 18V pedal.
 *
 * Usage:
 *   DRY_RUN=1 node scraper/seed-power-supplies.js   # show, write nothing
 *   node scraper/seed-power-supplies.js
 */
require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPPLIES = [
  {
    name: 'Zuma',
    manufacturer: 'Strymon',
    isIsolated: true,
    source: 'https://www.strymon.net/product/zuma/',
    notes:
      'Strymon spec: "9 high-current, fully isolated outputs". Outputs 1-7 are ' +
      '9V 500mA. Outputs 8-9 are selectable 9V/12V/18V at 500mA/375mA/250mA - ' +
      'the derating is the reason alternate modes carry their own rating.',
    outputs: [
      ...Array.from({ length: 7 }, (_, i) => ({
        label: `Output ${i + 1}`, voltage: 9, ratedMa: 500, alternateModes: [],
      })),
      ...[8, 9].map((n) => ({
        label: `Output ${n}`,
        voltage: 9,
        ratedMa: 500,
        alternateModes: [
          { voltage: 12, ratedMa: 375 },
          { voltage: 18, ratedMa: 250 },
        ],
      })),
    ],
  },
  {
    name: 'Pedal Power 2 Plus',
    manufacturer: 'Voodoo Lab',
    isIsolated: true,
    source: 'https://voodoolab.com/product/pedal-power-2-plus/',
    notes:
      'Voodoo Lab spec: four 9V/12V 100mA outputs (1-4), two 9V/12V 250mA ' +
      'outputs (5-6), and two 9V 100mA outputs with the SAG feature (7-8). ' +
      'The 18V/24V and 500mA figures on that page need optional doubler cables ' +
      'that COMBINE two outputs, so they are not modelled here - a doubler ' +
      'changes which outputs exist, and recording it as a per-output rating ' +
      'would let two pedals be assigned to outputs that are physically one.',
    outputs: [
      ...Array.from({ length: 4 }, (_, i) => ({
        label: `Output ${i + 1}`, voltage: 9, ratedMa: 100,
        alternateModes: [{ voltage: 12, ratedMa: 100 }],
      })),
      ...[5, 6].map((n) => ({
        label: `Output ${n}`, voltage: 9, ratedMa: 250,
        alternateModes: [{ voltage: 12, ratedMa: 250 }],
      })),
      ...[7, 8].map((n) => ({
        label: `Output ${n} (SAG)`, voltage: 9, ratedMa: 100, alternateModes: [],
      })),
    ],
  },
];

(async () => {
  const dry = !!process.env.DRY_RUN;
  let created = 0;
  let skipped = 0;

  for (const s of SUPPLIES) {
    const { data: existing, error: findErr } = await sb
      .from('power_supplies')
      .select('id')
      .eq('name', s.name)
      .eq('manufacturer', s.manufacturer)
      .maybeSingle();
    if (findErr) {
      console.error(`  ERROR ${s.manufacturer} ${s.name}: ${findErr.message}`);
      process.exitCode = 1;
      continue;
    }

    const total = s.outputs.reduce((sum, o) => sum + o.ratedMa, 0);
    const label = `${s.manufacturer} ${s.name}`.padEnd(30);
    if (existing) {
      console.log(`  skip     ${label} already present`);
      skipped++;
      continue;
    }
    if (dry) {
      console.log(`  would    ${label} ${s.outputs.length} outputs, ${total}mA total`);
      created++;
      continue;
    }

    const { data: supply, error: insErr } = await sb
      .from('power_supplies')
      .insert({
        name: s.name,
        manufacturer: s.manufacturer,
        is_isolated: s.isIsolated,
        is_system: true,
        notes: `${s.notes} Source: ${s.source}`,
      })
      .select('id')
      .single();
    if (insErr) {
      console.error(`  ERROR ${label} ${insErr.message}`);
      process.exitCode = 1;
      continue;
    }

    const rows = s.outputs.map((o, i) => ({
      supply_id: supply.id,
      label: o.label,
      voltage: o.voltage,
      rated_ma: o.ratedMa,
      alternate_modes: o.alternateModes,
      sort_order: i,
    }));
    const { error: outErr } = await sb.from('power_supply_outputs').insert(rows);
    if (outErr) {
      console.error(`  ERROR ${label} outputs: ${outErr.message}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  created  ${label} ${s.outputs.length} outputs, ${total}mA total`);
    created++;
  }

  console.log(
    `\n${dry ? '[DRY RUN] ' : ''}${created} supplies, ${skipped} already present`
  );
})();
