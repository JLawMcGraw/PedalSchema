#!/usr/bin/env node
/**
 * Mirror pedal images into the Supabase `pedal-images` storage bucket.
 *
 * For every pedal in the DB:
 *  - build candidate manufacturer-CDN URLs, TOP-DOWN images first
 *    (BOSS/Roland pattern: static.roland.com/products/{slug}/images/{slug}_top.png,
 *     with /image/ + .jpg + _hero fallbacks; any existing image_url last)
 *  - download the first candidate that returns a real image
 *  - upload to pedal-images/system/{pedal_id}.{ext}
 *  - rewrite pedals.image_url to our storage public URL
 *
 * Idempotent: pedals whose image_url already points at our storage are
 * skipped unless FORCE=1. Dry run with DRY=1.
 *
 * Usage: node scraper/mirror-pedal-images.js
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUR_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;

/**
 * Non-BOSS pedals: entries are either manufacturer product pages (we mirror
 * their og:image) or direct image URLs (anything ending in an image
 * extension). Every candidate still passes the trim + footprint-aspect gate,
 * so a page with only lifestyle shots simply results in the rect fallback.
 * Klon has no manufacturer site (discontinued boutique) - intentionally absent.
 *
 * Direct-URL notes (2026-07-19):
 *  - EHX og:images are lifestyle shots (fail the gate); the numbered
 *    WooCommerce gallery images ("...-1.jpg") are the face-on product shots.
 *  - tcelectronic.com legacy pages are gone and mediadl.musictribe.com no
 *    longer resolves; the Top_XL product shots survive on the Wayback Machine
 *    ("im_" suffix serves the raw archived image).
 *  - ProCo moved under distributor actentertainment.com (procosound.com is
 *    dead - broken TLS chain and 404s).
 *  - Cry Baby's og:image is angled; the BigCommerce gallery has a real
 *    top view (TOPP).
 */
const PRODUCT_PAGES = {
  'Ibanez TS9 Tube Screamer': ['https://www.ibanez.com/usa/products/detail/ts9_99.html'],
  'MXR Phase 90': ['https://www.jimdunlop.com/mxr-phase-90/'],
  'MXR Dyna Comp': ['https://www.jimdunlop.com/mxr-dyna-comp-compressor/'],
  'MXR Carbon Copy': ['https://www.jimdunlop.com/mxr-carbon-copy-analog-delay/'],
  'Dunlop Cry Baby GCB95': [
    'https://cdn11.bigcommerce.com/s-n26aknlnlm/images/stencil/1280x1280/products/583/6160/11095000001.TOPP__06867.1663874792.jpg?c=2',
    'https://www.jimdunlop.com/cry-baby-standard-wah/',
  ],
  'Dunlop Fuzz Face': [
    'https://www.jimdunlop.com/dunlop-fuzz-face-distortion/',
    'https://www.jimdunlop.com/jimi-hendrix-fuzz-face-distortion/',
  ],
  'Electro-Harmonix Big Muff Pi': [
    'https://www.ehx.com/wp-content/uploads/2020/10/usbm-1.jpg',
    'https://www.ehx.com/products/big-muff-pi/',
  ],
  'Electro-Harmonix Small Clone': [
    'https://www.ehx.com/wp-content/uploads/2020/10/clone-1.jpg',
    'https://www.ehx.com/products/small-clone/',
  ],
  'Electro-Harmonix Holy Grail': [
    'https://www.ehx.com/wp-content/uploads/2020/10/HolyGrailNeo_-1.jpg',
    'https://www.ehx.com/products/holy-grail-neo/',
  ],
  'Strymon Timeline': ['https://www.strymon.net/product/timeline/'],
  'Strymon BigSky': ['https://www.strymon.net/product/bigsky/'],
  'TC Electronic Polytune 3': [
    'https://web.archive.org/web/20211010004401im_/https://mediadl.musictribe.com/media/PLM/data/images/products/P0CM0/2000Wx2000H/POLYTUNE-3_P0CM0_Top_XL.png',
  ],
  'TC Electronic Ditto Looper': [
    'https://web.archive.org/web/20230208191559im_/https://mediadl.musictribe.com/media/PLM/data/images/products/P0DD4/2000Wx2000H/DITTO-LOOPER_P0DD4_Top_XL.png',
  ],
  'Pro Co RAT 2': ['https://actentertainment.com/rat-2-distortion-pedal/'],
};

/** Entries matching this are fetched as images directly, not scraped for og:image */
const IMAGE_URL_RE = /\.(png|jpe?g|webp)(\?\S*)?$/i;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function ogImageOf(pageUrl) {
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]*property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (!m) return null;
    let url = m[1];
    if (url.startsWith('//')) url = 'https:' + url;
    return url;
  } catch {
    return null;
  }
}

/** "IR-200Amp & IR Cabinet" -> "ir-200"; "TU-3" -> "tu-3" */
function bossSlug(name) {
  const m = name.match(/^([A-Z]{2,3})-?(\d+)(W|X)?/i);
  if (!m) return null;
  return `${m[1]}-${m[2]}${m[3] ?? ''}`.toLowerCase();
}

function candidatesFor(pedal) {
  const urls = [];
  const push = (u) => { if (u && !urls.includes(u)) urls.push(u); };

  if (pedal.manufacturer === 'BOSS') {
    const slug = bossSlug(pedal.name);
    if (slug) {
      const slugForms = [slug.replace(/-/g, '_'), slug];
      // ALL top-down candidates first, across every known URL family...
      for (const dir of ['images', 'image']) {
        for (const ext of ['png', 'jpg']) {
          push(`https://static.roland.com/products/${slug}/${dir}/${slug}_top.${ext}`);
        }
      }
      for (const s of slugForms) {
        push(`https://static.roland.com/assets/images/products/gallery/${s}_top_gal.jpg`);
        push(`https://static.roland.com/assets/images/products/main/${s}_top_main.jpg`);
      }
      // ...then hero/angled fallbacks
      for (const dir of ['images', 'image']) {
        push(`https://static.roland.com/products/${slug}/${dir}/${slug}_hero.jpg`);
      }
      for (const s of slugForms) {
        push(`https://static.roland.com/assets/images/products/gallery/${s}_image_gal.jpg`);
        push(`https://static.roland.com/assets/images/products/gallery/${s}_main_gal.jpg`);
        push(`https://static.roland.com/assets/images/products/gallery/${s}_angle_gal.jpg`);
        push(`https://static.roland.com/assets/images/products/main/${s}_main.jpg`);
      }
    }
  }

  // Existing CDN URL (and its _top sibling, tried FIRST)
  if (pedal.image_url && !pedal.image_url.includes(OUR_HOST)) {
    const top = pedal.image_url
      .replace(/_hero\.(jpg|png)$/, '_top.png')
      .replace(/\/features\/images\/.*$/, '');
    if (top !== pedal.image_url && /_top\.(png|jpg)$/.test(top)) urls.unshift(top);
    push(pedal.image_url);
  }
  return urls;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      // generous: web.archive.org can take >15s to serve an archived image
      signal: AbortSignal.timeout(60000),
      headers: { 'User-Agent': BROWSER_UA },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048) return null; // placeholder/error pixel
    return { buf, type };
  } catch {
    return null;
  }
}

/**
 * Trim the uniform background border (white/transparent product-shot
 * padding) so the pedal face spans the full image. The canvas stretches
 * the image to the pedal's exact physical footprint - untrimmed padding
 * is what made photos look cropped/zoomed on the board.
 * Falls back to the original buffer if trimming fails or eats the image.
 */
/**
 * Knock out the studio background so the stored PNG is a true pedal
 * silhouette (the canvas draws it straight on the board - any opaque
 * white margin reads as a fake box around the pedal).
 *
 * Flood fill from every border pixel, absorbing pixels whose color stays
 * within BG_TOL per channel of the border's average background color, OR
 * that continue a smooth gradient from an absorbed neighbor (studio
 * backdrops fade 240->110 on the 200-series shots). Gradient-following
 * never enters dark pixels so it can't creep through a drop shadow into a
 * black enclosure. Edge-connected only - white knobs/labels on the pedal
 * face are interior and can't be reached, so they survive. Images that
 * already ship a meaningful alpha silhouette (BOSS/Ibanez/TC PNGs) are
 * left untouched, and a knockout that eats >90% of the frame reverts.
 */
const BG_TOL = 35;
const BG_GRAD_TOL = 12;
const BG_GRAD_MIN_LUM = 90;

async function knockOutBackground(buf) {
  const { data: px, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);

  // Already a silhouette? (a real alpha edge, not just an alpha channel)
  let transparent = 0;
  for (const i of border) if (px[i * C + 3] < 20) transparent++;
  if (transparent > border.length * 0.3) return buf;

  // Average opaque border color = background reference
  let r = 0, g = 0, b = 0, n = 0;
  for (const i of border) {
    if (px[i * C + 3] < 20) continue;
    r += px[i * C]; g += px[i * C + 1]; b += px[i * C + 2]; n++;
  }
  if (!n) return buf;
  r /= n; g /= n; b /= n;

  const isBg = (i) =>
    px[i * C + 3] >= 20 &&
    Math.abs(px[i * C] - r) <= BG_TOL &&
    Math.abs(px[i * C + 1] - g) <= BG_TOL &&
    Math.abs(px[i * C + 2] - b) <= BG_TOL;

  const lum = (i) => 0.299 * px[i * C] + 0.587 * px[i * C + 1] + 0.114 * px[i * C + 2];

  // j continues a smooth, light gradient from already-background i
  const chains = (i, j) =>
    px[j * C + 3] >= 20 &&
    lum(j) >= BG_GRAD_MIN_LUM &&
    Math.abs(px[j * C] - px[i * C]) <= BG_GRAD_TOL &&
    Math.abs(px[j * C + 1] - px[i * C + 1]) <= BG_GRAD_TOL &&
    Math.abs(px[j * C + 2] - px[i * C + 2]) <= BG_GRAD_TOL;

  const visited = new Uint8Array(W * H);
  const queue = [];
  for (const i of border) {
    if (!visited[i] && (isBg(i) || (px[i * C + 3] >= 20 && lum(i) >= BG_GRAD_MIN_LUM))) {
      visited[i] = 1;
      queue.push(i);
    }
  }
  let knocked = 0;
  const knockedIdx = [];
  while (queue.length) {
    const i = queue.pop();
    knocked++;
    knockedIdx.push(i);
    const x = i % W;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= W * H) continue;
      if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
      if (!visited[j] && (isBg(j) || chains(i, j))) { visited[j] = 1; queue.push(j); }
    }
  }
  // A knockout that ate (almost) the whole frame leaked into the subject
  if (knocked > W * H * 0.9) return buf;
  for (const i of knockedIdx) px[i * C + 3] = 0;

  return sharp(px, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
}

async function trimBackground(buf) {
  try {
    const meta = await sharp(buf).metadata();
    const cutout = await knockOutBackground(buf);
    const trimmed = await sharp(cutout).trim({ threshold: 25 }).png().toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;
    // Sanity: a real trim keeps most of the subject
    if (width < 40 || height < 40 || width * height < meta.width * meta.height * 0.02) {
      return { buf, type: null, trimmed: false };
    }
    return { buf: trimmed.data, type: 'image/png', trimmed: true, dims: [width, height] };
  } catch {
    return { buf, type: null, trimmed: false };
  }
}

/**
 * A usable board image must LOOK like the pedal seen face-on: after
 * trimming, its aspect ratio must be close to the pedal's physical
 * width/depth footprint (the canvas stretches it to exactly that box).
 * Wide lifestyle/angled hero shots fail this and are rejected - a clean
 * category-colored rect beats a squished photo.
 */
const ASPECT_MIN = 0.65;
const ASPECT_MAX = 1.5;

async function acceptCandidate(url, physicalAspect) {
  const img = await fetchImage(url);
  if (!img) return null;
  const processed = await trimBackground(img.buf);
  if (!processed.trimmed) return null;
  const [w, h] = processed.dims;
  const ratio = (w / h) / physicalAspect;
  if (ratio < ASPECT_MIN || ratio > ASPECT_MAX) return null;
  return { url, buf: processed.buf, type: 'image/png', dims: processed.dims, ratio };
}

async function main() {
  const { data: pedals, error } = await sb.from('pedals')
    .select('id,name,manufacturer,image_url,width_inches,depth_inches');
  if (error) throw error;

  const report = { mirrored: [], topDown: 0, skipped: [], missed: [], cleared: [] };

  for (const pedal of pedals) {
    // ONLY=ds-1,rat re-runs just matching pedals (name substring, comma-separated)
    if (
      process.env.ONLY &&
      !process.env.ONLY.toLowerCase().split(',').some((s) => pedal.name.toLowerCase().includes(s.trim()))
    ) {
      continue;
    }
    if (!process.env.FORCE && pedal.image_url?.includes(OUR_HOST)) {
      report.skipped.push(pedal.name);
      continue;
    }
    const physicalAspect = pedal.width_inches / pedal.depth_inches;
    let hit = null;
    for (const url of candidatesFor(pedal)) {
      hit = await acceptCandidate(url, physicalAspect);
      if (hit) break;
    }
    // Last resort for BOSS: the product page's og:image is authoritative
    // (covers compact slugs like ph3_2_main.jpg). Try its _top sibling first.
    if (!hit && pedal.manufacturer === 'BOSS') {
      const slug = bossSlug(pedal.name);
      if (slug) {
        try {
          const res = await fetch(`https://www.boss.info/us/products/${slug}/`, {
            redirect: 'follow', signal: AbortSignal.timeout(15000),
          });
          const og = res.ok
            ? (await res.text()).match(/property="og:image" content="([^"]+)"/)?.[1]
            : null;
          if (og) {
            const topSibling = og
              .replace('/main/', '/gallery/')
              .replace(/(_\d+)?_main\.jpg$/, '_top_gal.jpg');
            for (const url of [topSibling, og]) {
              hit = await acceptCandidate(url, physicalAspect);
              if (hit) break;
            }
          }
        } catch { /* fall through to missed */ }
      }
    }
    // Non-BOSS: curated pages -> og:image, or direct image URLs (same gate)
    if (!hit) {
      const sources = PRODUCT_PAGES[`${pedal.manufacturer} ${pedal.name}`] ?? [];
      for (const src of sources) {
        const url = IMAGE_URL_RE.test(src) ? src : await ogImageOf(src);
        if (!url) continue;
        hit = await acceptCandidate(url, physicalAspect);
        if (hit) break;
      }
    }
    if (!hit) {
      report.missed.push(`${pedal.manufacturer} ${pedal.name}`);
      // If a previous run stored a now-rejected image (e.g. a squished
      // hero), clear it so the canvas shows the clean rect fallback
      if (!process.env.DRY && pedal.image_url?.includes(OUR_HOST)) {
        await sb.storage.from('pedal-images')
          .remove([`system/${pedal.id}.png`, `system/${pedal.id}.jpg`]);
        await sb.from('pedals').update({ image_url: null }).eq('id', pedal.id);
        report.cleared.push(pedal.name);
      }
      continue;
    }

    const path = `system/${pedal.id}.png`;
    if (!process.env.DRY) {
      const { error: upErr } = await sb.storage.from('pedal-images')
        .upload(path, hit.buf, { contentType: hit.type, upsert: true });
      if (upErr) { report.missed.push(`${pedal.name} (upload: ${upErr.message})`); continue; }
      // Drop the legacy .jpg sibling so re-mirrors don't leave stale objects
      await sb.storage.from('pedal-images').remove([`system/${pedal.id}.jpg`]);
      const { data: pub } = sb.storage.from('pedal-images').getPublicUrl(path);
      // Version the URL: uploads reuse the same storage path, and the public
      // bucket serves max-age=3600 - without a fresh query string, browsers
      // keep showing the previous image for up to an hour after a re-mirror.
      const versionedUrl = `${pub.publicUrl}?v=${Date.now()}`;
      const { error: dbErr } = await sb.from('pedals')
        .update({ image_url: versionedUrl }).eq('id', pedal.id);
      if (dbErr) { report.missed.push(`${pedal.name} (db: ${dbErr.message})`); continue; }
    }
    const isTop = /_top[._]/.test(hit.url);
    if (isTop) report.topDown++;
    report.mirrored.push(
      `${pedal.name} <- ${hit.url} (${isTop ? 'TOP' : 'face'}, ${hit.dims.join('x')}, aspect ratio ${hit.ratio.toFixed(2)}x of footprint)`
    );
  }

  console.log(`mirrored: ${report.mirrored.length} (${report.topDown} top-down) | skipped (already ours): ${report.skipped.length} | missed: ${report.missed.length} | cleared stale: ${report.cleared.length}`);
  console.log('--- mirrored ---');
  report.mirrored.forEach(l => console.log(' ', l));
  console.log('--- missed (rect fallback) ---');
  report.missed.forEach(l => console.log(' ', l));
}

main().catch(err => { console.error(err); process.exit(1); });
