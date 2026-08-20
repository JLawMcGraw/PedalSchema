#!/usr/bin/env node
/**
 * Judge the newly-mirrored photos WHERE THEY ARE USED - on the board.
 *
 * This exists because opening the PNG is not verification. On 2026-08-02 the
 * mirrored Timeline and DM-2W were both called clean after being viewed as
 * files, and both were wrong: a viewer composites transparency against a light
 * background, which hides exactly a retained grey backdrop and a softly-eroded
 * edge. The owner looking at the actual board caught both.
 *
 * So this places the pedals, renders, and reads PIXELS BACK OFF THE CANVAS,
 * testing the two things that were wrong:
 *
 *   1. NO SURVIVING BACKDROP. A cut-out pedal shows the BOARD through its
 *      corners; a retained backdrop shows grey there. Measured by comparing
 *      the pedal box's corners against bare board sampled away from any pedal.
 *   2. NO ERODED EDGE. The DM-2W's red plate spans the top of its face, so
 *      the top of the drawn image must be as opaque and as COLOURED as its
 *      middle. A fill that ate the plate shows board colour there instead.
 *
 * Usage: node .claude/scripts/verify-knockout-on-board.js
 *   (needs the dev server on BASE_URL and VERIFY_EMAIL/PASSWORD in .env.local)
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login, openEditor } = require('./lib/twin');
loadEnv();

/** The pedals this run is about, by the name shown in the library. */
const TARGETS = ['DM-2W', 'BigSky', 'Timeline', 'DD-7', 'GEB-7', 'IR-2'];

/**
 * Pedals whose own enclosure is bright and neutral, so the corner test cannot
 * tell subject from studio backdrop. Only the bottom corners are judged for
 * these - see the note at the check itself.
 */
const NEUTRAL_ENCLOSURE = ['Timeline'];

const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
  try {
    await login(page);

    await openEditor(page);

    // Add the two targets from the library, unless the board already has them.
    const already = (await page.evaluate(() => window.__getPedalSchemaSnapshot())).pedals.map((p) => p.name);
    for (const name of TARGETS) {
      if (already.some((n) => n.includes(name))) continue;
      // Search first: the library is long, and a pedal that is merely scrolled
      // out of view silently fails to be added - which showed up as "expected
      // 6 target images, found 5" rather than as anything obviously wrong.
      const search = page.locator('input[placeholder="Search pedals..."]').first();
      await search.fill(name);
      await page.waitForTimeout(400);
      const row = page.locator(`button:has-text("${name}"), [role="button"]:has-text("${name}")`).first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(500);
      await search.fill('');
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);

    // Let every <image> in the canvas finish decoding before reading pixels.
    await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('[data-pedal-canvas] image')];
      await Promise.all(
        imgs.map(
          (im) =>
            new Promise((res) => {
              const href = im.getAttribute('href') || im.getAttribute('xlink:href');
              if (!href) return res();
              const probe = new Image();
              probe.crossOrigin = 'anonymous';
              probe.onload = probe.onerror = () => res();
              probe.src = href;
            })
        )
      );
    });
    await page.waitForTimeout(800);

    const snap = await page.evaluate(() => window.__getPedalSchemaSnapshot());
    console.log(`\nBoard has ${snap.pedals.length} pedals: ${snap.pedals.map((p) => p.name).join(', ')}`);

    // Geometry + href, straight from the DOM. Each <image> is matched to the
    // pedal whose box it centres on - the same identification the canvas
    // itself makes, rather than trusting document order.
    const dom = await page.evaluate((targets) => {
      const SCALE = 40;
      const svg = document.querySelector('[data-pedal-canvas]');
      const snap = window.__getPedalSchemaSnapshot();
      const out = [];
      for (const im of svg.querySelectorAll('image')) {
        const href = im.getAttribute('href') || im.getAttribute('xlink:href') || '';
        const r = im.getBoundingClientRect();
        const ax = +im.getAttribute('x');
        const ay = +im.getAttribute('y');
        const aw = +im.getAttribute('width');
        const ah = +im.getAttribute('height');
        const cx = ax + aw / 2;
        const cy = ay + ah / 2;
        const owner = snap.pedals.find((p) => {
          const rot = p.rotationDegrees === 90 || p.rotationDegrees === 270;
          const bw = (rot ? p.depthInches : p.widthInches) * SCALE;
          const bh = (rot ? p.widthInches : p.depthInches) * SCALE;
          return (
            Math.abs(p.xInches * SCALE + bw / 2 - cx) < 0.5 &&
            Math.abs(p.yInches * SCALE + bh / 2 - cy) < 0.5
          );
        });
        if (!owner || !targets.some((t) => owner.name.includes(t))) continue;
        out.push({ name: owner.name, href, screen: { x: r.x, y: r.y, w: r.width, h: r.height }, attr: { w: aw, h: ah } });
      }
      const rect = svg.getBoundingClientRect();
      return { images: out, canvas: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
    }, TARGETS);

    const missing = TARGETS.filter((t) => !dom.images.some((im) => im.name.includes(t)));
    if (missing.length) {
      console.log(
        `\nFAIL: ${missing.join(', ')} did not reach the canvas, so ${missing.length === 1 ? 'it is' : 'they are'} ` +
          `UNVERIFIED here. Usually the board is full and the placement was refused. ` +
          `Their alpha is still checked by knockout-regression.js against the fingerprint.`
      );
      failed++;
    }

    const shot = path.join(__dirname, '../screenshots/knockout-on-board.png');
    await page.screenshot({ path: shot });
    console.log(`screenshot (supporting evidence only): ${shot}`);

    // Read the rendered pixels back
    const sharp = require(path.join(__dirname, '../../node_modules/sharp'));
    const buf = await page.screenshot();
    const { data: px, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
      return [px[i], px[i + 1], px[i + 2]];
    };
    /** Median colour of a small patch, so one antialiased pixel cannot decide. */
    const patch = (x, y, r = 3) => {
      const vals = [[], [], []];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const c = at(x + dx, y + dy);
          for (let k = 0; k < 3; k++) vals[k].push(c[k]);
        }
      }
      return vals.map((v) => v.sort((a, b) => a - b)[(v.length / 2) | 0]);
    };

    // Bare board: the canvas corner region, away from any pedal image
    const boardRef = patch(dom.canvas.x + 12, dom.canvas.y + dom.canvas.h - 12, 4);
    console.log(`\nbare board reference rgb=${boardRef}`);

    for (let k = 0; k < dom.images.length; k++) {
      const im = dom.images[k];
      const nameGuess = im.name;
      const { x, y, w, h } = im.screen;
      console.log(`\n=== ${nameGuess} ===`);
      console.log(`  href ${im.href.slice(0, 96)}`);
      console.log(`  drawn at ${w.toFixed(0)}x${h.toFixed(0)} px on screen, viewBox box ${im.attr.w}x${im.attr.h}`);

      check('image is served from our storage bucket', im.href.includes('/pedal-images/'), im.href.split('/pedal-images/')[0].slice(0, 40));
      check('image occupies a real box on screen', w > 20 && h > 20, `${w.toFixed(0)}x${h.toFixed(0)}`);

      // 1. Corners must show BOARD, not a retained backdrop.
      const inset = Math.max(2, Math.round(Math.min(w, h) * 0.04));
      const corners = [
        ['top-left', x + inset, y + inset],
        ['top-right', x + w - inset, y + inset],
        ['bottom-left', x + inset, y + h - inset],
        ['bottom-right', x + w - inset, y + h - inset],
      ].map(([label, cx, cy]) => ({ label, rgb: patch(cx, cy, 2) }));
      // What a surviving backdrop looks like, and what it does NOT look like.
      //
      // "The corners should be transparent" is the obvious test and it is
      // wrong: a rectangular top-down photo legitimately fills its own
      // bounding box, so BigSky's corners are its own blue enclosure. Two of
      // the 62 healthy pedals (XS-100, Conspiracy Theory) have an opaque
      // corner for the same reason.
      //
      // What actually distinguishes the bug is that a studio backdrop is
      // BRIGHT and NEUTRAL. Measured on the Timeline residue that started
      // this - the greys retained under the pedal ran 218,218,218 ->
      // 199,199,199 -> 177,177,177: luminance 177-218 at saturation 0. No
      // pedal colour and no part of this dark board looks like that.
      // ...and "bright and neutral" is not enough on its own, because some
      // pedals ARE bright and neutral: the DD-7 is cream (mid 236,219,199)
      // and the GEB-7 grey (mid 178,179,181), so their corners tripped this
      // while being perfectly good pedal. A corner that matches the pedal's
      // OWN mid-body colour is subject, whatever its luminance.
      //
      // The test still fires where it must - the pre-fix Timeline had bottom
      // corners at lum 195/197 against a mid of ~95, and pre-fix BigSky the
      // same - so this narrows the check without disarming it.
      const midBody = patch(x + w / 2, y + h / 2, Math.max(2, Math.round(h * 0.03)));
      for (const c of corners) {
        c.delta = dist(c.rgb, boardRef);
        c.lum = Math.round(0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2]);
        c.sat = sat(...c.rgb);
        c.fromBody = dist(c.rgb, midBody);
        c.backdrop = c.lum > 120 && c.sat < 30 && c.fromBody > 24;
      }
      console.log(
        '  corners: ' +
          corners.map((c) => `${c.label} rgb=${c.rgb} lum=${c.lum} sat=${c.sat} d(body)=${c.fromBody}${c.backdrop ? ' BACKDROP' : ''}`).join('  ')
      );
      // A pedal whose ENCLOSURE is itself bright and neutral defeats this
      // test, because "bright and neutral" then describes the subject as well
      // as the backdrop. That is a property of the pedal, declared here the
      // way scraper/mirror-pedal-images.js declares its per-pedal exceptions.
      //
      // For those, assert the narrower thing that still catches the defect
      // actually reported: a drop shadow falls UNDER a pedal, so the bottom
      // corners are where a retained one shows. On the Timeline those went
      // lum 195/197 (backdrop) -> 63/68 (enclosure) across the fix, while its
      // top corners read ~160 both before and after because the top of that
      // enclosure is genuinely light grey.
      const neutralEnclosure = NEUTRAL_ENCLOSURE.some((n) => nameGuess.includes(n));
      const judged = neutralEnclosure ? corners.filter((c) => c.label.startsWith('bottom')) : corners;
      const residue = judged.filter((c) => c.backdrop);
      check(
        neutralEnclosure
          ? 'no BOTTOM corner shows a retained drop shadow (grey enclosure: top corners not diagnostic)'
          : 'no corner shows a bright neutral studio backdrop (no grey box)',
        residue.length === 0,
        residue.length
          ? residue.map((c) => `${c.label} lum=${c.lum} sat=${c.sat}`).join(', ')
          : `all ${judged.length} clean`
      );

      // 2. The top of the face must be as present as the middle.
      //
      // Read from the served PNG's ALPHA, not from the composited screenshot.
      // Colour cannot answer this: the board is rgb(23,23,23) and the IR-2's
      // upper body measures L25-26, so an intact dark pedal reads as
      // "board showing through" - this check failed IR-2 with a difference of
      // 3 while its stored top rows were 85-89% opaque. Erosion is exactly
      // what alpha records, so ask alpha.
      const png = Buffer.from(await (await fetch(im.href)).arrayBuffer());
      const { data: ap, info: ai } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const band = (y0, y1) => {
        let o = 0;
        let t = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = 0; xx < ai.width; xx++) {
            t++;
            if (ap[(yy * ai.width + xx) * ai.channels + 3] > 200) o++;
          }
        }
        return t ? o / t : 0;
      };
      const topBand = band(0, Math.round(ai.height * 0.1));
      const midBand = band(Math.round(ai.height * 0.45), Math.round(ai.height * 0.55));
      console.log(
        `  served PNG ${ai.width}x${ai.height}  top-band opaque ${(100 * topBand).toFixed(1)}%  mid-band ${(100 * midBand).toFixed(1)}%`
      );
      // A healthy BOSS compact measures top 83-90 against a middle of 100.
      // The DM-2W's eaten plate measured 27.8 against 100, so half the middle
      // separates the two cases with room to spare.
      check(
        'top of the face is intact, not eaten back (alpha of the served PNG)',
        topBand > midBand * 0.5,
        `top ${(100 * topBand).toFixed(1)}% vs mid ${(100 * midBand).toFixed(1)}%`
      );

      // A "no row of the pedal is see-through" check belongs here in spirit -
      // that is how the DD-7 was reported, the fill having eaten a slice clean
      // across it - but it CANNOT be done from a screenshot. The board is
      // rgb(23,23,23) and a dark pedal pixel is indistinguishable from it once
      // composited: written that way, the check claimed 26 see-through rows on
      // the DM-2W, whose stored alpha has none.
      //
      // Transparency is exactly measurable in the stored PNG, so it is
      // measured there instead: `stray` in .claude/docs/knockout-fingerprint.json
      // is the share of the subject outside its main blob, and any slice
      // across a pedal necessarily splits it in two. DD-7 went 30.6% -> 0%.
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(failed ? `RESULT: ${failed} CHECK(S) FAILED` : 'RESULT: ALL CHECKS PASS');
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
