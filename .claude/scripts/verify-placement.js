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

/**
 * Signal order, walked from the guitar along the real cable graph.
 *
 * NOT chainPosition: that is the user's list order, and a hub pedal (NS-2
 * style) reorders the physical path - its loop members come AFTER it in
 * signal even though they precede it in the list. Comparing positions against
 * chainPosition flags a correct layout as broken.
 */
function signalOrder(snapshot) {
  const next = new Map();
  for (const c of snapshot.cables) {
    if (!next.has(c.from)) next.set(c.from, []);
    next.get(c.from).push(c.to);
  }
  const order = new Map();
  const seen = new Set();
  let n = 0;
  const walk = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.startsWith('pedal:')) {
      const id = node.slice('pedal:'.length);
      if (!order.has(id)) order.set(id, n++);
    }
    for (const to of next.get(node) || []) walk(to);
  };
  const segmentOf = new Map();
  const walkSegment = (start) => {
    const before = new Set(order.keys());
    walk(start);
    for (const id of order.keys()) if (!before.has(id)) segmentOf.set(id, start);
  };
  for (const start of ['guitar', 'amp_send']) walkSegment(start);
  // Anything the walk did not reach keeps its list order, after the rest
  for (const p of [...snapshot.pedals].sort((a, b) => a.chainPosition - b.chainPosition)) {
    if (!order.has(p.id)) { order.set(p.id, n++); segmentOf.set(p.id, 'unreached'); }
  }
  order.segmentOf = segmentOf;
  return order;
}

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
 * A pedal too deep for any band cannot sit inside one - it spans two, exactly
 * as it would on a real board. Such a pedal is not a row-order violation, so it
 * is reported separately rather than counted as a failure.
 *
 * Deciding this by DEPTH ALONE ("deeper than typical") went wrong as soon as
 * rows got variable heights: a 5.43in pedal in a back row grown to 5.43in is
 * housed, not straddling, and excusing it hid whether it was placed in signal
 * order - the one thing this check exists to catch. A pedal straddles when its
 * body actually reaches into the row in front of it.
 *
 * Row starts are the y values SHARED by two or more pedals: a straddler sits at
 * a y of its own, and must not be mistaken for a row that others reach into.
 */
function straddlers(pedals) {
  const counts = new Map();
  for (const p of pedals) {
    const y = Number(p.yInches.toFixed(2));
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  const rowYs = [...counts.entries()].filter(([, n]) => n >= 2).map(([y]) => y);
  return new Set(
    pedals
      .filter((p) => rowYs.some((y) => y > p.yInches + 0.01 && y < p.yInches + p.depthInches - 0.01))
      .map((p) => p.id)
  );
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

  // 3. Signal order within each row, and row progression
  const order = signalOrder(after);
  const seq = (p) => order.get(p.id) ?? p.chainPosition;
  const straddling = straddlers(after.pedals);
  const rows = rowsOf(after.pedals.filter((p) => !straddling.has(p.id)));
  /*
   * BOTH CHECKS BELOW RUN PER SIGNAL SEGMENT, NOT OVER THE WHOLE WALK.
   *
   * `signalOrder` walks from 'guitar' and then from 'amp_send' and numbers the
   * result continuously, but those are two INDEPENDENT runs: the front-of-amp
   * chain ends at the amp input, and the effects-loop chain starts again at the
   * amp send. Concatenating them and demanding one continuous progression
   * asserts something no part of the engine promises.
   *
   * It produced a false failure on the owner's 22-pedal board (2026-08-19).
   * Measured there:
   *
   *   segment guitar    sig 0-17   rows y10.9 -> y5.45 -> y0.0   monotonic
   *   segment amp_send  sig 18-21  row  y5.45 only               monotonic
   *
   * ...and the reported "violation" was exactly the join between the two -
   * IR-2 (last before the amp input) followed by DD-7 (first in the loop).
   * Nothing was misplaced.
   *
   * The engine's own invariant already had this right:
   * `src/lib/engine/__tests__/support/invariants.ts` chainOrderViolations calls
   * checkRowMonotonic once for the primary chain and once per non-primary
   * segment, and never across a boundary. This script now matches that
   * definition rather than inventing a second, stricter one.
   */
  const segmentOf = (p) => order.segmentOf.get(p.id) ?? 'unreached';
  const rowOfChain = [];
  rows.forEach((r, ri) => {
    const byChain = [...r.pedals].sort((a, b) => seq(a) - seq(b));
    for (let i = 1; i < byChain.length; i++) {
      // Only compare neighbours from the SAME run - two runs sharing a row are
      // not required to interleave right-to-left with each other.
      if (segmentOf(byChain[i]) !== segmentOf(byChain[i - 1])) continue;
      if (byChain[i].xInches > byChain[i - 1].xInches + 0.01) {
        fails.push(
          `row y=${r.y.toFixed(1)}: ${byChain[i].name} sits RIGHT of ${byChain[i - 1].name}, ` +
          `but comes after it in the signal path - should read right to left`
        );
      }
    }
    for (const p of r.pedals) rowOfChain.push({ chain: seq(p), row: ri, y: r.y, segment: segmentOf(p) });
  });

  // The chain must walk rows in ONE direction WITHIN a segment. Front-to-back
  // (y decreasing) is what the packer intends; either direction is acceptable,
  // but hopping front -> back -> middle is the bug this exists to catch, and it
  // is not caught by "never revisit a row" alone.
  for (const segment of new Set(rowOfChain.map((e) => e.segment))) {
    const inSegment = rowOfChain.filter((e) => e.segment === segment).sort((a, b) => a.chain - b.chain);
    const visitOrder = [];
    for (const e of inSegment) {
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
        `[${segment}] rows are visited out of order: ` +
        `${visitOrder.map((v) => `chain${v.chain}@y${v.y.toFixed(1)}`).join(' -> ')}` +
        ` - the chain must move through rows in one direction`
      );
    }
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
