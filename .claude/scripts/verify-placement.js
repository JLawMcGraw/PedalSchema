#!/usr/bin/env node
/**
 * Drive Optimize in the real app and check the placement it produces.
 *
 * Placement is geometry, so this asserts on extracted coordinates rather than
 * on a screenshot:
 *   - nothing overlaps, nothing leaves the board
 *   - within a row, x DECREASES as chain position increases (signal flows
 *     right to left, guitar side to amp side)
 *   - rows are consumed in order and never revisited - the failure that made a
 *     3-row board read front -> back -> middle
 *
 * Usage: node .claude/scripts/verify-placement.js [configId]
 * Requires: dev server on :3000, VERIFY_EMAIL/VERIFY_PASSWORD in .env.local
 */
const { chromium } = require('playwright');
const { loadEnv, login, snapshot, BASE_URL } = require('./lib/twin');

/** Group pedals into rows by y, tolerant of sub-inch jitter. */
function rowsOf(pedals) {
  const rows = [];
  for (const p of [...pedals].sort((a, b) => a.yInches - b.yInches)) {
    const row = rows.find((r) => Math.abs(r.y - p.yInches) < 0.6);
    if (row) row.pedals.push(p);
    else rows.push({ y: p.yInches, pedals: [p] });
  }
  return rows;
}

/**
 * A pedal deeper than the row pitch cannot sit inside any band - it spans two
 * of them, exactly as it would on a real board. Such a pedal is not a row-order
 * violation, so it is reported separately rather than counted as a failure.
 */
function straddlers(pedals) {
  const depths = pedals.map((p) => p.depthInches).sort((a, b) => a - b);
  const typical = depths[Math.floor(depths.length / 2)];
  return new Set(pedals.filter((p) => p.depthInches > typical + 0.25).map((p) => p.id));
}

async function checkConfig(page, href) {
  await page.goto(BASE_URL + href);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-pedal-canvas]');
  await page.waitForFunction(() => typeof window.__getPedalSchemaSnapshot === 'function');

  const before = await snapshot(page);
  if (before.pedals.length < 2) return { skipped: true, n: before.pedals.length };

  await page.getByRole('button', { name: /optimize/i }).click();
  await page.waitForTimeout(2500);
  const after = await snapshot(page);
  const o = after.lastOptimization;

  const board = after.board;
  const fails = [];

  // 1. On the board
  for (const p of after.pedals) {
    if (p.xInches < -0.01 || p.yInches < -0.01 ||
        p.xInches + p.widthInches > board.widthInches + 0.01 ||
        p.yInches + p.depthInches > board.depthInches + 0.01) {
      fails.push(`${p.name} off the board at (${p.xInches.toFixed(1)}, ${p.yInches.toFixed(1)})`);
    }
  }

  // 2. No overlaps
  for (let i = 0; i < after.pedals.length; i++) {
    for (let j = i + 1; j < after.pedals.length; j++) {
      const a = after.pedals[i];
      const b = after.pedals[j];
      const ox = Math.min(a.xInches + a.widthInches, b.xInches + b.widthInches) - Math.max(a.xInches, b.xInches);
      const oy = Math.min(a.yInches + a.depthInches, b.yInches + b.depthInches) - Math.max(a.yInches, b.yInches);
      if (ox > 0.01 && oy > 0.01) fails.push(`${a.name} overlaps ${b.name}`);
    }
  }

  // 3. Chain order within each row, and row progression
  const straddling = straddlers(after.pedals);
  const rows = rowsOf(after.pedals.filter((p) => !straddling.has(p.id)));
  const rowOfChain = [];
  rows.forEach((r, ri) => {
    const byChain = [...r.pedals].sort((a, b) => a.chainPosition - b.chainPosition);
    for (let i = 1; i < byChain.length; i++) {
      if (byChain[i].xInches > byChain[i - 1].xInches + 0.01) {
        fails.push(
          `row y=${r.y.toFixed(1)}: chain ${byChain[i].chainPosition} (${byChain[i].name}) sits RIGHT of ` +
          `chain ${byChain[i - 1].chainPosition} - signal should read right to left`
        );
      }
    }
    for (const p of r.pedals) rowOfChain.push({ chain: p.chainPosition, row: ri, y: r.y });
  });
  // The chain must walk rows in ONE direction. Front-to-back (y decreasing)
  // is what the packer intends; either direction is acceptable, but hopping
  // front -> back -> middle is the bug this exists to catch, and it is not
  // caught by "never revisit a row" alone.
  rowOfChain.sort((a, b) => a.chain - b.chain);
  const visitOrder = [];
  for (const e of rowOfChain) {
    if (visitOrder.length === 0 || visitOrder[visitOrder.length - 1].y !== e.y) {
      visitOrder.push({ y: e.y, chain: e.chain });
    }
  }
  const ys = visitOrder.map((v) => v.y);
  const monotonic =
    ys.every((y, i) => i === 0 || y <= ys[i - 1] + 0.01) ||
    ys.every((y, i) => i === 0 || y >= ys[i - 1] - 0.01);
  if (!monotonic) {
    fails.push(
      `rows are visited out of order: ${visitOrder.map((v) => `chain${v.chain}@y${v.y.toFixed(1)}`).join(' -> ')}` +
      ` - the chain must move through rows in one direction`
    );
  }

  return {
    n: after.pedals.length,
    straddling: after.pedals.filter((p) => straddling.has(p.id)).map((p) => `${p.name} (${p.depthInches}in)`),
    board: `${board.name} ${board.widthInches}x${board.depthInches}`,
    rows: rows.map((r) => ({ y: r.y, count: r.pedals.length })),
    headline: o ? o.headline : '(none)',
    score: o ? [o.before, o.after] : null,
    fails,
  };
}

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } }).then((c) => c.newPage());
  let failed = 0;
  try {
    await login(page);
    let hrefs = process.argv[2] ? ['/editor/' + process.argv[2]] : null;
    if (!hrefs) {
      await page.goto(BASE_URL + '/dashboard');
      await page.waitForLoadState('networkidle');
      hrefs = await page.$$eval('a[href^="/editor/"]:not([href="/editor/new"])',
        (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    }
    for (const href of hrefs) {
      const r = await checkConfig(page, href);
      if (r.skipped) { console.log(`\n${href}: ${r.n} pedals - skipped`); continue; }
      console.log(`\n=== ${href} : ${r.n} pedals on ${r.board} ===`);
      console.log(`  rows: ${r.rows.map((x) => `y=${x.y.toFixed(1)}(${x.count})`).join('  ')}`);
      if (r.straddling.length) console.log(`  spanning two rows (too deep for a band): ${r.straddling.join(', ')}`);
      if (r.score) console.log(`  score ${r.score[0].toFixed(1)} -> ${r.score[1].toFixed(1)}`);
      console.log(`  ${r.headline}`);
      if (r.fails.length === 0) console.log('  ✓ legal, in chain order');
      else {
        failed += r.fails.length;
        for (const f of r.fails.slice(0, 12)) console.log(`  ✗ ${f}`);
        if (r.fails.length > 12) console.log(`  ... ${r.fails.length - 12} more`);
      }
    }
    console.log(failed ? `\nRESULT: ${failed} PROBLEM(S)` : '\nRESULT: ALL CHECKS PASS');
  } catch (e) {
    console.error('ERROR:', e.message);
    failed++;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})();
