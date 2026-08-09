#!/usr/bin/env node
/**
 * How much of the catalogue's SIZE data is attributable, and what is left.
 *
 * Dimensions decide packing, row derivation and rotation eligibility, and until
 * 20260808000003 they were the one attribute with no provenance at all - the
 * table recorded where a photo and a jack layout came from and never where a
 * measurement came from. Four dimension errors were found in two days, every one
 * while looking at something else, every one in a row nobody could check.
 *
 * This makes the gap visible the way verify-pedal-jacks.js does for jacks. It
 * asserts NOTHING about correctness - a recorded source can still be a different
 * revision - only about whether the claim is checkable.
 *
 * Usage: node .claude/scripts/verify-pedal-dimensions.js [--list]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Hosts that are the maker of the pedal - the strongest evidence available. */
const MANUFACTURER_HOSTS = [
  'strymon.net', 'ehx.com', 'roland.com', 'boss.info', 'jimdunlop.com',
  'pastfx.com', 'electroharmonix.com', 'tcelectronic.com', 'procosound.com',
];

(async () => {
  const listAll = process.argv.includes('--list');

  const { data: pedals, error } = await supabase
    .from('pedals')
    .select('name,manufacturer,width_inches,depth_inches,height_inches,current_ma,dimensions_source_url,dimensions_verified_at')
    .order('manufacturer')
    .order('name');
  if (error) {
    console.error('Could not read pedals:', error.message);
    process.exit(1);
  }

  const attributed = pedals.filter((p) => p.dimensions_source_url);
  const byMaker = attributed.filter((p) =>
    MANUFACTURER_HOSTS.some((h) => p.dimensions_source_url.includes(h))
  );
  const bySomeoneElse = attributed.filter((p) => !byMaker.includes(p));
  const unattributed = pedals.filter((p) => !p.dimensions_source_url);

  // A row that claims a source but no date, or vice versa, is incoherent the
  // same way a jack row without a source URL was.
  const halfRecorded = pedals.filter(
    (p) => Boolean(p.dimensions_source_url) !== Boolean(p.dimensions_verified_at)
  );

  console.log(`catalogue              ${String(pedals.length).padStart(3)} pedals`);
  console.log(`attributed             ${String(attributed.length).padStart(3)}`);
  console.log(`  from the maker       ${String(byMaker.length).padStart(3)}`);
  console.log(`  from someone else    ${String(bySomeoneElse.length).padStart(3)}   (retailer/database - real evidence, weaker)`);
  console.log(`NOT researched         ${String(unattributed.length).padStart(3)}   (seeded; nobody recorded a source)`);

  if (halfRecorded.length) {
    console.log(`\n${halfRecorded.length} row(s) have a source without a date, or a date without a source:`);
    for (const p of halfRecorded) {
      console.log(`  ${(p.manufacturer + ' ' + p.name).padEnd(34)} url=${p.dimensions_source_url ? 'set' : 'NULL'} date=${p.dimensions_verified_at ? 'set' : 'NULL'}`);
    }
  }

  if (listAll) {
    console.log('\nattributed:');
    for (const p of attributed) {
      const maker = byMaker.includes(p) ? 'maker   ' : 'third   ';
      console.log(`  ${maker} ${(p.manufacturer + ' ' + p.name).padEnd(32)} ${p.width_inches} x ${p.depth_inches} x ${p.height_inches}`);
      console.log(`           ${p.dimensions_source_url}`);
    }
    console.log('\nunattributed:');
    for (const p of unattributed) {
      console.log(`  ${(p.manufacturer + ' ' + p.name).padEnd(34)} ${p.width_inches} x ${p.depth_inches} x ${p.height_inches}`);
    }
  } else {
    console.log('\nrun with --list to see which pedals are which');
  }

  // Half-recorded rows are a contract violation; an unattributed row is not -
  // it is an honest gap, and failing on it would only encourage inventing URLs.
  //
  // Set exitCode rather than calling process.exit: the supabase client keeps a
  // handle open, and tearing the loop down under it aborts the process on
  // Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") with a
  // status that reads as a failed check even when every check passed.
  process.exitCode = halfRecorded.length === 0 ? 0 : 1;
})();
