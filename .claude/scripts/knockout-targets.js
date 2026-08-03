#!/usr/bin/env node
/**
 * Run the real mirror pipeline over the three photos the knockout cannot cut
 * out, and measure the alpha channel it produces - without touching the DB or
 * the storage bucket.
 *
 * The 62 mirrored pedals are the regression corpus (fingerprint-pedal-alpha.js);
 * these three are the targets. Both halves are needed: a change that fixes
 * these and moves the 62 is not a fix.
 *
 * Sources are cached under .cache/ so the iteration loop costs no network.
 * Cut-out PNGs are written next to the cache for eyeballing - but per
 * knockout-fix-plan.md, the NUMBERS decide, not the picture.
 *
 * Usage: node .claude/scripts/knockout-targets.js
 */
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '../..');
const CACHE = path.join(__dirname, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

const { trimBackground, knockOutBackground, fetchImage } = require(path.join(ROOT, 'scraper/mirror-pedal-images.js'));

const TARGETS = {
  'Strymon Timeline': 'https://www.strymon.net/wp-content/uploads/2015/09/timeline_topdown_1600.jpg',
  'Strymon BigSky': 'https://www.strymon.net/wp-content/uploads/2016/02/bigsky_topdown_grad2_1600-1024x1024-1.jpeg',
  'BOSS DM-2W': 'https://static.roland.com/assets/images/products/gallery/dm-2w_top_gal.jpg',
};

async function source(name, url) {
  const file = path.join(CACHE, name.replace(/\W+/g, '_') + path.extname(new URL(url).pathname));
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const img = await fetchImage(url);
  if (!img) throw new Error(`fetch failed: ${url}`);
  fs.writeFileSync(file, img.buf);
  return img.buf;
}

const OPAQUE_A = 200;
const CLEAR_A = 20;

async function measure(buf) {
  const { data: px, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const cov = (x0, x1, y0, y1) => {
    let o = 0, t = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (px[(y * W + x) * C + 3] > OPAQUE_A) o++; }
    return t ? o / t : 0;
  };
  let opaque = 0, clear = 0;
  for (let i = 0; i < W * H; i++) {
    const a = px[i * C + 3];
    if (a > OPAQUE_A) opaque++; else if (a < CLEAR_A) clear++;
  }
  const r = (f) => Math.round(H * f), c = (f) => Math.round(W * f);
  const A = (x, y) => px[(y * W + x) * C + 3];
  return {
    w: W, h: H,
    opaque: opaque / (W * H), clear: clear / (W * H),
    top: cov(0, W, 0, r(0.1)), bottom: cov(0, W, r(0.9), H),
    left: cov(0, c(0.1), 0, H), right: cov(c(0.9), W, 0, H),
    middle: cov(c(0.4), c(0.6), r(0.4), r(0.6)),
    corners: [A(0, 0), A(W - 1, 0), A(0, H - 1), A(W - 1, H - 1)],
  };
}

const pct = (v) => (100 * v).toFixed(1).padStart(5) + '%';

(async () => {
  for (const [name, url] of Object.entries(TARGETS)) {
    const buf = await source(name, url);
    const meta = await sharp(buf).metadata();
    const cut = await knockOutBackground(buf);
    const proc = await trimBackground(buf);
    console.log(`\n=== ${name} ===`);
    console.log(`  source ${meta.width}x${meta.height} ${meta.format}`);
    console.log(`  knockOutBackground status: ${cut.status}`);
    console.log(`  trimBackground: trimmed=${proc.trimmed} rejected=${proc.rejected ?? '-'} dims=${proc.dims ?? '-'}`);
    if (!proc.trimmed) continue;
    const m = await measure(proc.buf);
    console.log(`  ${m.w}x${m.h}  opaque ${pct(m.opaque)}  clear ${pct(m.clear)}`);
    console.log(`  bands: top ${pct(m.top)}  bottom ${pct(m.bottom)}  left ${pct(m.left)}  right ${pct(m.right)}  middle ${pct(m.middle)}`);
    console.log(`  corners: ${m.corners.join(',')}`);
    fs.writeFileSync(path.join(CACHE, name.replace(/\W+/g, '_') + '_out.png'), proc.buf);
  }
})();
