#!/usr/bin/env node
/**
 * The regression gate for any change to the knockout.
 *
 * The 62 mirrored pedals that currently look right ARE the corpus - there is
 * no other ground truth for what a real photograph should cut out to. This
 * re-runs the mirror pipeline over each pedal's recorded ORIGIN image and
 * compares the alpha it produces against the fingerprint of the bytes now in
 * storage (.claude/docs/knockout-fingerprint.json).
 *
 * It writes NOTHING - no storage, no DB. That is deliberate: re-mirroring for
 * real to find out whether a change was safe would have already replaced the
 * catalogue by the time the answer arrived.
 *
 * Usage: node .claude/scripts/knockout-regression.js [--only=ds-1,rat]
 * Exits non-zero if any pedal moved by more than DRIFT in any recorded share.
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: '.env.local' });

const { trimBackground, fetchImage, PEDAL_OVERRIDES } = require('./../../scraper/mirror-pedal-images.js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASELINE = path.join(__dirname, '../docs/knockout-fingerprint.json');
const CACHE = path.join(__dirname, '.cache/sources');
fs.mkdirSync(CACHE, { recursive: true });

/** Material movement in any recorded share. Below this is PNG/JPEG noise. */
const DRIFT = 0.02;
/** Relative size change treated as a real silhouette change, not trim noise. */
const SIZE_DRIFT = 0.01;
const OPAQUE_A = 200;
const CLEAR_A = 20;

async function measure(buf) {
  const { data: px, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const cov = (x0, x1, y0, y1) => {
    let o = 0;
    let t = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        t++;
        if (px[(y * W + x) * C + 3] > OPAQUE_A) o++;
      }
    }
    return t ? +(o / t).toFixed(4) : 0;
  };
  let opaque = 0;
  let clear = 0;
  for (let i = 0; i < W * H; i++) {
    const a = px[i * C + 3];
    if (a > OPAQUE_A) opaque++;
    else if (a < CLEAR_A) clear++;
  }
  const r = (f) => Math.round(H * f);
  const c = (f) => Math.round(W * f);
  return {
    w: W,
    h: H,
    opaque: +(opaque / (W * H)).toFixed(4),
    clear: +(clear / (W * H)).toFixed(4),
    bands: {
      top: cov(0, W, 0, r(0.1)),
      bottom: cov(0, W, r(0.9), H),
      left: cov(0, c(0.1), 0, H),
      right: cov(c(0.9), W, 0, H),
      middle: cov(c(0.4), c(0.6), r(0.4), r(0.6)),
    },
  };
}

/** Cached download, so an iteration loop over the corpus costs no network. */
async function sourceBytes(key, url) {
  const file = path.join(CACHE, key.replace(/\W+/g, '_'));
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const img = await fetchImage(url);
  if (!img) return null;
  fs.writeFileSync(file, img.buf);
  return img.buf;
}

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).toLowerCase().split(',');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const { data: pedals, error } = await sb
    .from('pedals')
    .select('id,name,manufacturer,image_url,image_source_url')
    .order('manufacturer')
    .order('name');
  if (error) throw error;

  const moved = [];
  const trivial = [];
  const unfetchable = [];
  let checked = 0;

  for (const p of pedals) {
    const key = `${p.manufacturer} ${p.name}`;
    if (!p.image_url || !p.image_source_url) continue;
    if (only && !only.some((s) => key.toLowerCase().includes(s.trim()))) continue;
    const base = baseline.pedals[key];
    if (!base || base.error) continue;

    const buf = await sourceBytes(key, p.image_source_url);
    if (!buf) { unfetchable.push(key); continue; }
    // Re-run under the SAME per-pedal options the mirror would use. Without
    // this the harness reproduces a pipeline nobody runs, and reports every
    // overridden pedal as a regression against its own stored bytes.
    const processed = await trimBackground(buf, {
      rect: PEDAL_OVERRIDES[key]?.mode === 'rect',
      outline: PEDAL_OVERRIDES[key]?.mode === 'outline',
      close: PEDAL_OVERRIDES[key]?.close === true,
      strict: PEDAL_OVERRIDES[key]?.strict === true,
    });
    if (!processed.trimmed) {
      moved.push(`${key}: pipeline now REJECTS its own source (${processed.rejected ?? 'trim failed'})`);
      checked++;
      continue;
    }
    const now = await measure(processed.buf);
    checked++;

    const deltas = [];
    for (const k of ['opaque', 'clear']) {
      if (Math.abs(base[k] - now[k]) > DRIFT) {
        deltas.push(`${k} ${(100 * base[k]).toFixed(1)}% -> ${(100 * now[k]).toFixed(1)}%`);
      }
    }
    for (const k of Object.keys(base.bands)) {
      if (Math.abs(base.bands[k] - now.bands[k]) > DRIFT) {
        deltas.push(`${k} ${(100 * base.bands[k]).toFixed(1)}% -> ${(100 * now.bands[k]).toFixed(1)}%`);
      }
    }
    // A size change means the trim found a different silhouette. A pixel or
    // two is the trim threshold landing on the other side of an anti-aliased
    // edge and says nothing; the canvas stretches the photo to the pedal's
    // physical footprint, so only a change big enough to alter proportions
    // matters. Judged relatively, and reported separately from share moves.
    const dw = Math.abs(base.w - now.w) / base.w;
    const dh = Math.abs(base.h - now.h) / base.h;
    const sizeMoved = Math.max(dw, dh) > SIZE_DRIFT;
    if (sizeMoved) deltas.push(`size ${base.w}x${base.h} -> ${now.w}x${now.h}`);
    else if (base.w !== now.w || base.h !== now.h) trivial.push(`${key}: ${base.w}x${base.h} -> ${now.w}x${now.h}`);

    if (deltas.length) moved.push(`${key}: ${deltas.join(', ')}`);
    process.stdout.write(deltas.length ? 'x' : '.');
  }

  console.log(`\n\n${checked} pedals re-run against the stored fingerprint (baseline ${baseline.takenAt})`);
  if (unfetchable.length) {
    console.log(`\n--- source no longer fetchable (not judged) ---`);
    unfetchable.forEach((l) => console.log('  ' + l));
  }
  if (trivial.length) {
    console.log(`\n--- size moved <=${100 * SIZE_DRIFT}%, trim landing the other side of an anti-aliased edge ---`);
    trivial.forEach((l) => console.log('  ' + l));
  }
  console.log(`\n--- MOVED (>${100 * DRIFT}% in any share, or >${100 * SIZE_DRIFT}% in size) ---`);
  if (!moved.length) console.log('  none');
  moved.forEach((l) => console.log('  ' + l));
  console.log(`\nRESULT: ${moved.length ? `${moved.length} REGRESSION(S)` : 'no pedal moved'}`);
  process.exit(moved.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
