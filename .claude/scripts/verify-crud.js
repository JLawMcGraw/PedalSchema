#!/usr/bin/env node
/**
 * Naming a board, and deleting one.
 *
 * Both were missing entirely: `setName`/`setDescription` existed in the store
 * and `handleSave` wrote both columns, so a board was permanently called
 * whatever it was called when it was created, and there was no way to get rid
 * of one at all.
 *
 * What this proves, in order:
 *   1. the toolbar title is an inline control, and it opens with the real name
 *   2. Enter commits a rename to the store AND to the visible title
 *   3. Escape abandons the draft
 *   4. an edit that changes nothing does NOT mark the board Unsaved
 *      (the case you cannot see - a false Unsaved badge looks like the
 *      correct behaviour until you read it)
 *   5. a rename SURVIVES a save and a reload - i.e. it reaches the database
 *   6. the description round-trips the same way, from the Board panel
 *   7. a board created through the UI can be deleted through the UI, and the
 *      row is really gone from the dashboard afterwards
 *
 * THIS SCRIPT WRITES. It renames a real configuration and puts the original
 * name back, and it creates and then deletes a throwaway board of its own. It
 * belongs in verify-all.sh's writer list, not the read-only one.
 *
 * Usage: node .claude/scripts/verify-crud.js
 */
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, login, openEditor, waitForCanvas, BASE_URL } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const TITLE = 'button[aria-label="Rename board"]';
const TITLE_INPUT = 'input[aria-label="Board name"]';

const snap = (page) => page.evaluate(() => window.__getPedalSchemaSnapshot());

/** Save through the real button and wait for the dirty flag to clear. */
async function save(page) {
  await page.click('button:has-text("Save")');
  await page.waitForFunction(
    () => {
      const s = window.__getPedalSchemaSnapshot();
      return !s.isDirty || s.saveError;
    },
    null,
    { timeout: 20000 }
  );
  const { saveError } = await snap(page);
  if (saveError) throw new Error(`save failed: ${saveError}`);
}

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1600, height: 1200 } })
    .then((c) => c.newPage());

  let originalName = null;
  let editorUrl = null;

  /*
   * A census, taken before and checked after.
   *
   * This gate deletes a board through the UI, and a delete that hits the
   * wrong row is silent - the gate's own checks would still pass, because
   * they only ever look at the board it created. An empty configuration
   * ("dadfad") went missing from this database during a run of the suite and
   * could not be attributed to any gate afterwards. Counting is cheap; being
   * unable to answer "did we delete something of yours" is not.
   */
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const census = async () => {
    const { data } = await sb.from('configurations').select('id,name').order('id');
    return data ?? [];
  };
  const censusBefore = await census();

  try {
    await login(page);

    // ================= RENAME =================
    editorUrl = await openEditor(page);
    originalName = (await snap(page)).name;
    console.log(`editor:  ${editorUrl}`);
    console.log(`name:    "${originalName}"\n`);

    // --- 1. the title is an inline control, seeded with the real name ----
    const titleCount = await page.locator(TITLE).count();
    check(titleCount === 1, 'toolbar title is a rename control', `found ${titleCount}`);

    await page.click(TITLE);
    const opened = await page.inputValue(TITLE_INPUT);
    check(
      opened === originalName,
      'the editor opens with the current name',
      `input="${opened}"  store="${originalName}"`
    );

    // --- 2. Enter commits, to the store and to the title ------------------
    const renamed = `${originalName} [crud ${Date.now()}]`;
    await page.fill(TITLE_INPUT, renamed);
    await page.keyboard.press('Enter');
    const afterEnter = (await snap(page)).name;
    check(afterEnter === renamed, 'Enter commits the rename to the store', `name="${afterEnter}"`);
    const shownAfter = (await page.textContent(TITLE)).trim();
    check(
      shownAfter === renamed,
      'the visible title shows the new name',
      `title="${shownAfter}"`
    );

    // --- 3. Escape abandons the draft -------------------------------------
    await page.click(TITLE);
    await page.fill(TITLE_INPUT, 'THIS MUST NOT STICK');
    await page.keyboard.press('Escape');
    const afterEscape = (await snap(page)).name;
    check(
      afterEscape === renamed,
      'Escape abandons the draft',
      `name="${afterEscape}" (expected "${renamed}")`
    );

    // --- 5a. save the rename ----------------------------------------------
    await save(page);

    // --- 4. a no-op edit does not dirty the board -------------------------
    // Runs AFTER the save, so isDirty starts false and any change is this
    // edit's doing. Click in, change nothing, click away.
    const cleanBefore = (await snap(page)).isDirty;
    await page.click(TITLE);
    await page.keyboard.press('Enter');
    const dirtyAfterNoop = (await snap(page)).isDirty;
    check(
      cleanBefore === false && dirtyAfterNoop === false,
      'an edit that changes nothing leaves the board clean',
      `isDirty ${cleanBefore} -> ${dirtyAfterNoop}`
    );

    // --- 5b. and it survives a reload, so it reached the database ---------
    await page.goto(editorUrl);
    await waitForCanvas(page);
    const reloaded = (await snap(page)).name;
    check(
      reloaded === renamed,
      'the rename survived a reload - it reached the database',
      `after reload: "${reloaded}"`
    );

    // --- 6. the description round-trips too -------------------------------
    // It lives in the Board panel, which is the Props tab with nothing
    // selected - the description previously had no UI anywhere in the app.
    await page.click('[role="tab"]:has-text("Props")');
    const descBefore = (await snap(page)).description;
    const desc = `crud gate ${Date.now()}`;
    await page.fill('#board-description', desc);
    await page.locator('#board-description').blur();
    check(
      (await snap(page)).description === desc,
      'the description commits on blur',
      `"${desc}"`
    );
    await save(page);
    await page.goto(editorUrl);
    await waitForCanvas(page);
    const descReloaded = (await snap(page)).description;
    check(
      descReloaded === desc,
      'the description survived a reload',
      `after reload: "${descReloaded}"`
    );

    // put the description back
    await page.click('[role="tab"]:has-text("Props")');
    await page.fill('#board-description', descBefore ?? '');
    await page.locator('#board-description').blur();
    if ((await snap(page)).isDirty) await save(page);

    // ================= DELETE =================
    // A board of this gate's own making, so a failure cannot cost real work.
    await page.goto(`${BASE_URL}/editor/new`);
    const created = await createBoard(page);
    check(!!created, 'created a throwaway board to delete', created || 'creation failed');
    if (!created) throw new Error('cannot test delete without a board');

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    const cardBefore = page.locator(`a[href="/editor/${created}"]`);
    check(await cardBefore.count() === 1, 'the new board is on the dashboard');

    // --- the card survives a name it cannot break -----------------------
    // A rename can now produce an 80-character name, and CardHeader is a GRID:
    // its title is a grid item at min-width:auto, so without min-w-0 it grows
    // to max-content and an unbreakable name runs past the card edge and under
    // the menu button. Measured, because it is invisible until it happens.
    const layout = await page.evaluate(() => {
      const art = document.querySelector('article');
      const titleEl = art.querySelector('[data-slot="card-title"]');
      const link = titleEl.querySelector('a');
      const menu = art.querySelector('button[aria-label^="Actions"]');
      link.textContent = 'Supercalifragilistic'.repeat(4);
      const tb = titleEl.getBoundingClientRect();
      const ab = art.getBoundingClientRect();
      const mb = menu.getBoundingClientRect();
      const pr = parseFloat(getComputedStyle(titleEl).paddingRight);
      return {
        textRight: Math.round(tb.right - pr),
        cardRight: Math.round(ab.right),
        menuLeft: Math.round(mb.left),
      };
    });
    check(
      layout.textRight <= layout.cardRight,
      'a long unbreakable name stays inside the card',
      `text right ${layout.textRight}, card right ${layout.cardRight}`
    );
    check(
      layout.textRight <= layout.menuLeft,
      'and clears the actions menu',
      `text right ${layout.textRight}, menu left ${layout.menuLeft} (${layout.menuLeft - layout.textRight}px)`
    );
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Delete it the way a person would: the card's menu, then the confirm.
    await page.locator(`article:has(a[href="/editor/${created}"]) button[aria-label^="Actions"]`).click();
    await page.locator('[role="menuitem"]:has-text("Delete")').click();

    const confirmVisible = await page.locator('button:has-text("Delete board")').count();
    check(confirmVisible === 1, 'the confirm appears on the card itself, not in a modal');
    const dialogs = await page.locator('[role="dialog"], [role="alertdialog"]').count();
    check(dialogs === 0, 'no modal was opened', `role=dialog count: ${dialogs}`);

    await page.locator('button:has-text("Delete board")').click();
    await page.waitForFunction(
      (id) => !document.querySelector(`a[href="/editor/${id}"]`),
      created,
      { timeout: 20000 }
    ).catch(() => {});

    const cardAfter = await page.locator(`a[href="/editor/${created}"]`).count();
    check(cardAfter === 0, 'the card is gone from the dashboard', `remaining: ${cardAfter}`);

    // And really gone, not just unmounted: reload and look again.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const cardAfterReload = await page.locator(`a[href="/editor/${created}"]`).count();
    check(
      cardAfterReload === 0,
      'and still gone after a reload - the row was deleted',
      `remaining: ${cardAfterReload}`
    );

    // The row is gone, so the loader's `notFound()` must fire. Assert the HTTP
    // STATUS, not the absence of the toolbar - a still-loading page and a
    // page that failed for some unrelated reason are both missing a toolbar
    // too, so absence proves nothing on its own.
    const response = await page.goto(`${BASE_URL}/editor/${created}`);
    check(
      response.status() === 404,
      'the deleted board 404s in the editor',
      `GET /editor/${created} -> ${response.status()}`
    );
  } catch (err) {
    check(false, 'gate ran to completion', err.message);
  } finally {
    // Put the real board's name back, whatever happened above.
    if (originalName && editorUrl) {
      try {
        await page.goto(editorUrl);
        await waitForCanvas(page);
        if ((await snap(page)).name !== originalName) {
          await page.click(TITLE);
          await page.fill(TITLE_INPUT, originalName);
          await page.keyboard.press('Enter');
          await save(page);
          const restored = (await snap(page)).name;
          check(restored === originalName, 'restored the original name', `"${restored}"`);
        } else {
          console.log(`  ----  name already "${originalName}", nothing to restore`);
        }
      } catch (err) {
        check(false, 'restored the original name', err.message);
      }
    }

    // Every board that existed before this gate ran must still exist.
    const censusAfter = await census();
    const afterIds = new Set(censusAfter.map((c) => c.id));
    const vanished = censusBefore.filter((c) => !afterIds.has(c.id));
    check(
      vanished.length === 0,
      'no board that existed before this gate ran has gone missing',
      vanished.length
        ? `LOST: ${vanished.map((c) => `${c.id.slice(0, 8)} ${JSON.stringify(c.name)}`).join(', ')}`
        : `${censusBefore.length} boards before, ${censusAfter.length} after`
    );

    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();

/**
 * Create a configuration through /editor/new, the way a person does, and
 * return its id.
 *
 * The board picker is a grid of clickable Cards, not radios or a <select> -
 * so this clicks the first card and then relies on the submit button's own
 * disabled state to tell us the form is complete. Waiting on that rather than
 * on a fixed timeout is what makes it safe to run inside verify-all.sh.
 */
async function createBoard(page) {
  await page.fill('#name', `crud gate throwaway ${Date.now()}`);

  // The picker renders only once its boards have loaded.
  const firstBoard = page.locator('[data-slot="card"]:has([data-slot="card-title"])').first();
  await firstBoard.waitFor({ state: 'visible', timeout: 20000 });
  await firstBoard.click();

  const submit = page.locator('button:has-text("Create Pedalboard")');
  await submit.waitFor({ state: 'visible', timeout: 10000 });
  // Enabled means name + board are both set; clicking before that is a no-op
  // that would look like a creation failure.
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find((el) =>
        el.textContent.includes('Create Pedalboard')
      );
      return b && !b.disabled;
    },
    null,
    { timeout: 10000 }
  );
  await submit.click();

  await page.waitForURL((u) => /\/editor\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 20000 });
  const m = page.url().match(/\/editor\/([0-9a-f-]{36})/);
  return m ? m[1] : null;
}
