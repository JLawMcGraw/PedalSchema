#!/usr/bin/env node
/**
 * Measured values are set in tabular figures.
 *
 * This is not a style preference. In proportional figures a "1" is narrower
 * than an "8", so a column of currents - 90mA, 1240mA, 18mA - has its digits
 * in different places on every row, and the eye cannot compare them by shape.
 * A board planner is a column of numbers with a picture attached.
 *
 * The check WALKS THE RENDERED DOM and finds the numbers itself, rather than
 * asserting a class is present somewhere. Sixteen `tabular-nums` classes were
 * already scattered across eight files before this ran, and the panels still
 * had bare numbers in them - a class list cannot tell you about the sites
 * nobody remembered.
 *
 * What this does NOT check: the currentMa three-state. A gate cannot fail on
 * it - no pedal in the catalogue draws a real 0 - so that guarantee lives in
 * src/lib/__tests__/format-pedal.test.ts, where a 0 can simply be passed in.
 * A check that cannot fail is not a check.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-readouts.js
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

/**
 * Every leaf element whose visible text is a measured value: a number carrying
 * a unit, or a bare number in a list of them. SVG is skipped - the canvas
 * draws its own labels and does not inherit CSS text settings the same way.
 */
const findReadouts = (page) =>
  page.evaluate(() => {
    const UNIT = /\d\s*(mA|V|in|"|”|%|px|ms)\b|\d["”]/;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg')) continue;
      if (el.children.length > 0) continue; // leaves only
      const text = (el.textContent || '').trim();
      if (!text || text.length > 40) continue;
      if (!UNIT.test(text)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      out.push({
        text,
        variant: cs.fontVariantNumeric,
        family: cs.fontFamily,
        where: el.className && typeof el.className === 'string' ? el.className.slice(0, 40) : '',
      });
    }
    return out;
  });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);
    await openEditor(page);
    await waitForCanvas(page);

    // The panels that hold the numbers. Power is the densest column in the app.
    // Addressed by `data-panel-tab`, which is the tab's VALUE - the label text
    // is a display string and was a selector bet two gates already lost.
    for (const tab of ['power', 'cables', 'properties']) {
      const button = page.locator(`[data-panel-tab="${tab}"]`).first();
      if (await button.count()) {
        await button.click();
        // Wait for the tab to actually BE selected, not for a guessed number of
        // milliseconds. A sleep here is a race that passes on a fast machine.
        await page
          .locator(`[data-panel-tab="${tab}"][data-state="active"]`)
          .waitFor({ timeout: 5000 });
      }
    }

    console.log('\n=== measured values found in the rendered DOM ===');
    const readouts = await findReadouts(page);
    check(readouts.length >= 5, `found ${readouts.length} rendered measured values to check`);

    const proportional = readouts.filter((r) => !/tabular-nums/.test(r.variant));
    check(
      proportional.length === 0,
      `all ${readouts.length} are in tabular figures`,
      proportional
        .slice(0, 8)
        .map((r) => `"${r.text}" -> font-variant-numeric: ${r.variant || 'normal'}`)
        .join('\n        ')
    );

    console.log('\n=== a sample of what was checked ===');
    for (const r of readouts.slice(0, 10)) {
      console.log(`  ${JSON.stringify(r.text).padEnd(24)} ${r.variant || 'normal'}`);
    }
  } finally {
    await browser.close();
  }

  console.log('\n-----------------------------------------');
  if (failures) {
    console.log(`FAIL: ${failures} check(s) failed\n`);
    process.exit(1);
  }
  console.log('PASS: measured values are tabular\n');
})();
