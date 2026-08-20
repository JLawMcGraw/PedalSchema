#!/usr/bin/env node
/**
 * The pedal library is grouped, collapsed, and survives being clicked.
 *
 * It used to be 67 pedals in one flat list - measured at 2950px of scroll in
 * a ~684px panel, four and a half screens deep with no structure.
 *
 * The check that earns its place is CLICKING A SECTION. The first version of
 * this panel read `e.currentTarget` inside a setState updater, where React has
 * already nulled it; the throw happened during the commit and took the WHOLE
 * PANEL down - sections, search box and all - on the first click of any
 * heading. Nothing about the markup looked wrong, and a screenshot of the
 * default state looked perfect.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-library-density.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const SEARCH = 'input[placeholder="Search pedals..."]';

const state = (page) =>
  page.evaluate(() => {
    const sections = [...document.querySelectorAll('details')];
    const viewport = document.querySelector('[data-radix-scroll-area-viewport]');
    const chevron = sections[0]?.querySelector('summary svg');
    return {
      sections: sections.length,
      open: sections.filter((d) => d.open).length,
      searchBoxPresent: !!document.querySelector('input[placeholder="Search pedals..."]'),
      contentH: viewport ? viewport.scrollHeight : null,
      // Pedal rows inside OPEN sections. The height delta used to stand in for
      // this, and stopped working the moment the panel got compact enough for
      // its content to fit the viewport: scrollHeight then equals clientHeight
      // and does not move when a section opens. Counting what was revealed is
      // the thing the check was always trying to say.
      revealed: [...document.querySelectorAll('details[open]')].reduce(
        (n, d) => n + d.querySelectorAll('button, [role="button"]').length,
        0
      ),
      viewH: viewport ? viewport.clientHeight : null,
      // Tailwind v4 compiles rotate-90 to the `rotate` PROPERTY. Reading
      // `transform` here returns "none" either way and proves nothing.
      firstChevronRotate: chevron ? getComputedStyle(chevron).rotate : null,
    };
  });

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 950 } })
    .then((c) => c.newPage());

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    await login(page);
    await openEditor(page);
    await page.waitForSelector('details', { timeout: 20000 });

    // --- 1. grouped and collapsed ---------------------------------------
    const base = await state(page);
    check(base.sections > 1, `the library is grouped`, `${base.sections} categories`);
    check(base.open === 0, 'every section starts collapsed', `${base.open} open`);
    check(
      base.contentH <= base.viewH + 1,
      'the collapsed library fits without scrolling',
      `content ${base.contentH}px in a ${base.viewH}px panel`
    );

    // --- 2. clicking a heading does not take the panel down --------------
    await page.locator('details summary').first().click();
    await page.waitForTimeout(300);
    const opened = await state(page);
    check(
      opened.sections === base.sections && opened.searchBoxPresent,
      'clicking a heading leaves the panel standing',
      `sections ${base.sections} -> ${opened.sections}, search box ${opened.searchBoxPresent}`
    );
    check(opened.open === 1, 'and opens exactly the section clicked', `${opened.open} open`);
    check(
      opened.revealed > base.revealed,
      'which reveals its pedals',
      `${base.revealed} -> ${opened.revealed} pedal rows (content ${base.contentH} -> ${opened.contentH}px)`
    );
    check(
      opened.firstChevronRotate !== base.firstChevronRotate,
      'the chevron turns to show the state',
      `rotate ${base.firstChevronRotate} -> ${opened.firstChevronRotate}`
    );

    // --- 3. a search must never answer with shut headers ------------------
    await page.fill(SEARCH, 'timeline');
    await page.waitForTimeout(400);
    const searched = await state(page);
    check(
      searched.sections > 0 && searched.open === searched.sections,
      'a search opens everything it matched',
      `${searched.open} of ${searched.sections} sections open`
    );

    await page.fill(SEARCH, '');
    await page.waitForTimeout(400);
    const cleared = await state(page);
    check(
      cleared.sections === base.sections && cleared.open === 0,
      'clearing the search collapses back down',
      `${cleared.open} of ${cleared.sections} open`
    );

    // The specific regression the override-clearing exists for: a section the
    // user shut by hand must not stay shut through a search that matches it.
    await page.locator('details summary').first().click();
    await page.waitForTimeout(200);
    await page.locator('details summary').first().click();
    await page.waitForTimeout(200);
    await page.fill(SEARCH, 'boss');
    await page.waitForTimeout(400);
    const afterManual = await state(page);
    check(
      afterManual.open === afterManual.sections,
      'a hand-collapsed section still opens for a search that matches it',
      `${afterManual.open} of ${afterManual.sections} open`
    );

    check(
      pageErrors.length === 0,
      'no uncaught errors while driving the panel',
      pageErrors.join(' | ') || 'none'
    );
  } catch (err) {
    check(false, 'gate ran to completion', err.message);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
