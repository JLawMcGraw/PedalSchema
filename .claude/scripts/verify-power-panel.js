#!/usr/bin/env node
/**
 * Check the Power panel against the engine, in the real app.
 *
 * Asserts on EXTRACTED TEXT, not on a screenshot: the panel's job is to state
 * a number and to qualify it, and both are readable from the DOM. The specific
 * failure worth catching is the panel presenting a floor as a total - a board
 * with an unrecorded pedal must never read as a plain "NmA across N pedals".
 *
 * Usage: node .claude/scripts/verify-power-panel.js [configId]
 * Requires: dev server on :3000, VERIFY_EMAIL/VERIFY_PASSWORD in .env.local
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor } = require('./lib/twin');

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());
  let failures = 0;
  const check = (ok, label, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`        ${detail}`);
    if (!ok) failures++;
  };

  try {
    await login(page);
    const href = await openEditor(page, process.argv[2]);
    console.log(`editor: ${href}\n`);

    // What the engine says, read from the store the panel renders from.
    const expected = await page.evaluate(() => {
      const s = window.__getPedalSchemaState();
      const known = s.placedPedals.reduce((sum, p) => {
        const pedal = s.pedalsById[p.pedalId];
        return sum + (pedal && pedal.currentMa != null ? pedal.currentMa : 0);
      }, 0);
      const unknown = s.placedPedals.filter((p) => {
        const pedal = s.pedalsById[p.pedalId];
        return !pedal || pedal.currentMa == null;
      }).length;
      return { known, unknown, count: s.placedPedals.length };
    });
    console.log(`engine: ${expected.known}mA known, ${expected.unknown} unknown, ` +
      `${expected.count} pedals\n`);

    await page.click('button[role="tab"]:has-text("Power")');
    await page.waitForTimeout(300);

    // The panel is the tab's own region, so a number elsewhere on the page
    // cannot satisfy these assertions by accident.
    const panel = page.locator('[role="tabpanel"]:not([hidden])');
    const text = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`panel text: "${text.slice(0, 220)}"\n`);

    check(text.includes(`${expected.known}`),
      `states the known total (${expected.known}mA)`);
    check(new RegExp(`${expected.count} pedals?`).test(text),
      `states the pedal count (${expected.count})`);

    if (expected.unknown > 0) {
      check(/at least/i.test(text),
        'qualifies the total as a FLOOR when a draw is unrecorded',
        'a bare total would be read as the whole story');
      check(/no recorded draw/i.test(text),
        'names the unrecorded pedals');
    } else {
      check(!/at least/i.test(text),
        'does NOT say "at least" when every draw is known',
        'over-hedging is its own kind of wrong');
    }

    // Cross-check the per-pedal list against the store rather than trusting
    // the headline alone.
    const rows = await panel.locator('button').allInnerTexts();
    check(rows.length >= expected.count,
      `lists every pedal (${rows.length} rows for ${expected.count} pedals)`);

    /*
     * PROBE_UNKNOWN=1 exercises the branch a real board cannot reach: the
     * catalogue has exactly one pedal with no recorded draw (IR-200), and it
     * is on nobody's board. Without this, the "at least" phrasing - the whole
     * reason this panel separates known from unknown - is never rendered in
     * the app, only unit-tested.
     *
     * Adds the pedal to CLIENT state and never saves, so the stored board is
     * untouched. The browser closes and the change goes with it.
     */
    if (process.env.PROBE_UNKNOWN) {
      console.log('\n--- probing the unrecorded-draw branch (not saved) ---');
      const before = expected.known;
      await page.fill('input[placeholder*="Search" i]', 'IR-200');
      await page.waitForTimeout(400);
      await page.click('button:has-text("IR-200")');
      const canvas = await page.locator('[data-pedal-canvas]').boundingBox();
      await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
      await page.waitForTimeout(400);

      await page.click('button[role="tab"]:has-text("Power")');
      await page.waitForTimeout(300);
      const t2 = (await page.locator('[role="tabpanel"]:not([hidden])').innerText())
        .replace(/\s+/g, ' ').trim();
      console.log(`panel text: "${t2.slice(0, 240)}"\n`);

      check(/at least/i.test(t2), 'now qualifies the total as a floor');
      check(/no recorded draw/i.test(t2), 'names the pedal it could not account for');
      check(t2.includes('IR-200'), 'the unrecorded pedal is IR-200');
      check(t2.includes(`${before}`),
        `the known total is UNCHANGED at ${before}mA - the unknown was not added as 0`);
      check(/unknown/i.test(t2), 'the per-pedal list shows it as unknown, not 0mA');
    }

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  } catch (err) {
    console.error('ERROR:', err.message);
    failures++;
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
})();
