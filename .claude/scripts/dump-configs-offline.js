#!/usr/bin/env node
/**
 * Pull every saved configuration straight from the database into one JSON file,
 * shaped exactly like the editor store's state, so the layout engine can be
 * replayed offline. Unlike dump-state.js this needs no dev server and no
 * browser - it is for fingerprinting the engine, not the app.
 *
 * Usage: node .claude/scripts/dump-configs-offline.js [outFile]
 */
const fs = require('fs');
const { loadEnv } = require('./lib/twin');
const { createClient } = require('@supabase/supabase-js');

const out = process.argv[2] || '/tmp/configs.json';

// EVERY pedal field the engine reads must be here. Six were missing until
// 2026-08-18: supports4Cable, needsDirectPickup, needsBufferBefore,
// defaultChainPosition, voltage, polarity. supports4Cable was the expensive
// one - it gates the four-cable-hub rule (signal-chain/rules.ts, priority
// 105), so offline replays of a 4-cable board silently ran with NO hub while
// the dumped rows still said `location: four_cable_hub`, which made it look
// like the rule had fired. Same family as the `rails` bug in dump-state.js
// and the fingerprint's chainPosition sort: a harness that drops or
// normalises what the product reads is not testing the product.
//
// Before adding a field to the engine, add it here.
const camelPedal = (p) => ({
  id: p.id, name: p.name, manufacturer: p.manufacturer, category: p.category,
  widthInches: p.width_inches, depthInches: p.depth_inches, heightInches: p.height_inches,
  preferredLocation: p.preferred_location, currentMa: p.current_ma,
  voltage: p.voltage, polarity: p.polarity,
  defaultChainPosition: p.default_chain_position,
  supports4Cable: p.supports_4_cable,
  needsBufferBefore: p.needs_buffer_before,
  needsDirectPickup: p.needs_direct_pickup,
  jacks: (p.pedal_jacks || []).map((j) => ({
    id: j.id, pedalId: j.pedal_id, jackType: j.jack_type, side: j.side,
    positionPercent: j.position_percent, label: j.label,
  })),
});

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const die = (what, error) => { if (error) { console.error(what, error.message); process.exit(1); } };

  const { data: configs, error: cErr } = await sb
    .from('configurations')
    .select('id,name,use_effects_loop,use_4_cable_method,modulation_in_loop,board_id');
  die('configurations', cErr);

  // Rails live in board_rails, NOT on boards. Reading `b.rails` gave undefined,
  // so every offline replay ran on a RAILLESS board - which derives rows at
  // slightly different y and scores row alignment quite differently. Comparisons
  // taken with this harness were self-consistent, but they were not the app.
  const { data: boards, error: bErr } = await sb.from('boards').select('*, board_rails(*)');
  die('boards', bErr);
  const boardById = Object.fromEntries(boards.map((b) => [b.id, {
    id: b.id, name: b.name, widthInches: b.width_inches, depthInches: b.depth_inches,
    manufacturer: b.manufacturer,
    rails: (b.board_rails || [])
      .map((r) => ({ id: r.id, boardId: r.board_id,
        positionFromBackInches: r.position_from_back_inches, sortOrder: r.sort_order }))
      .sort((a, b2) => a.sortOrder - b2.sortOrder),
  }]));

  const { data: pedals, error: pErr } = await sb.from('pedals').select('*, pedal_jacks(*)');
  die('pedals', pErr);
  const pedalById = Object.fromEntries(pedals.map((p) => [p.id, camelPedal(p)]));

  const result = [];
  for (const c of configs) {
    const { data: cps, error: cpErr } = await sb
      .from('configuration_pedals').select('*').eq('configuration_id', c.id);
    die('configuration_pedals', cpErr);
    const placedPedals = cps.map((cp) => ({
      id: cp.id, configurationId: cp.configuration_id, pedalId: cp.pedal_id,
      xInches: cp.x_inches, yInches: cp.y_inches, rotationDegrees: cp.rotation_degrees,
      chainPosition: cp.chain_position, location: cp.location,
      chainPositionLocked: cp.chain_position_locked ?? false,
      isActive: cp.is_active, useLoop: cp.use_loop, createdAt: cp.created_at,
      pedal: pedalById[cp.pedal_id],
    })).sort((a, b) => a.chainPosition - b.chainPosition);

    result.push({
      id: c.id, name: c.name, board: boardById[c.board_id],
      useEffectsLoop: c.use_effects_loop, use4CableMethod: c.use_4_cable_method,
      modulationInLoop: c.modulation_in_loop,
      placedPedals,
      pedalsById: Object.fromEntries(placedPedals.map((p) => [p.pedalId, pedalById[p.pedalId]])),
    });
  }

  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  for (const c of result) {
    console.log(`${c.name}: ${c.placedPedals.length} pedals on ${c.board?.name} ` +
      `(${c.board?.widthInches}x${c.board?.depthInches})`);
  }
  console.log(`\nWrote ${out}`);
})();
