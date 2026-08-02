#!/usr/bin/env node
/**
 * Mirror amp and pedalboard photos into the `pedal-images` bucket, on exactly
 * the terms the pedal mirror uses: bytes in our storage, origin recorded
 * beside them, written in one statement so a row can never serve an image
 * whose source we cannot name. See ../supabase/migrations/
 * 20260801000007_gear_image_provenance.sql for why the columns exist.
 *
 * The image PIPELINE (fetch -> knock out background -> trim -> attribute) is
 * imported from mirror-pedal-images.js rather than copied. Its knockout has a
 * regression history worth not rediscovering - see the centre-20% guard added
 * 2026-07-30 after JPEG-backed photos hollowed out into black blobs.
 *
 * WHAT IS DIFFERENT FROM PEDALS, and why:
 *
 * 1. No footprint-aspect gate. `acceptCandidate` requires an image whose
 *    aspect matches the pedal's width/depth, because the canvas stretches a
 *    pedal photo onto its physical footprint. Amps and boards are shown FACE
 *    ON in a library card - width over height, not width over depth - so that
 *    gate would reject every correct photo. Boards here run 4.0-4.8 wide
 *    against footprints of 1.4-3.6.
 *
 * 2. Sources are a fixed table, not a search. Every URL below was resolved
 *    with scraper/resolve-gear-image.js and then LOOKED AT. That is not
 *    ceremony: the failure mode for gear is not a dead URL, it is a live URL
 *    for the wrong object, and three of those turned up while building this
 *    table:
 *      - voxamps.com/product/ac30c2/ 302s to the AC30C2 *canvas cover* page.
 *        Mirroring "the AC30" would have stored a photo of a padded bag.
 *      - Pedaltrain's first product image is a composite of board AND gig bag
 *        AND velcro AND cable ties, on every one of the eight boards.
 *      - Pedaltrain's second is a 2000x2000 diagram watermarked
 *        PEDALBOARDPLANNER.COM - a third party's render, not Pedaltrain's
 *        photograph, and not ours to mirror.
 *    None of the three is detectable from the URL.
 *
 * 3. Boards come from the "and accessories (no case)" listings, whose widest
 *    frame is a clean front elevation of the bare board on white. The
 *    with-soft-case listings lead with the composite described above.
 *
 * Idempotent: rows already pointing at our storage WITH provenance are
 * skipped. DRY=1 to rehearse, FORCE=1 to re-mirror, ONLY=nano,katana to
 * restrict by name substring.
 *
 * Usage: node scraper/mirror-gear-images.js
 */
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const { fetchImage, trimBackground, provenanceFor } = require('./mirror-pedal-images');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUR_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const BUCKET = 'pedal-images';

/**
 * `page` is the product page a human can open to check the photo is of the
 * thing it claims to be; `image` is where the bytes come from. Both are
 * stored: `page` resolves the licence when `image` is on a shared asset CDN
 * (Contentful for Marshall, Shopify's CDN for Fender and Mesa).
 */
const AMP_SOURCES = {
  'BOSS Katana 100': {
    page: 'https://www.boss.info/us/products/katana-100/',
    // The og:image is only 386x330; the gallery's front view is 1224x1050.
    image: 'https://static.roland.com/assets/images/products/gallery/ktn-100_F_gal.jpg',
  },
  'EVH 5150': {
    page: 'https://www.evhgear.com/gear/amplifiers/head/5150iii-100w-head/2251000000',
    image: 'https://www.fmicassets.com/Damroot/EVHPDP/10002/2251000000_amp_frt_001_nr.png',
  },
  'Fender Deluxe Reverb': {
    page: 'https://www.fender.com/products/65-deluxe-reverb',
    image: 'https://www.fender.com/cdn/shop/files/0217400000_amp_frt_001_nr.png',
  },
  'Fender Blues Deluxe': {
    page: 'https://www.fender.com/products/blues-deluxe-reissue',
    image: 'https://www.fender.com/cdn/shop/files/2232200000_amp_frt_001_nr.png',
  },
  'Fender Twin Reverb': {
    page: 'https://www.fender.com/products/65-twin-reverb',
    image: 'https://www.fender.com/cdn/shop/files/0217300000_amp_frt_001_nr.png',
  },
  /*
   * BOTH Marshalls take the PNG asset, not the og:image or the gallery JPEGs.
   *
   * Marshall photographs black amplifiers against a dark grey backdrop
   * measuring (63,63,63). The knockout floods inward from the border absorbing
   * anything within BG_TOL=35 of that, i.e. luminance 28-98 - and the shadowed
   * left edge of a black cabinet sits inside that band. So the fill walks out
   * of the backdrop and straight into the amp, taking ragged bites out of its
   * silhouette. Every JPEG on both pages fails this way; the pipeline's
   * centre-20% guard correctly rejects all of them.
   *
   * The PNGs already ship a real alpha silhouette, so the knockout takes its
   * `already-cutout` path and never floods at all. They are also straight-on
   * front views, which matches the other ten amps better than the 3/4 angle.
   *
   * If these URLs ever rot, do NOT reach for a JPEG from the same gallery: it
   * will look plausible in the report (it trims, it has sane dimensions) and
   * arrive with holes chewed in the cabinet.
   */
  // Our row is "Plexi", the amp; Marshall's product is the 1959 Handwired,
  // which is the current handwired reissue of that same 1959 Super Lead.
  'Marshall Plexi': {
    page: 'https://www.marshall.com/us/en/product/1959-handwired-head?pid=1007086',
    // -02, not -04: -04 is a close-up of the valves with the chassis open.
    image: 'https://images.ctfassets.net/javen7msabdh/u7jN2k14rGnNCf6Nri8NY/15392eeb95d3ff690a734e2a3ed9e6a3/1959hw-full-width-desktop-02.png',
  },
  'Marshall JCM800': {
    page: 'https://www.marshall.com/us/en/product/jcm800-2203-vintage-reissue-head?pid=1007097',
    image: 'https://images.ctfassets.net/javen7msabdh/6LcTWYpDRqqHEW5jI8FSuX/b2a028337d4bf8ed080525a1c26d7132/marshall-jcm800-desktop.png',
  },
  // Mesa/Boogie is sold through gibson.com now; mesaboogie.com product paths
  // all serve one SPA shell, so the Shopify product JSON is the real source.
  'Mesa/Boogie Dual Rectifier': {
    page: 'https://www.gibson.com/products/mesa-boogie-dual-rectifier-head-black-taurus',
    image: 'https://cdn.shopify.com/s/files/1/0659/3966/9171/files/2.DR.1.B.LC_1_Front.png',
  },
  'Mesa/Boogie Mark V': {
    page: 'https://www.gibson.com/products/mesa-boogie-mark-v-medium-head-black-taurus',
    image: 'https://cdn.shopify.com/s/files/1/0659/3966/9171/files/2.MVM.BB_1_Front.png',
  },
  // Vox builds its galleries in JS and publishes no og:image; these are the
  // only product-specific frames on the AC30/AC15 Custom pages.
  //
  // The live AC30 frame is 375x302 - the weakest of the mirrored set, soft
  // above card size. Vox publishes nothing larger on the current page, but its
  // OLD site did: the 2014 capture of voxamps.com/ac30c2 carries a 1000x400
  // product-slider frame whose amp subject is about 500x380, a third larger
  // linearly than the live one. Same amp, same manufacturer photography, and
  // provenanceFor resolves an archived URL's inner licence correctly.
  //
  // The trade is a red gradient background where the live frame has a clean
  // one, so this is only worth keeping while the knockout handles it - which
  // is what verify-photo-knockout.js and verify-gear-images.js are for. Revert
  // to the line below if either ever disagrees.
  //   image: 'https://voxamps.com/wp-content/uploads/2019/01/AC30C2_2_resized.png'
  'Vox AC30': {
    page: 'https://web.archive.org/web/20140623143200/http://www.voxamps.com/ac30c2',
    image: 'https://web.archive.org/web/20140623143200im_/http://www.voxamps.com/uploads/Product_Slider/Custom_AC30C2_Front.jpg',
  },
  'Vox AC15': {
    page: 'https://voxamps.com/product/the-vox-ac15-custom/',
    image: 'https://voxamps.com/wp-content/uploads/2019/01/AC15C1-AC15-custom-amplifier.png',
  },
};

/**
 * Deliberately unsourced. Recorded here rather than left as a silent gap so
 * the next person does not repeat the search.
 *
 * The JCM2000 DSL was discontinued and marshall.com carries no page for it -
 * not in the current catalogue, not under /amps/products/archive (which now
 * 302s to the live amplifier listing), and the Wayback Machine has no
 * marshall.com JCM2000 capture at all (CDX query returns []). The current
 * DSL100HR is the successor, not the same amp, so mirroring its photo would
 * put a picture of the wrong amplifier behind a row that names this one.
 * A row with no image falls back to the text card, which is honest.
 */
const UNSOURCED = {
  'Marshall JCM2000 DSL':
    'discontinued; no marshall.com page and no Wayback capture. DSL100HR is a different amp. ' +
    'Wikimedia Commons checked 2026-08-02 and is exhausted, not merely unsearched: the only ' +
    'JCM2000-series files are two amateur in-situ photos of a DSL401 combo, both CC BY 2.0 ' +
    '(so the licence would have been fine - not the BY-SA trap). Rejected on the photo, not the ' +
    'terms. "Marshall DSL401 - My trusty amp.jpg" has the amp at an angle, a microphone stood in ' +
    'front of the grille, CD spindles on top and a pedalboard across its feet; the other pairs it ' +
    'with a guitar. Neither can be knocked out to a clean silhouette. Everything else Commons ' +
    'returns for "Marshall JCM" is a JCM800 or JCM900 - different amps. What would settle this is ' +
    'a studio product shot, so a Reverb/retailer listing or an owner photo taken for the purpose ' +
    'is the remaining route, NOT another Commons search.',
};

const BOARD_SOURCES = {
  'Pedaltrain Classic 1': {
    page: 'https://pedaltrain.com/products/pedaltrain-classic-1-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/classic-1-with-soft-case-pedal-boards-pt-cl1-sc-pedaltrain-6.jpg',
  },
  'Pedaltrain Classic 2': {
    page: 'https://pedaltrain.com/products/pedaltrain-classic-2-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/classic-2-with-soft-case-pedal-boards-pt-cl2-sc-pedaltrain-6.jpg',
  },
  'Pedaltrain Classic Jr': {
    page: 'https://pedaltrain.com/products/pedaltrain-classic-jr-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/classic-jr-with-soft-case-pedal-boards-pt-clj-sc-pedaltrain-6.jpg',
  },
  'Pedaltrain Classic Pro': {
    page: 'https://pedaltrain.com/products/pedaltrain-classic-pro-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/classic-pro-with-soft-case-pedal-boards-pt-clp-sc-pedaltrain-6.jpg',
  },
  'Pedaltrain Metro 16': {
    page: 'https://pedaltrain.com/products/pedaltrain-metro-16-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/metro-16-with-soft-case-pedal-boards-pt-m16-sc-pedaltrain-3.jpg',
  },
  'Pedaltrain Metro 20': {
    page: 'https://pedaltrain.com/products/pedaltrain-metro-20-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/metro-20-with-soft-case-pedal-boards-pt-m20-sc-pedaltrain-3.jpg',
  },
  'Pedaltrain Nano': {
    page: 'https://pedaltrain.com/products/pedaltrain-nano-and-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/nano-with-soft-case-pedal-boards-pt-nano-sc-pedaltrain-3.jpg',
  },
  'Pedaltrain Nano+': {
    page: 'https://pedaltrain.com/products/pedaltrain-nano-plus-accessories-no-case',
    image: 'https://cdn.shopify.com/s/files/1/1849/5803/products/nano-with-soft-case-pedal-boards-pt-npl-sc-pedaltrain-3.jpg',
  },
};

/**
 * Independent re-measurement of the knockout regression signature on the
 * bytes we are about to STORE, rather than trusting that the guard inside
 * knockOutBackground did not fire. Healthy silhouettes leave the centre of
 * the frame opaque; a fill that leaked into the subject hollows it out.
 * Measured over the 64 mirrored pedals the split was 0-0.49% healthy against
 * 4.48-91% damaged, so anything above 2% is refused rather than served.
 */
async function centreTransparency(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const x0 = Math.floor(W * 0.4), x1 = Math.ceil(W * 0.6);
  const y0 = Math.floor(H * 0.4), y1 = Math.ceil(H * 0.6);
  let clear = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (data[(y * W + x) * C + 3] < 20) clear++;
    }
  }
  return clear / total;
}
const MAX_CENTRE_TRANSPARENT = 0.02;

async function mirrorOne(table, row, source) {
  const label = `${row.manufacturer} ${row.name}`;
  const img = await fetchImage(source.image);
  if (!img) return { label, status: 'fetch-failed' };

  const processed = await trimBackground(img.buf);
  if (!processed.trimmed) {
    return { label, status: `rejected:${processed.rejected ?? 'trim-failed'}` };
  }
  const centre = await centreTransparency(processed.buf);
  if (centre > MAX_CENTRE_TRANSPARENT) {
    return { label, status: `rejected:subject-eaten(${(centre * 100).toFixed(1)}% centre clear)` };
  }

  const [w, h] = processed.dims;
  const { license, attribution } = provenanceFor(source.image, source.page);
  const detail = `${w}x${h}, centre ${(centre * 100).toFixed(2)}% clear, [${license}]`;

  if (process.env.DRY) return { label, status: 'would-mirror', detail, url: source.image };

  const path = `${table}/${row.id}.png`;
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, processed.buf, { contentType: 'image/png', upsert: true });
  if (upErr) return { label, status: `upload-failed:${upErr.message}` };

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  // Versioned for the same reason pedals are: the bucket serves max-age=3600
  // against a reused path, so without this a re-mirror shows the old image.
  const { error: dbErr } = await sb
    .from(table)
    .update({
      image_url: `${pub.publicUrl}?v=${Date.now()}`,
      image_source_url: source.image,
      image_license: license,
      image_attribution: attribution,
      image_fetched_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (dbErr) return { label, status: `db-failed:${dbErr.message}` };

  return { label, status: 'mirrored', detail, url: source.image };
}

async function pass(table, sources) {
  const { data: rows, error } = await sb
    .from(table)
    .select('id,name,manufacturer,image_url,image_source_url');
  if (error) throw new Error(`${table}: ${error.message}`);

  const results = [];
  for (const row of rows) {
    const label = `${row.manufacturer} ${row.name}`;
    if (
      process.env.ONLY &&
      !process.env.ONLY.toLowerCase().split(',').some((s) => label.toLowerCase().includes(s.trim()))
    ) continue;

    if (UNSOURCED[label]) {
      results.push({ label, status: 'unsourced', detail: UNSOURCED[label] });
      continue;
    }
    const source = sources[label];
    if (!source) {
      results.push({ label, status: 'no-source-entry' });
      continue;
    }
    if (!process.env.FORCE && row.image_url?.includes(OUR_HOST) && row.image_source_url) {
      results.push({ label, status: 'skipped (already ours)' });
      continue;
    }
    results.push(await mirrorOne(table, row, source));
  }
  return results;
}

async function main() {
  const all = [
    ...(await pass('amps', AMP_SOURCES)),
    ...(await pass('boards', BOARD_SOURCES)),
  ];
  const by = (s) => all.filter((r) => r.status.startsWith(s));
  console.log(
    `${process.env.DRY ? '[DRY] ' : ''}` +
    `mirrored: ${by('mirrored').length + by('would-mirror').length} | ` +
    `skipped: ${by('skipped').length} | unsourced: ${by('unsourced').length} | ` +
    `failed: ${by('rejected').length + by('fetch-failed').length + by('upload-failed').length + by('db-failed').length + by('no-source').length}`
  );
  for (const r of all) {
    console.log(` ${r.status.padEnd(34)} ${r.label}${r.detail ? '  ' + r.detail : ''}`);
    if (r.url) console.log(`   ${' '.repeat(33)} <- ${r.url}`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { AMP_SOURCES, BOARD_SOURCES, UNSOURCED, centreTransparency };
