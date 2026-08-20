#!/usr/bin/env node
/**
 * The surfaces behave like an instrument face: hairlines, tinted shadows, and
 * grain instead of flat vector.
 *
 * All three are measured from COMPUTED style in the running app, because all
 * three are inherited from utilities defined somewhere else. Grepping the
 * source for `shadow-lg` tells you a class is used; it does not tell you what
 * colour the browser painted.
 *
 * The shadow check is the one with teeth. A pure-black shadow on a near-black
 * substrate is not subtle, it is INVISIBLE - it costs a paint and buys nothing
 * - and the skill's rule is that shadows carry the background's hue rather
 * than being generic black at low opacity. Eight elements were doing exactly
 * that before this ran.
 *
 * Two things this gate learned the hard way:
 *
 *   - COLOURS ARE RESOLVED THROUGH A CANVAS, not by regex. The first version
 *     matched `rgba(...)` only. Chrome serialises an `oklch()` shadow as
 *     `lab(...)`, so the newly tinted shadows parsed as nothing at all and the
 *     gate reported "0 visible shadow layers" while looking straight at them.
 *   - A POPOVER IS OPENED FIRST. The heavy shadows live on floating surfaces,
 *     which are not in the DOM until they open; with nothing open, "no black
 *     shadows" is satisfied by there being no shadows.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-surfaces.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, waitForCanvas } = require('./lib/twin');

loadEnv();

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);
    await openEditor(page);
    await waitForCanvas(page);

    // Open a floating surface, so there is a real shadow to measure.
    //
    // Via the ROUTING tab. This used to grab the first combobox on screen,
    // which was the library panel's category dropdown - and that control was
    // removed on 2026-08-20 as a duplicate of the grouped list beneath it, so
    // the gate had nothing to open and failed on a panel that was fine. The
    // amp select is the stable one: it is the only non-boolean control in the
    // routing panel and is not going anywhere.
    const routing = page.locator('[data-panel-tab="routing"]').first();
    await routing.waitFor({ timeout: 10000 });
    await routing.click();
    const select = page.locator('button[role="combobox"]').first();
    await select.waitFor({ timeout: 10000 });
    await select.click();
    await page.locator('[role="listbox"]').first().waitFor({ timeout: 10000 });

    const surfaces = await page.evaluate(() => {
      /** Split on commas that are not inside parentheses. */
      const splitLayers = (s) => {
        const out = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '(') depth++;
          else if (s[i] === ')') depth--;
          else if (s[i] === ',' && depth === 0) {
            out.push(s.slice(start, i).trim());
            start = i + 1;
          }
        }
        out.push(s.slice(start).trim());
        return out;
      };

      const COLOR = /(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/;

      // Resolve ANY css colour syntax to real bytes by painting it.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const resolve = (color) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = color;
        ctx.globalCompositeOperation = 'copy';
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: +(a / 255).toFixed(3) };
      };

      const shadows = {};
      const borders = {};
      const layers = [];
      let overlays = 0;

      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('svg')) continue;
        const cs = getComputedStyle(el);

        if (cs.boxShadow && cs.boxShadow !== 'none') {
          shadows[cs.boxShadow] = (shadows[cs.boxShadow] || 0) + 1;
        }
        // VISIBLE borders only. This counted width alone, and shadcn's Switch
        // carries `border-2 border-transparent` purely to size its track - so
        // the check reported a 2px border on a control that paints none, and
        // failed on markup that was correct.
        const bw = cs.borderTopWidth;
        if (bw && bw !== '0px' && resolve(cs.borderTopColor).a > 0) {
          borders[bw] = (borders[bw] || 0) + 1;
        }
        if (
          cs.position === 'fixed' &&
          cs.pointerEvents === 'none' &&
          /url\(|gradient/.test(cs.backgroundImage)
        ) {
          overlays++;
        }
      }

      for (const [shadow, count] of Object.entries(shadows)) {
        for (const layer of splitLayers(shadow)) {
          const m = layer.match(COLOR);
          if (!m) continue;
          const c = resolve(m[0]);
          if (c.a === 0) continue; // Tailwind's transparent ring placeholders
          layers.push({ ...c, count, raw: m[0] });
        }
      }

      return { shadows, borders, layers, overlays };
    });

    // --- shadows carry the hue --------------------------------------------
    console.log('\n=== shadows are tinted, not generic black ===');
    check(
      surfaces.layers.length > 0,
      `a floating surface casts a shadow: ${surfaces.layers.length} visible layer(s) ` +
        `across ${Object.keys(surfaces.shadows).length} distinct shadows`
    );

    const pureBlack = surfaces.layers.filter((p) => p.r === 0 && p.g === 0 && p.b === 0);
    check(
      pureBlack.length === 0,
      'no shadow layer is pure black',
      pureBlack.slice(0, 4).map((p) => `${p.raw} on ${p.count} element(s)`).join(' | ')
    );

    // Tinted means the channels differ - a neutral grey is the same complaint
    // as black, one step along.
    const untinted = surfaces.layers.filter((p) => p.r === p.g && p.g === p.b);
    check(
      untinted.length === 0,
      'every shadow layer carries the substrate hue rather than a neutral grey',
      untinted.slice(0, 4).map((p) => `rgb(${p.r},${p.g},${p.b}) <- ${p.raw}`).join(' | ')
    );

    // --- hairlines ---------------------------------------------------------
    console.log('\n=== one hairline weight ===');
    const widths = Object.keys(surfaces.borders);
    check(
      widths.length === 1 && widths[0] === '1px',
      'every visible border is a 1px hairline',
      `widths present: ${widths.join(', ')}`
    );

    // --- texture -----------------------------------------------------------
    console.log('\n=== the substrate is not flat vector ===');
    check(
      surfaces.overlays >= 1,
      `a fixed, pointer-events-none textured overlay is present (found ${surfaces.overlays})`
    );

    // It must not eat clicks. An overlay that swallows the pointer would break
    // every control under it, and the canvas is the whole product.
    const overlayInert = await page.evaluate(() => {
      const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (!mid) return false;
      const cs = getComputedStyle(mid);
      return !(cs.position === 'fixed' && /url\(|gradient/.test(cs.backgroundImage));
    });
    check(overlayInert, 'the overlay does not intercept the pointer at the centre of the screen');

    console.log('\n=== the shadow layers that were measured ===');
    for (const l of surfaces.layers) {
      console.log(`  rgba(${l.r}, ${l.g}, ${l.b}, ${l.a})  on ${l.count} element(s)  <- ${l.raw}`);
    }
  } finally {
    await browser.close();
  }

  console.log('\n-----------------------------------------');
  if (failures) {
    console.log(`FAIL: ${failures} check(s) failed\n`);
    process.exit(1);
  }
  console.log('PASS: hairlines, tinted shadows, grain\n');
})();
