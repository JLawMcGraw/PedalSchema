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
 *  - rewrite pedals.image_url to our storage public URL, RECORDING the origin
 *    URL, licence and fetch time alongside it
 *
 * Provenance is not optional: we never serve an image whose origin we cannot
 * name. Every row we write sets image_source_url with image_url, and every row
 * we clear nulls both together, so the two can never disagree. See the rights
 * statement in ../README.md and ./README.md - that contract is what makes a
 * takedown request answerable without re-running candidate search.
 *
 * Idempotent: pedals whose image_url already points at our storage are
 * skipped unless FORCE=1 - but a row missing provenance is re-mirrored even
 * when it already points at us, so one normal run backfills the legacy rows.
 * Dry run with DRY=1.
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
  // The PRODUCT PAGE's og:image is the grey-gradient studio shot the knockout
  // cannot separate from its own drop shadow. Strymon also publishes a full
  // top-down on WHITE, which is what we actually want - pin it directly.
  'Strymon Timeline': [
    'https://www.strymon.net/wp-content/uploads/2015/09/timeline_topdown_1600.jpg',
    'https://www.strymon.net/product/timeline/',
  ],
  'Strymon Flint': ['https://www.strymon.net/product/flint/'],
  // Dunlop is BigCommerce; its og:image is usually the head-on product shot.
  // If one comes back angled, pin the gallery TOPP file directly, as Cry Baby
  // above had to.
  'Way Huge Aqua-Puss': ['https://www.jimdunlop.com/way-huge-smalls-aqua-puss-analog-delay/'],
  'Way Huge Conspiracy Theory': [
    'https://www.jimdunlop.com/way-huge-smalls-conspiracy-theory-professional-overdrive/',
  ],
  // Direct file: the product PAGE fetch is refused (HTTP 425 to some clients),
  // but the image itself serves fine with a browser UA.
  'PastFX Chorus Ensemble Deluxe': ['https://www.pastfx.com/images/New_Deluxe_Chorus.jpg'],
  // BigSky has no white-background full top-down: strymon.net publishes only
  // the gradient one (the *_topdowncrop_ file is a cropped hero, so its
  // footprint would be wrong). The gradient shot cuts out cleanly since
  // BG_GRAD_MAX_SAT - its blue body is what the grey backdrop is not.
  'Strymon BigSky': [
    'https://www.strymon.net/wp-content/uploads/2016/02/bigsky_topdown_grad2_1600-1024x1024-1.jpeg',
    'https://www.strymon.net/product/bigsky/',
  ],
  'TC Electronic Polytune 3': [
    'https://web.archive.org/web/20211010004401im_/https://mediadl.musictribe.com/media/PLM/data/images/products/P0CM0/2000Wx2000H/POLYTUNE-3_P0CM0_Top_XL.png',
  ],
  'TC Electronic Ditto Looper': [
    'https://web.archive.org/web/20230208191559im_/https://mediadl.musictribe.com/media/PLM/data/images/products/P0DD4/2000Wx2000H/DITTO-LOOPER_P0DD4_Top_XL.png',
  ],
  'Pro Co RAT 2': ['https://actentertainment.com/rat-2-distortion-pedal/'],
  // The BOSS candidate pattern finds a shot whose flood fill eats the red top
  // plate. Roland's gallery carries a proper TOP view under a different path
  // (the same _gal.jpg family the Katana amp uses).
  'BOSS DM-2W': [
    'https://static.roland.com/assets/images/products/gallery/dm-2w_top_gal.jpg',
  ],
};

/**
 * Per-pedal escape hatches, keyed like PRODUCT_PAGES ("Manufacturer Name").
 *
 * The knockout is a heuristic over 64 photos and it will never be right for
 * all of them. Tuning its constants to rescue one pedal silently shifts the
 * other 63 - that is exactly how the black-blob regression happened. So a
 * problem case becomes an explicit, reviewable entry here instead.
 *
 *   sources  replace the candidate list entirely (for a WRONG image - no
 *            background remover fixes a photo shot from the side)
 *   mode     'skip'      never mirror; render the clean category rect
 *            'no-trim'   knock the background out but do not crop to it
 *
 * Prefer fixing `sources` when a better photo exists: the goal is a clean
 * top-down cut-out, so a correct source beats any amount of post-processing.
 */
const PEDAL_OVERRIDES = {
  // og:image and the -1 gallery shot are both angled three-quarter views.
  // Needs a genuine head-on source; until one is found, the rect is honest.
  'Electro-Harmonix Big Muff Pi': { mode: 'skip' },
  /*
   * BigSky and DM-2W were skipped here until 2026-08-03. BG_GRAD_MAX_SAT (see
   * knockOutBackground below) fixed both, and they are now mirrored normally:
   *
   *                       top10%   mid     opaque   trimmed size
   *   DM-2W   before       27.8    100.0    80.4    582x1049
   *           after        88.7    100.0    88.9    582x1050
   *   BigSky  before       86.5    100.0    94.2    877x703
   *           after        96.1    100.0    99.3    833x599
   *
   * DM-2W's top band went from 70% eaten to matching its own siblings - every
   * other BOSS compact in the catalogue measures 83-90 there. BigSky's trim
   * lost 104 rows, which IS the grey box: the backdrop it used to keep.
   */

  /*
   * Timeline is NOT fixed and stays skipped. The colour test cannot reach it,
   * and this is measured rather than assumed - tracing the fill's path from
   * the border to the centre of the pedal on the real photo:
   *
   *   saturation along the path: 0,0,4,5,4,5,3,3,3,3,3,3,3,3
   *   of the 1,243,441 pixels the fill absorbed, 621 (0.0%) had sat > 24
   *
   * A silver enclosure lit by a neutral studio ramp IS the same colour as its
   * own backdrop. There is no threshold to pick. It then fails the centre
   * guard, falls back to the strict pass, and the strict pass cannot span a
   * 255->137 ramp, so the shadow below luminance 220 survives - the grey oval
   * the owner saw, and it is under the pedal because that is where the drop
   * shadow is.
   *
   * EDGE MAGNITUDE WAS TRIED TOO (2026-08-03) and is also blind here. The
   * idea was sound - a backdrop is smooth, an outline is not, and the fill
   * turned out not to CROSS the pedal's edge but to walk ALONG its shoulder:
   *
   *   backdrop, right side    255 -> 227 over 120px      ~0.5 /px
   *   drop shadow, bottom     255 -> 131 over 110px      1.3-2.3 /px
   *   pedal's right edge      227 -> 109 in one step     91 /px
   *
   * Gating chaining on steepness <= 25 closed that path. The fill simply
   * entered somewhere else: at x=632 the pedal's own SILVER TOP FACE (L216)
   * meets the white backdrop (L243) with no bevel between them, and every
   * pixel along the new entry path measures steepness 2-9. Where the
   * enclosure is bright silver there is no boundary in the image data at all.
   * The gate also cost BigSky (top band 96.1 -> 89.0), so it was reverted.
   *
   * That is all three local channels measured and refused:
   *   COLOUR      0.0% of the absorbed pixels are saturated
   *   BRIGHTNESS  the pedal spans L[89,231], which CONTAINS the shadow's
   *               L[137,219]; sweeping the floor 90..190 either leaves the
   *               shadow or eats the top face (top band 16-73%)
   *   GRADIENT    the entry path is smooth, steepness 2-9
   *
   * Cropping the residue was tried as well: the bright-neutral rows are
   * contiguous from the edges (top 11, bottom 33, left 17, right 33), but
   * cropping them leaves all four corners STILL backdrop (lum 145-164) - the
   * shadow is a gradient, so the boundary just moves - and it would crop
   * lines from 36 of the 62 pedals that are already right.
   *
   * A better SOURCE is the remaining route, and there is not one: Strymon's
   * only other top-down is a 1600x714 crop on a GREY backdrop (aspect 2.24
   * against a 1.275 footprint), and the three Andertons gallery originals are
   * angled - the closest by aspect (1.033x) has a visibly diagonal silhouette.
   *
   * So this needs real matting (trimap/learned alpha), not another constant.
   * `src/lib/images/__tests__/knockout.test.ts` pins the limit with a
   * fixture, so if it ever becomes separable that test fails and says so.
   */
  'Strymon Timeline': { mode: 'skip' },
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
/**
 * How much more COLOURFUL than its own backdrop a pixel may be and still be
 * chained onto. Brightness alone cannot separate a studio backdrop from a
 * pedal - both are light, and a soft edge joins them in steps too small for
 * BG_GRAD_TOL. Colour can: backdrops and shadows are NEUTRAL.
 *
 * Traced 2026-08-03 on the two photos this was written for:
 *   DM-2W   backdrop sat 5, path climbs 20,26,41,45,49,51,61,76,78 -> plate 99
 *   BigSky  backdrop sat 0, path steps 0 -> 70 -> 115 -> 127 -> body 224
 *
 * Relative to the border average, because a backdrop is not always neutral -
 * a pedal on a wooden floor sits on saturation ~80.
 *
 * 48, not a tighter number, because the targets are fixed anywhere in 16..120
 * so the 62-pedal corpus is what picks it. Swept with knockout-regression.js:
 * 16..32 moves 7-11 pedals (DD-7 loses 11.7pp of its bottom band, both MXR
 * silhouettes change size); 40..64 moves 4-6, each a single band by <=5pp;
 * 72..80 collapses BF-3 (left 55.5 -> 21.6). Mid-plateau, and the full
 * reasoning is in src/lib/images/knockout.ts.
 *
 * Kept in step with src/lib/images/knockout.ts, which is the same algorithm
 * for user uploads. See the note at the foot of this file.
 */
const BG_GRAD_MAX_SAT = 48;
/** Share of the centre 40% box the fill may touch before it counts as having
 *  eaten the subject. See the guard below for the measured justification. */
const MAX_CENTRE_KNOCK_SHARE = 0.02;

/**
 * @param {Buffer} buf
 * @param {boolean} useGradient follow smooth backdrop gradients (needed for
 *   studio shots that fade 240->110) or match the border colour strictly.
 *   Gradient-following is what lets a fill walk out of a soft backdrop and
 *   into a pedal's own light areas, so the caller retries without it.
 */
async function knockOutBackground(buf, useGradient = true) {
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
  if (transparent > border.length * 0.3) return { buf, ok: true, status: 'already-cutout' };

  // Average opaque border color = background reference
  let r = 0, g = 0, b = 0, n = 0;
  for (const i of border) {
    if (px[i * C + 3] < 20) continue;
    r += px[i * C]; g += px[i * C + 1]; b += px[i * C + 2]; n++;
  }
  if (!n) return { buf, ok: false, status: 'no-background' };
  r /= n; g /= n; b /= n;

  const isBg = (i) =>
    px[i * C + 3] >= 20 &&
    Math.abs(px[i * C] - r) <= BG_TOL &&
    Math.abs(px[i * C + 1] - g) <= BG_TOL &&
    Math.abs(px[i * C + 2] - b) <= BG_TOL;

  const lum = (i) => 0.299 * px[i * C] + 0.587 * px[i * C + 1] + 0.114 * px[i * C + 2];

  // Colourfulness: 0 is a perfectly neutral grey
  const sat = (i) =>
    Math.max(px[i * C], px[i * C + 1], px[i * C + 2]) -
    Math.min(px[i * C], px[i * C + 1], px[i * C + 2]);

  // The most colour a chained pixel may carry, set by THIS image's backdrop
  const maxSat = Math.max(r, g, b) - Math.min(r, g, b) + BG_GRAD_MAX_SAT;

  // Can the fill spread onto j at all - light enough and neutral enough
  const chainable = (j) => px[j * C + 3] >= 20 && lum(j) >= BG_GRAD_MIN_LUM && sat(j) <= maxSat;

  // j continues a smooth, light, neutral gradient from already-background i
  const chains = (i, j) =>
    chainable(j) &&
    Math.abs(px[j * C] - px[i * C]) <= BG_GRAD_TOL &&
    Math.abs(px[j * C + 1] - px[i * C + 1]) <= BG_GRAD_TOL &&
    Math.abs(px[j * C + 2] - px[i * C + 2]) <= BG_GRAD_TOL;

  const visited = new Uint8Array(W * H);
  const queue = [];
  for (const i of border) {
    if (!visited[i] && (isBg(i) || (useGradient && chainable(i)))) {
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
      if (!visited[j] && (isBg(j) || (useGradient && chains(i, j)))) { visited[j] = 1; queue.push(j); }
    }
  }
  // A knockout that ate (almost) the whole frame leaked into the subject
  if (knocked > W * H * 0.9) return { buf, ok: false, status: 'reverted' };

  // A knockout that reached the MIDDLE of the frame also leaked into the
  // subject - a product photo has the product in the centre, so the fill has
  // no business there. The box is the centre 20%, not 40%: a wider box picks
  // up legitimate background whenever the subject does not fill the frame,
  // and the tighter box also separates the real cases more sharply (damaged
  // 77-91%, healthy 0%). Without this, a JPEG whose pedal has light areas
  // (silver bands, pale knobs) lets the gradient-follower walk in from the
  // backdrop and hollow out the face, leaving only the dark parts: the pedal
  // renders as a black blob. Measured over all 64 mirrored images, the split
  // is unambiguous - healthy fills reach at most 0.49% of the centre box,
  // damaged ones 4.48% and up (AW-3 and DD-7 hit 59%).
  const cx0 = Math.floor(W * 0.4), cx1 = Math.ceil(W * 0.6);
  const cy0 = Math.floor(H * 0.4), cy1 = Math.ceil(H * 0.6);
  let centreKnocked = 0;
  for (const i of knockedIdx) {
    const x = i % W, y = (i / W) | 0;
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) centreKnocked++;
  }
  if (centreKnocked > (cx1 - cx0) * (cy1 - cy0) * MAX_CENTRE_KNOCK_SHARE) {
    return { buf, ok: false, status: 'subject-eaten' };
  }

  for (const i of knockedIdx) px[i * C + 3] = 0;

  return {
    buf: await sharp(px, { raw: { width: W, height: H, channels: C } }).png().toBuffer(),
    ok: true,
    status: 'knocked-out',
  };
}

async function trimBackground(buf) {
  try {
    const meta = await sharp(buf).metadata();
    let cut = await knockOutBackground(buf);
    // A failed knockout must REJECT the candidate, never fall through. Trimming
    // an image that still has its background crops to the background's own
    // bounding box, so the pedal would render inside a white rectangle - the
    // exact bug silhouettes were introduced to fix. Rejecting lets the next
    // candidate try, and the clean category rect is a better last resort than
    // either a white box or a hollowed-out black blob.
    // Gradient-following is what walks a fill out of the backdrop and into the
    // pedal's own light areas. When that happens, retry with a strict
    // border-colour match: measured across the 14 damaged images it drops
    // centre penetration from ~50-59% to 0% on most of them, recovering the
    // photo instead of falling back to a rect.
    if (!cut.ok && cut.status === 'subject-eaten') {
      cut = await knockOutBackground(buf, false);
    }
    if (!cut.ok) return { buf, type: null, trimmed: false, rejected: cut.status };
    const trimmed = await sharp(cut.buf).trim({ threshold: 25 }).png().toBuffer({ resolveWithObject: true });
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

/**
 * Describe the terms a mirrored image arrives under, from the host it came
 * from. Deliberately blunt: these are manufacturer product photographs and we
 * hold no licence to them - we mirror them to identify the product on a board
 * plan. Saying `manufacturer-proprietary` in the row is the honest record of
 * that, and it is what makes the takedown path in README.md actionable.
 *
 * `attribution` is only set where the licence *requires* a displayed credit;
 * proprietary product photos require a takedown path, not a credit line.
 */
const MANUFACTURER_HOSTS = [
  'roland.com', 'boss.info', 'ibanez.com', 'jimdunlop.com', 'bigcommerce.com',
  'ehx.com', 'actentertainment.com', 'musictribe.com', 'tcelectronic.com',
  'strymon.net', 'pastfx.com',
  // Amps and boards (2026-08-01)
  'fender.com', 'evhgear.com', 'fmicassets.com', 'marshall.com', 'voxamps.com',
  'mesaboogie.com', 'gibson.com', 'pedaltrain.com',
];

/**
 * Hosts that serve OTHER people's assets. A URL on one of these says nothing
 * about the terms, because the same host serves every tenant of the platform -
 * so the licence has to come from the page the image was found on instead.
 *
 * This matters for the amps and boards: Marshall's photos live on Contentful,
 * Fender's and Mesa's on Shopify's CDN. Judging by URL host alone would record
 * them as `unknown`, which understates what we know (they are manufacturer
 * product photography, found on the manufacturer's own product page) and
 * blunts the takedown path that the provenance columns exist to support.
 */
const ASSET_CDN_HOSTS = ['ctfassets.net', 'shopify.com', 'shopifycdn.com', 'cloudinary.com'];

/**
 * @param {string} sourceUrl where the bytes came from
 * @param {string} [viaPageUrl] the product page the URL was found on, used
 *   only when sourceUrl sits on a shared asset CDN that carries no terms of
 *   its own. Never overrides a host we can already judge.
 */
function provenanceFor(sourceUrl, viaPageUrl) {
  let host;
  try {
    host = new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return { license: null, attribution: null };
  }
  if (viaPageUrl && ASSET_CDN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return provenanceFor(viaPageUrl);
  }
  // Archived copies carry the licence of whatever was archived, not the archive's
  if (host.endsWith('web.archive.org')) {
    const inner = sourceUrl.match(/https?:\/\/[^/]+\/web\/\d+\w*\/(https?:\/\/.+)$/)?.[1];
    if (inner) {
      const { license } = provenanceFor(inner);
      return { license, attribution: null };
    }
  }
  if (host.endsWith('wikimedia.org')) {
    // Per-file terms vary; record that a human must resolve them before use
    return { license: 'wikimedia-see-file-page', attribution: null };
  }
  if (MANUFACTURER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { license: 'manufacturer-proprietary', attribution: null };
  }
  return { license: 'unknown', attribution: null };
}

async function main() {
  const { data: pedals, error } = await sb.from('pedals')
    .select('id,name,manufacturer,image_url,image_source_url,width_inches,depth_inches');
  if (error) throw error;

  const report = { mirrored: [], topDown: 0, skipped: [], missed: [], cleared: [], referenced: [], overridden: [] };

  for (const pedal of pedals) {
    // ONLY=ds-1,rat re-runs just matching pedals (name substring, comma-separated)
    if (
      process.env.ONLY &&
      !process.env.ONLY.toLowerCase().split(',').some((s) => pedal.name.toLowerCase().includes(s.trim()))
    ) {
      continue;
    }
    // Provenance but no image = deliberately REFERENCED, not mirrored (the
    // Klon Centaur's CC BY-SA source: mirroring it would make our knocked-out
    // copy a share-alike derivative). Never mirror these, not even under
    // FORCE=1 - the whole point is that the bytes stay where their rights live.
    if (!pedal.image_url && pedal.image_source_url) {
      report.referenced.push(`${pedal.name} -> ${pedal.image_source_url}`);
      continue;
    }
    // A row that already points at us is done - UNLESS its provenance is
    // missing, which is how the rows mirrored before provenance existed get
    // backfilled without needing FORCE=1 (and a full re-download of all 64).
    if (!process.env.FORCE && pedal.image_url?.includes(OUR_HOST) && pedal.image_source_url) {
      report.skipped.push(pedal.name);
      continue;
    }
    const override = PEDAL_OVERRIDES[`${pedal.manufacturer} ${pedal.name}`] ?? {};
    if (override.mode === 'skip') {
      report.overridden.push(`${pedal.manufacturer} ${pedal.name} (skip: no clean top-down source)`);
      if (!process.env.DRY && pedal.image_url?.includes(OUR_HOST)) {
        await sb.storage.from('pedal-images')
          .remove([`system/${pedal.id}.png`, `system/${pedal.id}.jpg`]);
        await sb.from('pedals').update({
          image_url: null, image_source_url: null, image_license: null,
          image_attribution: null, image_fetched_at: null,
        }).eq('id', pedal.id);
      }
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
      const sources = override.sources ?? PRODUCT_PAGES[`${pedal.manufacturer} ${pedal.name}`] ?? [];
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
        // Clear provenance with the image - a source recorded for bytes we no
        // longer serve is a lie the takedown path would trip over
        await sb.from('pedals').update({
          image_url: null,
          image_source_url: null,
          image_license: null,
          image_attribution: null,
          image_fetched_at: null,
        }).eq('id', pedal.id);
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
      // image_url and its provenance are written in ONE statement, so a row can
      // never exist with bytes we serve and no recorded origin
      const { license, attribution } = provenanceFor(hit.url);
      const { error: dbErr } = await sb.from('pedals').update({
        image_url: versionedUrl,
        image_source_url: hit.url,
        image_license: license,
        image_attribution: attribution,
        image_fetched_at: new Date().toISOString(),
      }).eq('id', pedal.id);
      if (dbErr) { report.missed.push(`${pedal.name} (db: ${dbErr.message})`); continue; }
    }
    const isTop = /_top[._]/.test(hit.url);
    if (isTop) report.topDown++;
    report.mirrored.push(
      `${pedal.name} <- ${hit.url} [${provenanceFor(hit.url).license}] (${isTop ? 'TOP' : 'face'}, ${hit.dims.join('x')}, aspect ratio ${hit.ratio.toFixed(2)}x of footprint)`
    );
  }

  console.log(`mirrored: ${report.mirrored.length} (${report.topDown} top-down) | skipped (already ours): ${report.skipped.length} | overridden: ${report.overridden.length} | referenced (not mirrored): ${report.referenced.length} | missed: ${report.missed.length} | cleared stale: ${report.cleared.length}`);
  console.log('--- mirrored ---');
  report.mirrored.forEach(l => console.log(' ', l));
  console.log('--- overridden per-pedal (see PEDAL_OVERRIDES) ---');
  report.overridden.forEach(l => console.log(' ', l));
  console.log('--- referenced, bytes deliberately not mirrored ---');
  report.referenced.forEach(l => console.log(' ', l));
  console.log('--- missed (rect fallback) ---');
  report.missed.forEach(l => console.log(' ', l));
}

/*
 * The image PIPELINE below - fetch, knock out, trim, judge, attribute - is not
 * pedal-specific, and mirror-gear-images.js reuses it for amps and boards
 * rather than growing a second copy that drifts. The knockout in particular
 * has a regression history (see the 2026-07-30 centre guard) that nobody
 * should have to rediscover in a duplicate.
 *
 * What stays here is what IS pedal-specific: the BOSS/Roland URL families,
 * PRODUCT_PAGES, PEDAL_OVERRIDES and main().
 */
module.exports = {
  BROWSER_UA,
  IMAGE_URL_RE,
  ogImageOf,
  fetchImage,
  knockOutBackground,
  trimBackground,
  acceptCandidate,
  provenanceFor,
  MANUFACTURER_HOSTS,
  ASSET_CDN_HOSTS,
};

// Only run the pedal pass when invoked directly, so importing the pipeline
// above does not mirror the whole catalogue as a side effect.
if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
