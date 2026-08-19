#!/usr/bin/env node
/**
 * The canvas viewport: mapping, panning, and reachability.
 *
 * The pure arithmetic behind all of this is unit-tested in
 * `src/lib/canvas/__tests__/viewport.test.ts`. What CANNOT be tested there is
 * the browser seam - getBoundingClientRect, ResizeObserver, pointer capture,
 * passive listeners, preserveAspectRatio - because vitest runs in node here and
 * jsdom performs no layout and has no getScreenCTM. That seam is this file's
 * entire job.
 *
 * The headline check is REACHABILITY: zoomed in on a 32x16in board, the far
 * corner must be reachable. Before pan existed it was not, at any zoom, by any
 * means - which is what the owner reported.
 *
 * Usage: node .claude/scripts/verify-viewport.js [configId]
 * Requires: dev server on :3000, VERIFY_EMAIL/VERIFY_PASSWORD in .env.local
 */
const { chromium } = require('playwright');
const { loadEnv, login, snapshot, toScreen, BASE_URL } = require('./lib/twin');

const CONFIG_ID = process.argv[2] || 'e0a0c21e-3b9d-4d21-b2e8-701a2cd31f6d'; // test, 22 pedals on 32x16

const ok = (label, pass, detail) => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
  return pass ? 0 : 1;
};

/** Dispatch a real wheel event; Playwright's mouse.wheel cannot set ctrlKey. */
async function wheel(page, clientX, clientY, deltaY, ctrlKey) {
  await page.evaluate(
    ([x, y, dy, ctrl]) => {
      const el = document.querySelector('[data-pedal-canvas]');
      el.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: dy, deltaMode: 0,
        ctrlKey: ctrl, bubbles: true, cancelable: true,
      }));
    },
    [clientX, clientY, deltaY, ctrlKey]
  );
  await page.waitForTimeout(120);
}

const vp = (page) => page.evaluate(() => window.__pedalSchemaViewport());

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1000 } }).then((c) => c.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let failures = 0;

  try {
    await login(page);
    await page.goto(`${BASE_URL}/editor/${CONFIG_ID}`);
    await page.waitForFunction(() => typeof window.__pedalSchemaViewport === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => window.__getPedalSchemaSnapshot().pedals.length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(900);

    const snap = await snapshot(page);
    const board = snap.board;
    console.log(`\n=== ${board.name} ${board.widthInches}x${board.depthInches}in, ${snap.pedals.length} pedals ===\n`);

    // ---- 1. Three-way mapping oracle -------------------------------------
    // twin.js (used by ~15 scripts), the app's own mapping, and the browser's
    // own CTM must agree. Any two agreeing could both be wrong the same way.
    let worst = 0;
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const bx = (board.widthInches * i) / 4;
        const by = (board.depthInches * j) / 4;
        const fromTwin = await toScreen(page, bx, by);
        const fromApp = await page.evaluate(([x, y]) => window.__pedalSchemaInchesToClient(x, y), [bx, by]);
        const fromCtm = await page.evaluate(([x, y]) => {
          const el = document.querySelector('[data-pedal-canvas]');
          const p = new DOMPoint(x * 40, y * 40).matrixTransform(el.getScreenCTM());
          return { x: p.x, y: p.y };
        }, [bx, by]);
        worst = Math.max(
          worst,
          Math.abs(fromTwin.x - fromApp.x), Math.abs(fromTwin.y - fromApp.y),
          Math.abs(fromApp.x - fromCtm.x), Math.abs(fromApp.y - fromCtm.y)
        );
      }
    }
    failures += ok('twin.js, the app and the browser CTM agree', worst < 0.5, `max disagreement ${worst.toFixed(3)}px over 25 points`);

    // ---- 2. Drag on empty canvas pans ------------------------------------
    const rect = (await vp(page)).rect;
    const before = await vp(page);
    // Start in the padding above the board, which is never a pedal.
    const sx = rect.left + rect.width / 2;
    const sy = rect.top + 12;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 120, sy + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterDrag = await vp(page);
    const panMoved = Math.abs(afterDrag.pan.x - before.pan.x) + Math.abs(afterDrag.pan.y - before.pan.y);
    failures += ok('dragging empty canvas pans the view', panMoved > 1,
      `pan ${before.pan.x.toFixed(1)},${before.pan.y.toFixed(1)} -> ${afterDrag.pan.x.toFixed(1)},${afterDrag.pan.y.toFixed(1)}`);

    // ---- 3. Bare wheel pans, ctrl+wheel zooms ----------------------------
    // Zoom in FIRST. At fit, the visible extent exceeds the content on at
    // least one axis, and clampPan force-centres such an axis on purpose - so a
    // wheel along it is legitimately a no-op and would look like a broken
    // handler. Both axes are free only once we are zoomed past fit.
    const cx0 = rect.left + rect.width / 2;
    const cy0 = rect.top + rect.height / 2;
    for (let i = 0; i < 6; i++) await wheel(page, cx0, cy0, -240, true);

    const preWheel = await vp(page);
    await wheel(page, cx0, cy0, 120, false);
    const postWheel = await vp(page);
    const panDelta = Math.abs(postWheel.pan.x - preWheel.pan.x) + Math.abs(postWheel.pan.y - preWheel.pan.y);
    failures += ok('bare wheel pans, does not zoom',
      Math.abs(postWheel.zoom - preWheel.zoom) < 1e-9 && panDelta > 1,
      `zoom held at ${postWheel.zoom.toFixed(4)}, pan moved ${panDelta.toFixed(1)}`);

    // ---- 4. ctrl+wheel zooms AT THE CURSOR -------------------------------
    /*
     * Set up a MID-RANGE zoom deliberately rather than wheeling blindly.
     * Zoom-at-cursor is only meaningful where both axes are pannable: at the
     * ceiling a zoom-in is a no-op, and at or below fit clampPan force-centres
     * the axis and legitimately overrules the anchor. Fit, then step in twice.
     */
    await page.getByRole('button', { name: /%/ }).first().click();  // the zoom label = Fit
    await page.waitForTimeout(250);
    for (let i = 0; i < 2; i++) await wheel(page, cx0, cy0, -100, true);

    // Anchor near the centre: close to an edge the pan clamp legitimately
    // overrides the anchor, and the cursor point cannot be held.
    const anchorClient = { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.55 };
    const boardAtAnchorBefore = await page.evaluate(([cx, cy]) => {
      const el = document.querySelector('[data-pedal-canvas]');
      const p = new DOMPoint(cx, cy).matrixTransform(el.getScreenCTM().inverse());
      return { x: p.x / 40, y: p.y / 40 };
    }, [anchorClient.x, anchorClient.y]);
    const zoomBefore = (await vp(page)).zoom;
    await wheel(page, anchorClient.x, anchorClient.y, -240, true);
    const zoomAfter = (await vp(page)).zoom;
    const anchorNowAt = await page.evaluate(([bx, by]) => window.__pedalSchemaInchesToClient(bx, by),
      [boardAtAnchorBefore.x, boardAtAnchorBefore.y]);
    const drift = Math.hypot(anchorNowAt.x - anchorClient.x, anchorNowAt.y - anchorClient.y);
    failures += ok('ctrl+wheel zooms at the cursor', zoomAfter > zoomBefore && drift < 1.5,
      `zoom ${zoomBefore.toFixed(3)} -> ${zoomAfter.toFixed(3)}, anchor drifted ${drift.toFixed(2)}px`);

    // ---- 5. REACHABILITY - the reported bug ------------------------------
    // Zoom well in, then pan to the far bottom-right corner and require it to
    // land inside the canvas. Impossible before pan existed: the viewBox was
    // anchored top-left and the container is overflow-hidden.
    for (let i = 0; i < 12; i++) {
      await wheel(page, rect.left + rect.width / 2, rect.top + rect.height / 2, -240, true);
    }
    const zoomed = (await vp(page)).zoom;
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(rect.left + rect.width * 0.8, rect.top + rect.height * 0.8);
      await page.mouse.down();
      await page.mouse.move(rect.left + rect.width * 0.2, rect.top + rect.height * 0.2, { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(300);
    const corner = await page.evaluate(([w, d]) => window.__pedalSchemaInchesToClient(w, d),
      [board.widthInches, board.depthInches]);
    const r2 = (await vp(page)).rect;
    const inside =
      corner.x >= r2.left - 2 && corner.x <= r2.left + r2.width + 2 &&
      corner.y >= r2.top - 2 && corner.y <= r2.top + r2.height + 2;
    failures += ok(`far corner reachable at zoom ${zoomed.toFixed(2)}`, inside,
      `corner at (${corner.x.toFixed(0)}, ${corner.y.toFixed(0)}) in canvas ` +
      `[${r2.left.toFixed(0)}..${(r2.left + r2.width).toFixed(0)}, ${r2.top.toFixed(0)}..${(r2.top + r2.height).toFixed(0)}]`);

    // ---- 6. The board can never be lost --------------------------------
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(rect.left + rect.width * 0.2, rect.top + rect.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(rect.left + rect.width * 0.9, rect.top + rect.height * 0.9, { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(300);
    const st = await vp(page);
    const finite = Number.isFinite(st.pan.x) && Number.isFinite(st.pan.y) && Number.isFinite(st.zoom);
    /*
     * The invariant is that the board still INTERSECTS the viewport - not that
     * any particular corner is on screen. Zoomed in hard, the visible area is a
     * fraction of the board, so panning to one corner necessarily puts the
     * opposite one far outside. Asserting otherwise would be asserting that
     * zoom does not work.
     */
    const c0 = await page.evaluate(() => window.__pedalSchemaInchesToClient(0, 0));
    const c1 = await page.evaluate(([w, d]) => window.__pedalSchemaInchesToClient(w, d),
      [board.widthInches, board.depthInches]);
    const bx0 = Math.min(c0.x, c1.x), bx1 = Math.max(c0.x, c1.x);
    const by0 = Math.min(c0.y, c1.y), by1 = Math.max(c0.y, c1.y);
    const intersects =
      bx1 > st.rect.left && bx0 < st.rect.left + st.rect.width &&
      by1 > st.rect.top && by0 < st.rect.top + st.rect.height;
    failures += ok('panning to the stops never loses the board', finite && intersects,
      `board spans x ${bx0.toFixed(0)}..${bx1.toFixed(0)}, canvas x ${st.rect.left.toFixed(0)}..${(st.rect.left + st.rect.width).toFixed(0)}`);

    failures += ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures} PROBLEM(S)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
