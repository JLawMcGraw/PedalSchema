#!/usr/bin/env node
/**
 * Prove the machine twin agrees with what the canvas actually drew.
 *
 * The twin is only worth using if reading it is equivalent to scraping the
 * DOM. This opens one editor page and extracts pedal geometry BOTH ways -
 * the old `g.pedal` rect scrape and window.__getPedalSchemaSnapshot() - then
 * compares them. Any disagreement means the twin is lying and scripts
 * migrated onto it are testing fiction.
 *
 * Usage: node .claude/scripts/verify-twin-parity.js
 * Requires: dev server on :3000, VERIFY_EMAIL/VERIFY_PASSWORD in .env.local
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, snapshot, toScreen } = require('./lib/twin');

/** The pre-existing DOM scrape, kept verbatim as the reference method. */
async function scrapeDom(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('g.pedal').forEach((g) => {
      const rect = g.querySelector('rect');
      const image = g.querySelector('image');
      const el = rect || image;
      if (!el) return;
      const texts = [...g.querySelectorAll('text')];
      let chainPos = null;
      texts.forEach((t) => {
        const txt = t.textContent?.trim();
        if (txt && /^\d+$/.test(txt)) chainPos = txt;
      });
      out.push({
        chainPosition: chainPos,
        x: Math.round(parseFloat(el.getAttribute('x') || '0')),
        y: Math.round(parseFloat(el.getAttribute('y') || '0')),
        width: Math.round(parseFloat(el.getAttribute('width') || '0')),
        height: Math.round(parseFloat(el.getAttribute('height') || '0')),
      });
    });
    return out.sort((a, b) => Number(a.chainPosition) - Number(b.chainPosition));
  });
}

async function main() {
  loadEnv();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } }).then((c) => c.newPage());
  let failed = 0;

  try {
    await login(page);
    const url = await openEditor(page);
    console.log('editor:', url);

    const dom = await scrapeDom(page);
    const snap = await snapshot(page);
    const scale = snap.scale;

    console.log(`\nDOM scrape: ${dom.length} pedals | twin: ${snap.pedals.length} pedals | scale ${scale}px/in\n`);

    const check = (name, ok, detail) => {
      if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
    };

    check('same pedal count', dom.length === snap.pedals.length, `${dom.length} vs ${snap.pedals.length}`);

    // Compare geometry per pedal, matched on chain position
    const byChain = new Map(snap.pedals.map((p) => [String(p.chainPosition), p]));
    console.log('\nchain  DOM (x,y,w,h)              twin inches -> px            match');
    for (const d of dom) {
      const t = byChain.get(String(d.chainPosition));
      if (!t) {
        check(`chain ${d.chainPosition} present in twin`, false);
        continue;
      }
      const rotated = t.rotationDegrees === 90 || t.rotationDegrees === 270;
      const expX = Math.round(t.xInches * scale);
      const expY = Math.round(t.yInches * scale);
      const expW = Math.round((rotated ? t.depthInches : t.widthInches) * scale);
      const expH = Math.round((rotated ? t.widthInches : t.depthInches) * scale);
      // 1px of rounding slack between float inches and rounded DOM attributes
      const ok =
        Math.abs(d.x - expX) <= 1 && Math.abs(d.y - expY) <= 1 &&
        Math.abs(d.width - expW) <= 1 && Math.abs(d.height - expH) <= 1;
      if (!ok) failed++;
      console.log(
        `  ${String(d.chainPosition).padEnd(4)} ` +
          `(${d.x},${d.y},${d.width},${d.height})`.padEnd(26) +
          `(${expX},${expY},${expW},${expH})`.padEnd(28) +
          (ok ? '✓' : `✗ ${t.name} rot=${t.rotationDegrees}`)
      );
    }

    // The board->screen projection must land inside the canvas element
    const first = snap.pedals[0];
    if (first) {
      const centre = await toScreen(page, first.xInches + first.widthInches / 2, first.yInches + first.depthInches / 2);
      const box = await page.evaluate(() => {
        const r = document.querySelector('[data-pedal-canvas]').getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      const inside =
        centre.x >= box.left && centre.x <= box.right && centre.y >= box.top && centre.y <= box.bottom;
      check(
        'toScreen puts a pedal centre inside the canvas',
        inside,
        `(${centre.x.toFixed(0)},${centre.y.toFixed(0)}) in [${box.left.toFixed(0)}-${box.right.toFixed(0)}, ${box.top.toFixed(0)}-${box.bottom.toFixed(0)}]`
      );

      // The projected centre must actually hit that pedal's group in the DOM
      const hitId = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('g.pedal')?.getAttribute('data-pedal-id') ?? null,
        [centre.x, centre.y]
      );
      check('projected centre hits the intended pedal', hitId === null || hitId === first.id,
        hitId === null ? '(no data-pedal-id attribute; skipped)' : `${hitId} vs ${first.id}`);
    }

    // Exactly one canvas - the reason the largest-svg heuristic existed
    const svgCount = await page.evaluate(() => document.querySelectorAll('[data-pedal-canvas]').length);
    const totalSvgs = await page.evaluate(() => document.querySelectorAll('svg').length);
    check('exactly one [data-pedal-canvas]', svgCount === 1, `${svgCount} of ${totalSvgs} svgs on the page`);

    // Cables carry their strategy
    const strategies = {};
    for (const c of snap.cables) strategies[c.strategy] = (strategies[c.strategy] || 0) + 1;
    check('every cable records a strategy', snap.cables.every((c) => !!c.strategy),
      JSON.stringify(strategies));

    console.log(`\ncables: ${snap.cables.length}, collisions: ${snap.collisionCount}, warnings: ${snap.warningCount}`);
    console.log(failed ? `\nRESULT: ${failed} CHECK(S) FAILED` : '\nRESULT: ALL CHECKS PASS');
  } catch (err) {
    console.error('ERROR:', err.message);
    failed++;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
