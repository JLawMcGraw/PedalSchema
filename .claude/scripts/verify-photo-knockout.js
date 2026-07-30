/**
 * End-to-end verification of the /pedals/new photo pipeline in a real browser.
 *
 * Unit tests cover the knockout math on raw RGBA buffers; they cannot reach the
 * canvas decode -> getImageData -> putImageData -> toBlob('image/png') round-trip
 * that the browser actually performs. This script bundles the real
 * prepare-pedal-photo module, runs it in Chromium against a synthetic JPEG (lossy,
 * like a real upload), then analyses the PNG bytes it produced using sharp in Node.
 *
 * Usage: node .claude/scripts/verify-photo-knockout.js
 * Exits non-zero if any check fails.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- Fixtures: a dark pedal body on a white studio backdrop, saved as JPEG ---
const W = 800;
const H = 600;
const BODY = { x0: 250, x1: 550, y0: 150, y1: 450 };
const KNOB = { cx: 400, cy: 300, r: 40 };
/** Corner radius for the rounded fixture - the corners are what must go
 *  transparent, since a surviving background is exactly the "white box" bug. */
const CORNER_R = 60;

/**
 * @param {number} corner 0 for a square body, >0 to round the corners.
 */
async function makeFixture(corner) {
  const raw = Buffer.alloc(W * H * 3);
  const inRounded = (x, y) => {
    if (x < BODY.x0 || x >= BODY.x1 || y < BODY.y0 || y >= BODY.y1) return false;
    if (!corner) return true;
    const dx = Math.max(BODY.x0 + corner - x, 0, x - (BODY.x1 - 1 - corner));
    const dy = Math.max(BODY.y0 + corner - y, 0, y - (BODY.y1 - 1 - corner));
    return Math.hypot(dx, dy) <= corner;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const inBody = inRounded(x, y);
      // A white knob inside the body must survive: it is interior, so the
      // edge-connected fill cannot reach it even though it matches the backdrop.
      const inKnob = Math.hypot(x - KNOB.cx, y - KNOB.cy) < KNOB.r;
      const v = inBody ? (inKnob ? 245 : 32) : 252;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = inBody && !inKnob ? 38 : v;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function bundleModule() {
  const result = await build({
    root: ROOT,
    logLevel: 'error',
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
    build: {
      write: false,
      lib: {
        entry: path.join(ROOT, 'src/lib/images/prepare-pedal-photo.ts'),
        formats: ['iife'],
        name: 'PedalPhoto',
        fileName: () => 'bundle.js',
      },
    },
  });
  const chunk = (Array.isArray(result) ? result[0] : result).output.find((o) => o.type === 'chunk');
  return chunk.code;
}

const bundle = await bundleModule();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ content: bundle });

/** Run the real module in the browser against one fixture. */
async function runInBrowser(jpeg) {
  return page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'my-pedal.jpg', { type: 'image/jpeg' });
  const t0 = performance.now();
  const prepared = await PedalPhoto.preparePedalPhoto(file);
  const ms = performance.now() - t0;
  const buf = new Uint8Array(await prepared.file.arrayBuffer());
  let bin = '';
  for (const byte of buf) bin += String.fromCharCode(byte);
  return {
    status: prepared.status,
    width: prepared.width,
    height: prepared.height,
    name: prepared.file.name,
    type: prepared.file.type,
    bytes: prepared.file.size,
    previewScheme: prepared.previewUrl.slice(0, 5),
    ms: Math.round(ms),
    png: btoa(bin),
  };
  }, jpeg.toString('base64'));
}

const BODY_W = BODY.x1 - BODY.x0;
const BODY_H = BODY.y1 - BODY.y0;
const expectedAspect = BODY_W / BODY_H;
let failed = 0;

/**
 * @param {string} label
 * @param {number} corner corner radius of the fixture body (0 = square)
 */
async function verifyFixture(label, corner) {
  const jpeg = await makeFixture(corner);
  console.log(`\n${'='.repeat(72)}\nFIXTURE: ${label}`);
  console.log(
    `${W}x${H} JPEG, ${jpeg.length} bytes. Body ${BODY_W}x${BODY_H} at (${BODY.x0},${BODY.y0}), ` +
      `corner radius ${corner}, white knob r=${KNOB.r} at centre.`
  );

  const out = await runInBrowser(jpeg);
  console.log('\n--- Returned by preparePedalPhoto (in-browser) ---');
  console.log(JSON.stringify({ ...out, png: `<${out.png.length} base64 chars>` }, null, 2));

  // --- Analyse the actual PNG bytes the browser produced ---
  const png = Buffer.from(out.png, 'base64');
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const A = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const RGB = (x, y) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);

  let opaque = 0;
  for (let i = 0; i < info.width * info.height; i++) if (data[i * info.channels + 3] > 200) opaque++;
  const opaqueShare = opaque / (info.width * info.height);

  const cx = Math.floor(info.width / 2);
  const cy = Math.floor(info.height / 2);
  const actualAspect = info.width / info.height;
  // Fraction of the trimmed frame a rounded rect covers: 1 - (4-pi)r^2/(w*h)
  const roundedShare = 1 - ((4 - Math.PI) * corner * corner) / (BODY_W * BODY_H);

  console.log('\n--- PNG analysis (sharp, in Node) ---');
  console.log(`format=${meta.format} ${info.width}x${info.height} channels=${info.channels} hasAlpha=${meta.hasAlpha}`);
  console.log(`opaque pixels: ${opaque}/${info.width * info.height} (${(100 * opaqueShare).toFixed(1)}%)`);
  console.log(`corner (2,2) alpha=${A(2, 2)}   centre knob RGB=${RGB(cx, cy)} alpha=${A(cx, cy)}`);
  console.log(`aspect: expected ${expectedAspect.toFixed(3)}, actual ${actualAspect.toFixed(3)}`);

  const checks = [
    ['output is PNG carrying an alpha channel', meta.format === 'png' && meta.hasAlpha === true],
    ['status is knocked-out', out.status === 'knocked-out'],
    ['file renamed to .png with image/png type', out.name === 'my-pedal.png' && out.type === 'image/png'],
    ['downscaled to <=1600 longest edge', Math.max(info.width, info.height) <= 1600],
    [
      `trimmed to exactly the body (${BODY_W}x${BODY_H})`,
      info.width === BODY_W && info.height === BODY_H,
    ],
    ['aspect matches the body within 2%', Math.abs(actualAspect - expectedAspect) / expectedAspect < 0.02],
    ['interior white knob survived the fill', A(cx, cy) > 200 && RGB(cx, cy)[0] > 200],
    ['preview is a blob: URL', out.previewScheme === 'blob:'],
  ];

  if (corner === 0) {
    // A square body fills its own bounding box: every pixel is subject.
    checks.push(['square body is fully opaque after trim', opaqueShare > 0.99]);
  } else {
    // THE BUG UNDER TEST: the background outside the rounded corners must be
    // transparent, or the pedal renders on the board inside a white box.
    checks.push(['rounded corners are transparent (no white box)', A(2, 2) === 0]);
    checks.push([
      `opaque share matches a rounded rect (~${(100 * roundedShare).toFixed(1)}%)`,
      Math.abs(opaqueShare - roundedShare) < 0.02,
    ]);
  }

  console.log('\n--- Checks ---');
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name}`);
  }
  console.log(`processing time in browser: ${out.ms}ms`);
}

await verifyFixture('square pedal body on white backdrop', 0);
await verifyFixture('rounded-corner pedal body on white backdrop', CORNER_R);

await browser.close();
console.log(`\n${'='.repeat(72)}`);
console.log(failed ? `RESULT: ${failed} CHECK(S) FAILED` : 'RESULT: ALL CHECKS PASS');
process.exit(failed ? 1 : 0);
