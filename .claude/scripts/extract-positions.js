#!/usr/bin/env node
/**
 * Extract pedal positions before and after Optimize, and check that the
 * signal chain reads right-to-left (chain position 1 nearest the guitar).
 *
 * Reads the machine twin (window.__getPedalSchemaSnapshot) rather than
 * scraping `g.pedal` rects, so it reports the state the app actually holds
 * instead of re-deriving it from rendered attributes. Parity between the two
 * is verified separately by verify-twin-parity.js.
 *
 * Usage: node .claude/scripts/extract-positions.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, snapshot } = require('./lib/twin');

/** Pedals in chain order, with the derived x values the analysis needs. */
function positions(snap) {
  return snap.pedals
    .map((p) => {
      const rotated = p.rotationDegrees === 90 || p.rotationDegrees === 270;
      const w = (rotated ? p.depthInches : p.widthInches) * snap.scale;
      const x = p.xInches * snap.scale;
      return {
        name: p.name,
        chainPosition: p.chainPosition,
        x: Math.round(x),
        width: Math.round(w),
        centerX: Math.round(x + w / 2),
        rightEdge: Math.round(x + w),
      };
    })
    .sort((a, b) => a.chainPosition - b.chainPosition);
}

function report(label, list) {
  console.log(`\n=== ${label} ===`);
  console.log(`${list.length} pedals:`);
  for (const p of list) {
    console.log(`  Chain ${p.chainPosition}: ${p.name} x=${p.x}, rightEdge=${p.rightEdge}, centerX=${p.centerX}`);
  }
}

async function main() {
  loadEnv();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } }).then((c) => c.newPage());
  let failed = 0;

  try {
    await login(page);
    console.log('editor:', await openEditor(page));

    report('BEFORE OPTIMIZATION', positions(await snapshot(page)));

    await page.getByRole('button', { name: /optimize/i }).click();
    await page.waitForTimeout(2000);

    const snap = await snapshot(page);
    const after = positions(snap);
    report('AFTER OPTIMIZATION', after);

    // The optimizer now explains itself - show what it said it traded off
    const o = snap.lastOptimization;
    if (o) {
      console.log('\n=== OPTIMIZER RATIONALE ===');
      console.log(`  ${o.headline}`);
      console.log(`  score ${o.before.toFixed(2)} -> ${o.after.toFixed(2)} (delta ${o.delta.toFixed(2)})`);
      for (const c of o.changes) {
        const amount =
          c.countDelta !== undefined && c.countDelta !== 0 ? c.countDelta : Number(c.delta.toFixed(2));
        console.log(`    ${c.label}: ${amount > 0 ? '+' : ''}${amount}`);
      }
    }

    if (after.length < 2) {
      console.log('\nFewer than 2 pedals - nothing to verify.');
      return;
    }

    // Chain order should correlate with X: position 1 rightmost (guitar side)
    console.log('\n=== VERIFICATION: SIGNAL FLOW ORDER ===');
    let correct = 0;
    let pairs = 0;
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) {
        pairs++;
        if (after[i].centerX >= after[j].centerX) correct++;
        else {
          console.log(
            `  ✗ Chain ${after[i].chainPosition} (x=${after[i].centerX}) is LEFT of ` +
              `Chain ${after[j].chainPosition} (x=${after[j].centerX})`
          );
        }
      }
    }
    console.log(`\nSignal flow correctness: ${correct}/${pairs} pairs (${Math.round((correct / pairs) * 100)}%)`);

    const byX = [...after].sort((a, b) => b.centerX - a.centerX);
    const first = after[0];
    const last = after[after.length - 1];
    const rightmost = byX[0];
    const leftmost = byX[byX.length - 1];

    const firstIsRightmost = first.centerX >= rightmost.centerX - 30;
    const lastIsLeftmost = last.centerX <= leftmost.centerX + 30;
    if (!firstIsRightmost) failed++;
    if (!lastIsLeftmost) failed++;

    console.log(`\nFirst pedal (Chain ${first.chainPosition}): ${first.name} at x=${first.centerX}`);
    console.log(`Rightmost: ${rightmost.name} (Chain ${rightmost.chainPosition}) at x=${rightmost.centerX}`);
    console.log(`Last pedal (Chain ${last.chainPosition}): ${last.name} at x=${last.centerX}`);
    console.log(`Leftmost: ${leftmost.name} (Chain ${leftmost.chainPosition}) at x=${leftmost.centerX}`);
    console.log(`\n${firstIsRightmost ? '✓ PASS' : '✗ FAIL'}: first pedal in chain is rightmost (closest to guitar)`);
    console.log(`${lastIsLeftmost ? '✓ PASS' : '✗ FAIL'}: last pedal in chain is leftmost (closest to amp)`);
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
