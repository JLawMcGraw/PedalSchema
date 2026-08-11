#!/usr/bin/env node
/**
 * Where does the canvas actually DRAW a pedal's jacks?
 *
 * Extracts the pedal body rect and its jack circles from the live SVG and
 * compares coordinates - the drawing is geometry, so it is checked as geometry
 * rather than by looking at a screenshot.
 *
 * Board convention (see scraper/pedal_jacks.json): `top` is the REAR edge,
 * away from the player. The canvas puts y=0 at the back, and SVG y grows
 * downward, so the rear edge draws at the TOP of the screen and a top-side
 * jack must sit on the pedal's upper edge.
 *
 * Usage: node .claude/scripts/verify-jack-render.js "Conspiracy Theory"
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor } = require('./lib/twin');

const PEDAL = process.argv[2] || 'Conspiracy Theory';

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());
  let failures = 0;

  try {
    await login(page);
    await openEditor(page, process.env.CONFIG_ID);

    // Add the pedal (client state only - never saved)
    await page.fill('input[placeholder*="Search" i]', PEDAL);
    await page.waitForTimeout(400);
    await page.click(`button:has-text("${PEDAL}")`);

    /*
     * Click an EMPTY part of the canvas, found rather than assumed.
     *
     * This used to click the middle (0.5, 0.55) and stopped working the day
     * `a83702a` optimized the `test` board: packing 22 pedals put one under
     * that point, and PedalRenderer's onClick calls stopPropagation, so the
     * canvas's own add-pedal handler never ran. The pedal was never placed and
     * the script failed on the NEXT line, blaming the store.
     *
     * A fixed coordinate is a bet that the board stays sparse. Scan for a gap
     * instead: any point over no pedal, and not over the legend either.
     */
    const canvas = await page.locator('[data-pedal-canvas]').boundingBox();
    const spot = await page.evaluate(({ x, y, width: w, height: h }) => {
      for (let fy = 0.15; fy <= 0.9; fy += 0.05) {
        for (let fx = 0.1; fx <= 0.9; fx += 0.05) {
          const px = x + w * fx, py = y + h * fy;
          const el = document.elementFromPoint(px, py);
          if (!el) continue;
          if (!el.closest('[data-pedal-canvas]')) continue;   // off the canvas
          if (el.closest('[data-cable-legend]')) continue;    // under the legend
          if (el.closest('[data-pedal-id]')) continue;        // over a pedal
          if (el.tagName === 'image' || el.tagName === 'IMAGE') continue;
          return { px, py };
        }
      }
      return null;
    }, canvas);
    if (!spot) throw new Error('no empty spot on the canvas to place a pedal - board too full');
    await page.mouse.click(spot.px, spot.py);
    await page.waitForTimeout(500);

    // What the store says
    const model = await page.evaluate((name) => {
      const s = window.__getPedalSchemaState();
      const placed = s.placedPedals.find((p) => (s.pedalsById[p.pedalId] || {}).name === name);
      if (!placed) return null;
      const pedal = s.pedalsById[placed.pedalId];
      return {
        id: placed.id, rotation: placed.rotationDegrees,
        x: placed.xInches, y: placed.yInches,
        w: pedal.widthInches, d: pedal.depthInches,
        jacks: (pedal.jacks || []).map((j) => ({ type: j.jackType, side: j.side, pct: j.positionPercent })),
      };
    }, PEDAL);

    if (!model) throw new Error(`${PEDAL} not found in store after adding`);
    console.log(`store: ${PEDAL} at (${model.x}, ${model.y})in, ${model.w}x${model.d}in, ` +
      `rotation=${model.rotation}`);
    console.log(`store jacks: ${model.jacks.map((j) => `${j.type}:${j.side}@${j.pct}`).join(', ')}\n`);

    // What the SVG draws: the pedal's <g> holds its rect/image and its circles
    const drawn = await page.evaluate((id) => {
      const g = document.querySelector(`[data-pedal-id="${id}"]`) || null;
      const scope = g || document;
      // circle[data-jack] only: the pedal group also holds the chain-position
      // badge and a collision dot, and counting those reported a rendering bug
      // that was really a selector unable to tell a jack from a badge.
      const circles = [...scope.querySelectorAll('circle[data-jack]')].map((c) => ({
        cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'),
        fill: c.getAttribute('fill'), stroke: c.getAttribute('stroke'),
        jackType: c.getAttribute('data-jack'),
      }));
      const rects = [...scope.querySelectorAll('rect')].map((r) => ({
        x: +r.getAttribute('x'), y: +r.getAttribute('y'),
        w: +r.getAttribute('width'), h: +r.getAttribute('height'),
      }));
      return { hasGroup: !!g, circles, rects };
    }, model.id);

    const SCALE = 40;
    const bodyTop = model.y * SCALE;
    const bodyBottom = (model.y + model.d) * SCALE;
    const mid = (bodyTop + bodyBottom) / 2;
    console.log(`body spans y ${bodyTop.toFixed(1)} .. ${bodyBottom.toFixed(1)} px (midline ${mid.toFixed(1)})`);

    // Only circles inside this pedal's vertical span are its jacks
    const mine = drawn.circles.filter((c) => c.cy >= bodyTop - 6 && c.cy <= bodyBottom + 6
      && c.cx >= model.x * SCALE - 6 && c.cx <= (model.x + model.w) * SCALE + 6);
    console.log(`jack circles found for this pedal: ${mine.length}`);
    for (const c of mine) {
      const where = c.cy < mid ? 'UPPER half (rear)' : 'LOWER half (front)';
      console.log(`   ${String(c.jackType).padEnd(7)} cy=${c.cy.toFixed(1)}  ${where}   fill=${c.fill}`);
    }

    const expectTop = model.jacks.filter((j) => j.side === 'top').length;
    const drawnUpper = mine.filter((c) => c.cy < mid).length;
    const ok = expectTop === 0 || (drawnUpper === expectTop && mine.length === model.jacks.length);
    console.log(`\n  ${ok ? 'PASS' : 'FAIL'}  ${expectTop} jack(s) recorded on the top edge, ` +
      `${drawnUpper} drawn in the upper half`);
    if (!ok) failures++;

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  } catch (err) {
    console.error('ERROR:', err.message);
    failures++;
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
