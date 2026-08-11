#!/usr/bin/env node
/**
 * Pull the whole pedal catalogue with its jacks into one JSON file, shaped as
 * the engine's `Pedal` type, so jack resolution can be checked offline against
 * real data rather than fixtures.
 *
 * Companion to dump-configs-offline.js. That one carries only the pedals used
 * by a saved configuration; this one carries all of them, which is the point -
 * the gate it feeds is about pedals nobody has put on a board yet.
 *
 * Usage: node .claude/scripts/dump-pedals-offline.js [outFile]
 */
const fs = require('fs');
const { loadEnv } = require('./lib/twin');
const { createClient } = require('@supabase/supabase-js');

const out = process.argv[2] || '/tmp/pedals.json';

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await sb.from('pedals').select('*, pedal_jacks(*)');
  // Check `error`, not just `data` - see the note in dump-configs-offline.js.
  if (error) { console.error('pedals read failed:', error.message); process.exit(1); }

  const pedals = data.map((p) => ({
    id: p.id,
    name: p.name,
    manufacturer: p.manufacturer,
    category: p.category,
    widthInches: p.width_inches,
    depthInches: p.depth_inches,
    supports4Cable: p.supports_4_cable,
    jacks: (p.pedal_jacks || []).map((j) => ({
      id: j.id,
      pedalId: j.pedal_id,
      jackType: j.jack_type,
      side: j.side,
      positionPercent: j.position_percent,
      label: j.label,
    })),
  }));

  fs.writeFileSync(out, JSON.stringify(pedals, null, 1));
  const withJacks = pedals.filter((p) => p.jacks.length > 0).length;
  console.log(`${pedals.length} pedals (${withJacks} with jack data) -> ${out}`);
})();
