#!/usr/bin/env node
/**
 * Alpha fingerprint of every mirrored pedal image.
 *
 * The knockout has no unit-testable ground truth for real photographs - the
 * only corpus that says whether a change is safe is the pedals that already
 * look right. This records, per pedal, the shape of the alpha channel that
 * came out of the current algorithm, so a later run can be diffed against it.
 *
 * Bands exist because the two known failures both landed at an EDGE, where
 * the centre-box guard is blind by construction: a fill that walks into the
 * pedal from the top erodes the top band (DM-2W: top 27% vs middle 97%), and
 * a fill that stops early leaves the whole frame opaque (Timeline: 95%).
 *
 *   node .claude/scripts/fingerprint-pedal-alpha.js            # write baseline
 *   node .claude/scripts/fingerprint-pedal-alpha.js --compare  # diff vs baseline
 *
 * Baseline lives at .claude/docs/knockout-fingerprint.json.
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUT = path.join(__dirname, '../docs/knockout-fingerprint.json');

/** Alpha at or above this is opaque; below CLEAR_A it is fully clear. */
const OPAQUE_A = 200;
const CLEAR_A = 20;

/**
 * Opaque coverage of a rectangular region, as a share of that region. Used for
 * the edge bands and the middle reference - the ratio between them is what
 * distinguishes an eroded pedal from an intact one at any absolute coverage.
 */
function coverage(px, W, C, x0, x1, y0, y1) {
  let opaque = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (px[(y * W + x) * C + 3] > OPAQUE_A) opaque++;
    }
  }
  return total ? opaque / total : 0;
}

async function measure(buf) {
  const { data: px, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  let opaque = 0;
  let clear = 0;
  for (let i = 0; i < W * H; i++) {
    const a = px[i * C + 3];
    if (a > OPAQUE_A) opaque++;
    else if (a < CLEAR_A) clear++;
  }
  const n = W * H;

  const b = (x0, x1, y0, y1) => +coverage(px, W, C, x0, x1, y0, y1).toFixed(4);
  const r = (f) => Math.round(H * f);
  const c = (f) => Math.round(W * f);
  const A = (x, y) => px[(y * W + x) * C + 3];

  return {
    w: W,
    h: H,
    opaque: +(opaque / n).toFixed(4),
    partial: +((n - opaque - clear) / n).toFixed(4),
    clear: +(clear / n).toFixed(4),
    bands: {
      top: b(0, W, 0, r(0.1)),
      bottom: b(0, W, r(0.9), H),
      left: b(0, c(0.1), 0, H),
      right: b(c(0.9), W, 0, H),
      middle: b(c(0.4), c(0.6), r(0.4), r(0.6)),
    },
    // A photographed pedal has rounded or perspective-tapered corners, so a
    // real cut-out clears at least some of them. Four opaque corners is the
    // signature of a backdrop that survived.
    corners: [A(0, 0), A(W - 1, 0), A(0, H - 1), A(W - 1, H - 1)],
  };
}

async function main() {
  const { data: pedals, error } = await sb
    .from('pedals')
    .select('id,name,manufacturer,image_url')
    .order('manufacturer')
    .order('name');
  if (error) throw error;

  const withImages = pedals.filter((p) => p.image_url);
  const out = {};
  let failed = 0;

  for (const p of withImages) {
    const key = `${p.manufacturer} ${p.name}`;
    try {
      const res = await fetch(p.image_url);
      if (!res.ok) {
        out[key] = { error: `HTTP ${res.status}` };
        failed++;
        continue;
      }
      out[key] = await measure(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      out[key] = { error: String(err.message ?? err) };
      failed++;
    }
  }

  const report = {
    takenAt: new Date().toISOString(),
    pedalsInDb: pedals.length,
    withImages: withImages.length,
    measured: Object.keys(out).length - failed,
    pedals: out,
  };

  if (process.argv.includes('--compare')) {
    compare(JSON.parse(fs.readFileSync(OUT, 'utf8')), report);
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`${report.measured} images measured (${failed} failed), written to ${OUT}`);
  for (const [name, s] of Object.entries(out)) {
    if (s.error) {
      console.log(`  ${name.padEnd(34)} ERROR ${s.error}`);
      continue;
    }
    const bands = Object.entries(s.bands)
      .map(([k, v]) => `${k[0]}${(100 * v).toFixed(0)}`)
      .join(' ');
    console.log(
      `  ${name.padEnd(34)} ${String(s.w).padStart(4)}x${String(s.h).padStart(4)} ` +
        `opaque ${(100 * s.opaque).toFixed(1).padStart(5)}%  clear ${(100 * s.clear).toFixed(1).padStart(5)}%  ` +
        `[${bands}] corners ${s.corners.join(',')}`
    );
  }
}

/** Material movement in any recorded share. Below this is PNG/rounding noise. */
const DRIFT = 0.02;

function compare(base, now) {
  const names = new Set([...Object.keys(base.pedals), ...Object.keys(now.pedals)]);
  const moved = [];
  const added = [];
  const removed = [];

  for (const name of [...names].sort()) {
    const a = base.pedals[name];
    const b = now.pedals[name];
    if (!a) { added.push(name); continue; }
    if (!b) { removed.push(name); continue; }
    if (a.error || b.error) {
      moved.push(`${name}: error ${a.error ?? 'none'} -> ${b.error ?? 'none'}`);
      continue;
    }
    const deltas = [];
    for (const k of ['opaque', 'clear']) {
      if (Math.abs(a[k] - b[k]) > DRIFT) {
        deltas.push(`${k} ${(100 * a[k]).toFixed(1)}% -> ${(100 * b[k]).toFixed(1)}%`);
      }
    }
    for (const k of Object.keys(a.bands)) {
      if (Math.abs(a.bands[k] - b.bands[k]) > DRIFT) {
        deltas.push(`${k} ${(100 * a.bands[k]).toFixed(1)}% -> ${(100 * b.bands[k]).toFixed(1)}%`);
      }
    }
    if (a.w !== b.w || a.h !== b.h) deltas.push(`size ${a.w}x${a.h} -> ${b.w}x${b.h}`);
    if (deltas.length) moved.push(`${name}: ${deltas.join(', ')}`);
  }

  console.log(`baseline ${base.takenAt} (${base.measured} measured)`);
  console.log(`now      ${now.takenAt} (${now.measured} measured)`);
  console.log(`\n--- moved (>${100 * DRIFT}% in any share) ---`);
  moved.forEach((l) => console.log('  ' + l));
  if (!moved.length) console.log('  none');
  if (added.length) console.log(`\n--- new ---\n  ${added.join('\n  ')}`);
  if (removed.length) console.log(`\n--- gone ---\n  ${removed.join('\n  ')}`);
  console.log(`\n${moved.length} of ${names.size} pedals moved`);
}

main().catch((err) => { console.error(err); process.exit(1); });
