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

    const start = await toScreen(target.x + pedal.w / 2, target.y + pedal.d / 2);
    const end = await toScreen(target.x + pedal.w / 2 + 3, target.y + pedal.d / 2 + 1.5);

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
    result.afterDrop = { x: dropped.x, y: dropped.y, moved: dropped.x !== target.x || dropped.y !== target.y };

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

    // toolbar buttons present?
    result.toolbar = {
      undoButton: await page.locator('button:has(svg.lucide-undo-2)').count(),
      redoButton: await page.locator('button:has(svg.lucide-redo-2)').count(),
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
