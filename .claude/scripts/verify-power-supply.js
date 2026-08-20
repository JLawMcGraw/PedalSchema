#!/usr/bin/env node
/**
 * The SUPPLY half of the power panel, in the real app.
 *
 * verify-power-panel.js covers demand ("this board wants 681mA"). This covers
 * the question demand cannot answer: given a specific brick, will it run - and
 * critically, does the panel still refuse to claim adequacy when a pedal on an
 * output has no recorded draw.
 *
 * That last check is the whole point. A total can hedge with "at least"; an
 * output cannot. `rated - known` on an output carrying an unknown states a
 * surplus the missing pedal may already have consumed, which reports an
 * inadequate supply as adequate.
 *
 * Usage: node .claude/scripts/verify-power-supply.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, BASE_URL } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());

  try {
    await login(page);
    await page.goto(BASE_URL + '/dashboard');
    await page.waitForLoadState('networkidle');
    const href = await page.$$eval(
      'a[href^="/editor/"]:not([href="/editor/new"])',
      (as) => as.map((a) => a.getAttribute('href'))[0]
    );
    await page.goto(BASE_URL + href);
    await page.waitForFunction(
      () => !!window.__getPedalSchemaSnapshot && window.__getPedalSchemaSnapshot().pedals.length > 0,
      null, { timeout: 30000 }
    );
    console.log(`editor: ${BASE_URL}${href}\n`);

    // Drive the store directly. The panel reads the same state, so this
    // exercises the real engine and the real persistence shape without
    // depending on the panel's markup.

    // The Voodoo Lab's 100mA outputs make over-capacity reachable with
    // ordinary pedals rather than needing a contrived one. Choosing it also
    // proves the catalogue loaded - it is looked up BY NAME from the store.
    const picked = await page.evaluate(() => {
      const store = window.__pedalSchemaSetSupply;
      return store ? store('Pedal Power 2 Plus') : null;
    });
    check(!!picked, `chose a supply (${picked?.name ?? 'none'})`,
      picked ? `${picked.outputs} outputs` : 'window.__pedalSchemaSetSupply missing');
    if (!picked) throw new Error('cannot continue without a supply');

    // Everything onto output 1 (100mA). The board draws far more than that.
    const overloaded = await page.evaluate(() => window.__pedalSchemaAssignAll(0));
    check(
      overloaded.overCapacityCount > 0,
      'piling every pedal onto one 100mA output reports over capacity',
      `${overloaded.knownDrawMa}mA known on a ${overloaded.effectiveRatedMa}mA output`
    );
    check(
      !/within its rating/.test(overloaded.headline),
      'and does not call the supply adequate',
      overloaded.headline
    );

    // Spread them across the SAME supply. This board carries a 300mA Flint
    // and the Pedal Power 2 Plus tops out at 250mA per output, so spreading
    // must NOT clear everything - the honest answer is that this brick cannot
    // run this board however you wire it, and reporting otherwise would be the
    // failure mode in a different costume.
    const spreadSmall = await page.evaluate(() => window.__pedalSchemaAssignSpread());
    check(
      spreadSmall.overCapacityCount > 0,
      'a 300mA pedal on a 250mA-max supply stays over capacity however it is spread',
      spreadSmall.headline
    );

    // The Zuma's outputs are 500mA, which this board fits inside.
    await page.evaluate(() => window.__pedalSchemaSetSupply('Zuma'));
    const spread = await page.evaluate(() => window.__pedalSchemaAssignSpread());
    check(
      spread.overCapacityCount === 0,
      'on a supply that can actually carry it, spreading clears the report',
      spread.headline
    );

    // THE TRAP: one pedal with no recorded draw, on an output that is
    // otherwise comfortable.
    const withUnknown = await page.evaluate(() => window.__pedalSchemaProbeUnknownOnOutput());
    check(
      withUnknown.headroomMa === null,
      'an output carrying an unknown draw reports NO headroom figure',
      `headroomMa = ${JSON.stringify(withUnknown.headroomMa)} (must be null, not ${withUnknown.effectiveRatedMa - withUnknown.knownDrawMa})`
    );
    check(
      /headroom unknown/i.test(withUnknown.headline),
      'and says so in words rather than claiming the supply is fine',
      withUnknown.headline
    );
    check(
      !/within its rating/.test(withUnknown.headline),
      'and never reports it as within rating'
    );

    // The panel is the tab's own region - a match anywhere else on the page
    // would not prove the Power tab rendered it.
    await page.click('[data-panel-tab="power"]');
    const panelText = (await page.locator('[role="tabpanel"]:not([hidden])').innerText())
      .replace(/\s+/g, ' ');
    console.log(`\npanel text: "${panelText}"`);
    check(/Output 1/.test(panelText), 'the panel renders per-output rows');
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
