#!/usr/bin/env node
/**
 * Delete / Backspace removes the selected pedal.
 *
 * Four things, because each fails independently:
 *   1. Delete removes the SELECTED pedal (and only that one)
 *   2. Cmd+Z brings it back - the shortcut must go through removePedal,
 *      which records history, not through a direct state write
 *   3. Backspace does the same, because Mac laptops have no Delete key
 *   4. Neither key fires while typing in a text field, and neither
 *      navigates the browser Back - losing an unsaved board to a stray
 *      Backspace is worse than any delete
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-delete-key.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, BASE_URL } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const names = (page) =>
  page.evaluate(() => window.__getPedalSchemaSnapshot().pedals.map((p) => p.name).sort());

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

    const before = await names(page);
    console.log(`editor: ${BASE_URL}${href}  (${before.length} pedals)\n`);

    // Select the first pedal through the real selection action.
    const picked = await page.evaluate(() => {
      const snap = window.__getPedalSchemaSnapshot();
      const target = snap.pedals[0];
      window.__pedalSchemaSelect(target.id);
      return target.name;
    });

    // --- 1. Delete removes it -------------------------------------------
    await page.keyboard.press('Delete');
    const afterDelete = await names(page);
    check(
      afterDelete.length === before.length - 1,
      `Delete removed one pedal (${before.length} -> ${afterDelete.length})`,
      `removed: ${picked}`
    );
    check(
      !afterDelete.includes(picked) || before.filter((n) => n === picked).length > 1,
      'and it removed the SELECTED one'
    );

    // --- 2. Undo brings it back -----------------------------------------
    await page.keyboard.press('Control+z');
    const afterUndo = await names(page);
    check(
      afterUndo.length === before.length,
      `Cmd/Ctrl+Z restored it (${afterUndo.length} pedals)`,
      'proves the shortcut goes through removePedal, which records history'
    );

    // --- 3. Backspace does the same -------------------------------------
    await page.evaluate(() => {
      const snap = window.__getPedalSchemaSnapshot();
      window.__pedalSchemaSelect(snap.pedals[0].id);
    });
    await page.keyboard.press('Backspace');
    const afterBackspace = await names(page);
    check(
      afterBackspace.length === before.length - 1,
      `Backspace removed one pedal (${afterBackspace.length} pedals)`,
      'Mac laptops have no Delete key'
    );
    check(
      page.url().includes('/editor/'),
      'and Backspace did NOT navigate the browser Back',
      page.url()
    );
    await page.keyboard.press('Control+z');

    // --- 4. Not while typing --------------------------------------------
    const restored = await names(page);
    await page.evaluate(() => {
      const snap = window.__getPedalSchemaSnapshot();
      window.__pedalSchemaSelect(snap.pedals[0].id);
    });
    const input = page.locator('input[type="text"]:visible, input:not([type]):visible').first();
    if (await input.count()) {
      await input.click();
      await input.press('Backspace');
      await input.press('Delete');
      const afterTyping = await names(page);
      check(
        afterTyping.length === restored.length,
        'neither key deletes a pedal while typing in a text field',
        `${restored.length} pedals before and after`
      );
    } else {
      console.log('  SKIP  no visible text input on this page to test the guard');
    }

    // Nothing was saved.
    const dirty = await page.evaluate(() => window.__getPedalSchemaSnapshot().isDirty);
    console.log(`\nisDirty=${dirty} (this script never saves)`);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
