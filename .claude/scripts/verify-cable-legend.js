#!/usr/bin/env node
/**
 * Verify the cable legend against the board it claims to describe.
 *
 * NOT a screenshot check. The legend's whole job is to agree with the strokes
 * the canvas drew, so the gate is a cross-reference: every kind present in the
 * derived routing appears as a legend row, no row appears for a kind that is
 * absent, and each swatch's stroke and dash EXACTLY equal the stroke and dash
 * of a real cable of that kind, read out of the SVG the canvas rendered.
 *
 * Then it exercises the failure branch, which no saved board currently
 * reaches: a chain order that produces two unroutable cables is loaded
 * IN MEMORY through __loadPedalSchemaRepro. Nothing is written - the page is
 * never saved, and reloading restores the stored board.
 *
 * Usage: node .claude/scripts/verify-cable-legend.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, waitForCanvas, snapshot, BASE_URL } = require('./lib/twin');

const CONFIG_ID = process.env.CONFIG_ID || 'e0a0c21e-3b9d-4d21-b2e8-701a2cd31f6d';

/** Read the legend out of the DOM. */
async function readLegend(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-cable-legend]');
    if (!root) return null;
    return {
      rows: [...root.querySelectorAll('[data-legend-kind]')].map((li) => ({
        kind: li.getAttribute('data-legend-kind'),
        text: li.textContent.trim().replace(/\s+/g, ' '),
        title: li.getAttribute('title'),
        stroke: li.querySelector('[data-swatch]')?.getAttribute('stroke') ?? null,
        dash: li.querySelector('[data-swatch]')?.getAttribute('stroke-dasharray') ?? null,
      })),
      failures: [...root.querySelectorAll('[data-legend-failure]')].map((li) => ({
        label: li.getAttribute('data-legend-failure'),
        text: li.textContent.trim().replace(/\s+/g, ' '),
      })),
      heading: root.querySelector('.text-red-400')?.textContent.trim() ?? null,
    };
  });
}

/** What the engine says each cable is, straight from derived state. */
async function readAppearances(page) {
  return page.evaluate(() => {
    const d = window.__getPedalSchemaDerived();
    return d.routedCables.map((rc) => ({
      valid: rc.valid,
      strategy: rc.strategy,
      cableType: rc.cable.cableType,
      kind: !rc.valid ? 'unroutable'
        : rc.strategy === 'perimeter' ? 'around'
        : rc.cable.cableType === 'instrument' ? 'instrument'
        : rc.cable.cableType === 'power' ? 'power' : 'patch',
    }));
  });
}

/** The stroke the canvas actually painted, per kind, read from the live SVG. */
async function readDrawnStrokes(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-pedal-canvas]');
    const d = window.__getPedalSchemaDerived();
    // Cable <g> elements are emitted in routedCables order, after the defs and
    // board layers - match them by index against the same array the legend read.
    const groups = [...svg.querySelectorAll('g[style*="pointer-events"]')];
    const out = {};
    d.routedCables.forEach((rc, i) => {
      const g = groups[i];
      if (!g) return;
      const strokes = [...g.querySelectorAll('path')];
      const line = strokes[strokes.length - 1]; // second path is the coloured one
      const kind = !rc.valid ? 'unroutable'
        : rc.strategy === 'perimeter' ? 'around'
        : rc.cable.cableType === 'instrument' ? 'instrument'
        : rc.cable.cableType === 'power' ? 'power' : 'patch';
      out[kind] = out[kind] || {
        stroke: line.getAttribute('stroke'),
        dash: line.getAttribute('stroke-dasharray'),
      };
    });
    return out;
  });
}

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1100 } }).then((c) => c.newPage());
  try {
    await login(page);
    await openEditor(page, CONFIG_ID);

    // --- The saved board ----------------------------------------------------
    const snap = await snapshot(page);
    const appearances = await readAppearances(page);
    const legend = await readLegend(page);
    const drawn = await readDrawnStrokes(page);

    console.log(`\nSAVED BOARD  ${snap.pedals.length} pedals, ${appearances.length} cables`);
    const tally = {};
    appearances.forEach((a) => { tally[a.kind] = (tally[a.kind] || 0) + 1; });
    console.log(`  drawn kinds  ${JSON.stringify(tally)}`);
    console.log(`  legend rows  ${JSON.stringify(legend?.rows.map((r) => r.kind))}\n`);

    check(!!legend, 'legend is present on the canvas');
    if (legend) {
      const present = [...new Set(appearances.map((a) => a.kind))].sort();
      const rows = legend.rows.map((r) => r.kind).sort();
      check(
        JSON.stringify(present) === JSON.stringify(rows),
        `legend rows match the kinds on the board (${rows.join(',')} vs ${present.join(',')})`
      );

      for (const row of legend.rows) {
        const real = drawn[row.kind];
        if (!real) { check(false, `no drawn cable found for legend row "${row.kind}"`); continue; }
        check(row.stroke === real.stroke,
          `"${row.kind}" swatch stroke ${row.stroke} == canvas stroke ${real.stroke}`);
        check(!!row.dash === !!real.dash,
          `"${row.kind}" swatch dashed=${!!row.dash} == canvas dashed=${!!real.dash}`);
        check(!!row.title && row.title.length > 10,
          `"${row.kind}" row carries an explanation: "${row.text}" (${row.title})`);
      }

      const invalid = appearances.filter((a) => !a.valid).length;
      check(legend.failures.length === invalid,
        `failure entries (${legend.failures.length}) == unroutable cables (${invalid})`);
    }

    // --- The failure branch, in memory only ---------------------------------
    // A chain order that leaves two cables unroutable. Reachable by hand (the
    // user can order their chain), and applied through initConfiguration so
    // nothing is persisted.
    console.log('\nFAILURE BRANCH  (in-memory chain reorder, never saved)');
    const scrambled = { '04ca33be': 14, '60559dea': 15, '89936b2e': 13, 'faca3fd3': 20, '4ac8291f': 18 };
    await page.evaluate((positions) => {
      const s = window.__getPedalSchemaState();
      window.__loadPedalSchemaRepro({
        ...s,
        placedPedals: s.placedPedals.map((p) => {
          const key = Object.keys(positions).find((k) => p.id.startsWith(k));
          return key ? { ...p, chainPosition: positions[key] } : p;
        }),
      });
    }, scrambled);
    await waitForCanvas(page);
    await page.waitForFunction(
      () => window.__getPedalSchemaDerived().routedCables.some((rc) => !rc.valid),
      { timeout: 10000 }
    ).catch(() => {});

    const after = await readAppearances(page);
    const legend2 = await readLegend(page);
    const invalid2 = after.filter((a) => !a.valid);
    console.log(`  unroutable cables now: ${invalid2.length}`);

    check(invalid2.length > 0, 'the reorder produces at least one unroutable cable to explain');
    if (legend2) {
      check(legend2.failures.length === invalid2.length,
        `failure entries (${legend2.failures.length}) == unroutable cables (${invalid2.length})`);
      check(/will not fit/.test(legend2.heading || ''), `heading names the problem: "${legend2.heading}"`);
      check(legend2.rows.some((r) => r.kind === 'unroutable'),
        'the red swatch row appears once a cable is red');
      for (const f of legend2.failures) {
        check(/at [\d.]+in clearance/.test(f.text),
          `"${f.label}" states the clearance it was refused at`);
        check(/->|→|through/.test(f.text) && f.text.length > 60,
          `"${f.label}" names a cause: "${f.text}"`);
      }
    } else {
      check(false, 'legend still present after the reorder');
    }

    // --- below the lg breakpoint ---------------------------------------------
    //
    // The legend lifts to `bottom-14` under lg to clear the mobile floating
    // action buttons, which sit at `bottom-4` in a SIBLING container
    // (editor-client) - absolutely positioned in a different stacking parent,
    // so nothing lays them out against each other.
    //
    // That was DERIVED FROM READING THE CSS and never rendered: this gate ran
    // only at 1600x1100, which is above the breakpoint. Reasoning about a
    // stacking context is exactly the kind of spatial claim this project does
    // not accept without a measurement, so here is the measurement.
    console.log('\nBELOW THE lg BREAKPOINT  (390x844, where the mobile FABs appear)');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/editor/${CONFIG_ID}`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForCanvas(page);

    const boxes = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, top: r.top };
      };
      const legend = document.querySelector('[data-cable-legend]');
      // The FABs are the only buttons inside the lg:hidden overlay.
      const fabs = [...document.querySelectorAll('.lg\\:hidden button')]
        .map(rect)
        .filter((b) => b && b.width > 0 && b.height > 0);
      return { legend: rect(legend), fabs, viewport: { w: window.innerWidth, h: window.innerHeight } };
    });

    check(!!boxes.legend, 'the legend still renders on a phone viewport');
    check(boxes.fabs.length > 0, `the mobile action buttons are present (${boxes.fabs.length} found)`);

    if (boxes.legend && boxes.fabs.length) {
      const overlaps = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
                                   a.y + a.height <= b.y || b.y + b.height <= a.y);
      const hit = boxes.fabs.filter((f) => overlaps(boxes.legend, f));
      console.log(`  legend  y ${boxes.legend.top.toFixed(0)}..${boxes.legend.bottom.toFixed(0)}`);
      boxes.fabs.forEach((f, i) => console.log(`  fab ${i}   y ${f.top.toFixed(0)}..${f.bottom.toFixed(0)}  x ${f.x.toFixed(0)}..${(f.x + f.width).toFixed(0)}`));
      check(hit.length === 0, `legend clears the mobile action buttons (${hit.length} overlapping)`);
      check(boxes.legend.bottom <= boxes.viewport.h + 1,
        `legend sits inside the viewport (bottom ${boxes.legend.bottom.toFixed(0)} <= ${boxes.viewport.h})`);
    }

    // Evidence, not verification - but the 19rem block that covered four
    // pedals got through a DOM check and was caught by eye, so it earns a shot.
    if (process.env.LEGEND_SHOT) {
      await page.screenshot({ path: process.env.LEGEND_SHOT });
      console.log(`  screenshot -> ${process.env.LEGEND_SHOT}`);
    }

    console.log(fail.length === 0
      ? '\nPASS - the legend describes the board it is drawn on, and explains every red cable'
      : `\nFAIL - ${fail.length} check(s) failed`);
    process.exit(fail.length === 0 ? 0 : 1);
  } finally {
    await browser.close();
  }
})();
