#!/usr/bin/env node
/**
 * Phase 5 verification: live drag rerouting + undo/redo.
 *
 * 1. Drag a pedal via real mouse events; MID-DRAG (before mouseup) sample
 *    cable path `d` attributes and the store's placedPedals. Cables must
 *    have rerouted while the store position is still uncommitted - proving
 *    the preview pipeline (not a store write) moved them.
 * 2. Drop, then Cmd+Z / Shift+Cmd+Z and check the store position reverts
 *    and reapplies exactly.
 *
 * Usage: node .claude/scripts/verify-drag-undo.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    });
  }
}

async function main() {
  loadEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  const result = {};

  try {
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    const editorLink = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = await editorLink.getAttribute('href');
    await page.goto('http://localhost:3000' + href);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // --- helpers evaluated in the page ---
    const sample = () => page.evaluate(() => {
      const st = window.__getPedalSchemaState();
      const cableDs = [...document.querySelectorAll('svg path[stroke-width="3"][stroke-linejoin="round"]')].map(p => p.getAttribute('d'));
      return {
        pedals: st.placedPedals.map(p => ({ id: p.id, x: p.xInches, y: p.yInches })),
        cableDs,
      };
    });

    // Screen position of a board coordinate (inches), accounting for the
    // SVG viewBox and xMidYMid-meet scaling. NOTE: the page is full of
    // lucide icon <svg>s - the canvas is the largest one.
    const toScreen = (bx, by) => page.evaluate(([bx, by]) => {
      const svg = [...document.querySelectorAll('svg')].reduce((best, s) => {
        const r = s.getBoundingClientRect();
        const rb = best?.getBoundingClientRect();
        return !best || r.width * r.height > rb.width * rb.height ? s : best;
      }, null);
      const rect = svg.getBoundingClientRect();
      const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
      const scale = Math.min(rect.width / vw, rect.height / vh);
      return {
        x: rect.left + (rect.width - vw * scale) / 2 + (bx * 40 - vx) * scale,
        y: rect.top + (rect.height - vh * scale) / 2 + (by * 40 - vy) * scale,
      };
    }, [bx, by]);

    const before = await sample();
    // Drag the FIRST pedal in the chain 3 inches right, 1.5 down
    const target = before.pedals[0];
    result.target = target;
    const pedal = await page.evaluate((id) => {
      const st = window.__getPedalSchemaState();
      const p = st.placedPedals.find(x => x.id === id);
      const pd = st.pedalsById[p.pedalId];
      return { w: pd.widthInches, d: pd.depthInches };
    }, target.id);

    // Drag TOWARD THE MIDDLE OF THE BOARD, not a fixed +3/+1.5.
    //
    // The fixed offset was pushing this pedal off the edge and the drop was
    // being rejected: pedals[0] sits at x=28.85 on a 32in board and is 2.9in
    // wide, so +3 needs 34.75in of board. Every "moved" and "restored exactly"
    // assertion below was therefore comparing a position to itself - and
    // `moved` was true only because a round trip through the drag left a
    // 1e-15 crumb on y. Aiming inward makes the move real.
    const board = await page.evaluate(() => {
      const b = window.__getPedalSchemaState().board;
      return { w: b.widthInches, d: b.depthInches };
    });
    const dx = target.x + pedal.w / 2 < board.w / 2 ? 3 : -3;
    const dy = target.y + pedal.d / 2 < board.d / 2 ? 1.5 : -1.5;
    result.delta = { dx, dy, board };

    const start = await toScreen(target.x + pedal.w / 2, target.y + pedal.d / 2);
    const end = await toScreen(target.x + pedal.w / 2 + dx, target.y + pedal.d / 2 + dy);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // move halfway in steps, then wait past the 90ms reroute throttle
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(
        start.x + (end.x - start.x) * 0.5 * (i / 5),
        start.y + (end.y - start.y) * 0.5 * (i / 5)
      );
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(250);

    const midDrag = await sample();
    result.midDrag = {
      storePositionUnchanged: JSON.stringify(midDrag.pedals) === JSON.stringify(before.pedals),
      cablesRerouted: JSON.stringify(midDrag.cableDs) !== JSON.stringify(before.cableDs),
      changedCableCount: midDrag.cableDs.filter((d, i) => d !== before.cableDs[i]).length,
      totalCables: midDrag.cableDs.length,
    };

    // finish the drag
    for (let i = 6; i <= 10; i++) {
      await page.mouse.move(
        start.x + (end.x - start.x) * (i / 10),
        start.y + (end.y - start.y) * (i / 10)
      );
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const afterDrop = await sample();
    const dropped = afterDrop.pedals.find(p => p.id === target.id);
    // Distance, not inequality. `!==` on a float calls a 1e-15 crumb a move.
    result.afterDrop = {
      x: dropped.x,
      y: dropped.y,
      movedInches: Math.hypot(dropped.x - target.x, dropped.y - target.y),
    };

    // --- undo via keyboard ---
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(400);
    const afterUndo = await sample();
    const undone = afterUndo.pedals.find(p => p.id === target.id);
    result.afterUndo = {
      x: undone.x, y: undone.y,
      restoredExactly: undone.x === target.x && undone.y === target.y,
      cablesRestored: JSON.stringify(afterUndo.cableDs) === JSON.stringify(before.cableDs),
    };

    // --- redo via keyboard ---
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await page.waitForTimeout(400);
    const afterRedo = await sample();
    const redone = afterRedo.pedals.find(p => p.id === target.id);
    result.afterRedo = {
      x: redone.x, y: redone.y,
      reappliedExactly: redone.x === dropped.x && redone.y === dropped.y,
    };

    // undo again to leave the user's saved layout untouched
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(300);

    // Toolbar buttons present? Selected BY ACCESSIBLE NAME.
    //
    // These used to be `button:has(svg.lucide-undo-2)`. Swapping the icon set
    // made both selectors match nothing - and this script kept reporting PASS,
    // because it had no assertions at all and only failed if it threw. Two
    // counts silently went to 0 and the suite said everything was fine.
    result.toolbar = {
      undoButton: await page.locator('button[aria-label="Undo"]').count(),
      redoButton: await page.locator('button[aria-label="Redo"]').count(),
    };

    console.log(JSON.stringify(result, null, 2));

    // --- the assertions -----------------------------------------------------
    //
    // Everything above was already measured; none of it was ever CHECKED. A
    // gate that only fails on an exception is a gate that reports a clean
    // sweep while the feature is broken, which is the exact failure this
    // suite's own header warns about.
    console.log('');
    let failures = 0;
    const check = (ok, label, detail) => {
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
      if (detail !== undefined) console.log(`        ${detail}`);
      if (!ok) failures++;
    };

    check(
      result.midDrag.storePositionUnchanged,
      'mid-drag: the store position is still uncommitted',
      JSON.stringify(result.target)
    );
    check(
      result.midDrag.cablesRerouted,
      'mid-drag: cables rerouted anyway - the preview pipeline moved them, not a store write',
      `${result.midDrag.changedCableCount} of ${result.midDrag.totalCables} cable paths changed`
    );
    check(
      result.afterDrop.movedInches >= 1,
      `the drop committed a real move: ${result.afterDrop.movedInches.toFixed(3)}in (needs 1)`,
      JSON.stringify(result.afterDrop)
    );
    check(
      result.afterUndo.restoredExactly,
      'undo restored the position exactly',
      `${result.afterUndo.x}, ${result.afterUndo.y} vs ${result.target.x}, ${result.target.y}`
    );
    check(result.afterUndo.cablesRestored, 'undo restored every cable path');
    check(
      result.afterRedo.reappliedExactly,
      'redo reapplied it exactly',
      `${result.afterRedo.x}, ${result.afterRedo.y} vs ${result.afterDrop.x}, ${result.afterDrop.y}`
    );
    check(result.toolbar.undoButton === 1, `the Undo button is findable (${result.toolbar.undoButton})`);
    check(result.toolbar.redoButton === 1, `the Redo button is findable (${result.toolbar.redoButton})`);

    console.log('\n-----------------------------------------');
    if (failures) {
      console.log(`FAIL: ${failures} check(s) failed\n`);
      process.exitCode = 1;
    } else {
      console.log('PASS: drag reroutes live, undo and redo are exact\n');
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
