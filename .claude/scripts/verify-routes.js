#!/usr/bin/env node
/**
 * Every route a user can click actually exists.
 *
 * The audit found three dead ends and all three were measured, not assumed:
 *
 *   /pedals/{id}          did not exist. EVERY pedal card linked to it, so
 *                         every card in the pedal database was a 404
 *   Add Custom Board/Amp  enabled buttons, not inside an anchor, that did
 *                         nothing whatsoever when clicked
 *   dashboard .limit(10)  no paging, so an eleventh board could not be
 *                         reached by any means
 *
 * And the 404 they all landed on was Next's built-in: the text "404 This page
 * could not be found." with ZERO anchors on the page - the only way out was
 * the browser's back button.
 *
 * THIS SCRIPT WRITES. The pagination check seeds throwaway configurations
 * (the account has 3 boards and the pager needs 13 to appear) and deletes
 * exactly the rows it created, in a finally block.
 *
 * Usage: node .claude/scripts/verify-routes.js
 */
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, login, BASE_URL } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const SEED_PREFIX = 'route gate seed';

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 1000 } })
    .then((c) => c.newPage());

  const seeded = [];
  // See the note in verify-crud: this gate also deletes rows, so it counts
  // what was here before and proves it is all still here afterwards. A
  // precaution - no gate has ever been shown to lose a board.
  const census = async () => {
    const { data } = await sb.from('configurations').select('id,name').order('id');
    return data ?? [];
  };
  // SWEEP ANY STALE SEEDS BEFORE THE CENSUS.
  //
  // The finally block below removes what this run creates, but it does not run
  // if the process is killed outright - and it is: piping this script into
  // `head` or `sed` closes stdout and node dies on the write without unwinding.
  // (An EPIPE handler was tried and does NOT prevent that; the finally still
  // never runs.) Eleven throwaway boards were left in the database exactly this
  // way on 2026-08-19.
  //
  // So the gate heals rather than hoping. This has to happen BEFORE the census,
  // or the leftovers are counted as real boards and then deleted, and the gate
  // reports that it lost eleven of the user's boards - which is the single
  // most alarming thing it could say, and it would be wrong.
  const { data: stale } = await sb
    .from('configurations')
    .select('id')
    .like('name', `${SEED_PREFIX}%`);
  if (stale && stale.length) {
    await sb.from('configurations').delete().in('id', stale.map((r) => r.id));
    console.log(`swept ${stale.length} seed row(s) left by an earlier run that was killed`);
  }

  const censusBefore = await census();

  try {
    await login(page);

    // ================= 1. pedal cards resolve =================
    await page.goto(`${BASE_URL}/pedals`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(
      () => !!document.querySelector('a[href^="/pedals/"]'),
      null,
      { timeout: 30000 }
    );
    const hrefs = await page.$$eval(
      'a[href^="/pedals/"]:not([href="/pedals/new"])',
      (as) => as.map((a) => a.getAttribute('href'))
    );
    console.log(`/pedals lists ${hrefs.length} cards\n`);
    check(hrefs.length > 0, 'the pedal list renders cards to click');

    // Sample across the list rather than all 67 - first, middle, last.
    const sample = [hrefs[0], hrefs[Math.floor(hrefs.length / 2)], hrefs[hrefs.length - 1]]
      .filter(Boolean);
    const statuses = [];
    for (const href of sample) {
      const resp = await page.goto(`${BASE_URL}${href}`);
      statuses.push(`${href.slice(8, 16)}=${resp.status()}`);
    }
    check(
      statuses.every((s) => s.endsWith('=200')),
      `sampled pedal cards all resolve (${sample.length} of ${hrefs.length})`,
      statuses.join('  ')
    );

    // ================= 2. the detail page shows real data =================
    const id = sample[0].split('/').pop();
    const { data: row } = await sb
      .from('pedals')
      .select('name, manufacturer, current_ma, width_inches')
      .eq('id', id)
      .single();

    await page.goto(`${BASE_URL}${sample[0]}`);
    const shown = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      text: document.body.innerText.replace(/\s+/g, ' '),
      backHref: document.querySelector('a[href="/pedals"]')?.getAttribute('href') ?? null,
      title: document.title,
    }));
    check(shown.h1 === row.name, 'the detail page names the pedal', `h1="${shown.h1}" row="${row.name}"`);
    check(
      shown.text.includes(row.manufacturer),
      'and its manufacturer',
      row.manufacturer
    );
    check(
      shown.text.includes(String(row.width_inches).replace(/\.0$/, '')),
      'and its real dimensions',
      `width ${row.width_inches}`
    );
    check(shown.backHref === '/pedals', 'the detail page has a way back to the list');
    check(
      shown.title.includes(row.name),
      'and a real document title, not the app default',
      JSON.stringify(shown.title)
    );

    // The three-state draw: null must read as unknown, never as "0 mA".
    const { data: nullDraw } = await sb
      .from('pedals')
      .select('id, name')
      .is('current_ma', null)
      .limit(1)
      .maybeSingle();
    if (nullDraw) {
      await page.goto(`${BASE_URL}/pedals/${nullDraw.id}`);
      const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      check(
        /Unknown/i.test(t) && !/0 mA/.test(t),
        'a pedal with no recorded draw reads Unknown, not 0 mA',
        `${nullDraw.name}: ${/Unknown/i.test(t) ? 'says Unknown' : 'does NOT say Unknown'}`
      );
    } else {
      console.log('  ----  no pedal with a null draw; three-state check skipped');
    }

    // ================= 3. bad ids are 404, not 500 =================
    const malformed = await page.goto(`${BASE_URL}/pedals/not-a-uuid`);
    check(
      malformed.status() === 404,
      'a malformed pedal id is a 404, not a database error',
      `-> ${malformed.status()}`
    );
    const missing = await page.goto(
      `${BASE_URL}/pedals/00000000-0000-4000-8000-000000000000`
    );
    check(missing.status() === 404, 'an unknown pedal id is a 404', `-> ${missing.status()}`);

    // ================= 4. the 404 is not a dead end =================
    // WAIT FOR THE PAGE TO ARRIVE BEFORE COUNTING ITS LINKS. `page.goto()`
    // resolves on the response, and the App Router streams - measured on
    // 2026-08-19, this page had 0 anchors at that moment and 7 a beat later.
    // The check read the empty moment and reported that the 404 was a dead
    // end, which is the single most alarming thing it could say, and it was
    // wrong. It had been passing on timing alone.
    await page.locator('h1').first().waitFor({ timeout: 15000 }).catch(() => {});
    const exits = await page.evaluate(() =>
      [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    );
    check(
      exits.length > 0,
      'the not-found page offers a way out (it used to have zero links)',
      `links: ${JSON.stringify(exits)}`
    );

    // The case above still had the dashboard header above it. An unmatched
    // URL does NOT - it renders outside that layout, so the page's own exits
    // are the only way out. That is the case a stale link lands on.
    const bare = await page.goto(`${BASE_URL}/nonsense`);
    await page.locator('h1').first().waitFor({ timeout: 15000 }).catch(() => {});
    const bareExits = await page.evaluate(() => ({
      status: document.querySelector('h1')?.textContent?.trim(),
      links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      header: !!document.querySelector('header'),
    }));
    check(
      bare.status() === 404 && bareExits.links.length > 0,
      'an unmatched URL gets the same page, with its own way out and no header',
      `-> ${bare.status()}, header=${bareExits.header}, links=${JSON.stringify(bareExits.links)}`
    );

    // ================= 5. no enabled-but-inert buttons =================
    for (const route of ['/boards', '/amps']) {
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const inert = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .filter((b) => !b.disabled && !b.closest('a') && !b.closest('form'))
          .filter((b) => !b.onclick && !b.getAttribute('aria-haspopup') && !b.type.match(/submit/))
          .map((b) => b.textContent.trim())
          .filter((t) => /^Add Custom/.test(t))
      );
      check(
        inert.length === 0,
        `${route} has no enabled button that does nothing`,
        inert.length ? `still inert: ${JSON.stringify(inert)}` : 'Add Custom is disabled and says why'
      );
    }

    // ================= 6. pagination reaches the last board =================
    // The account under test is the one the browser logged in as. Reading
    // user_id off an arbitrary configuration row would seed the wrong account
    // the moment this database holds two users' boards.
    const { data: userList } = await sb.auth.admin.listUsers();
    const me_user = userList.users.find((u) => u.email === process.env.VERIFY_EMAIL);
    if (!me_user) throw new Error(`no auth user for ${process.env.VERIFY_EMAIL}`);
    const { data: me } = await sb
      .from('configurations')
      .select('user_id, board_id')
      .eq('user_id', me_user.id)
      .limit(1)
      .single();
    const { count: existing } = await sb
      .from('configurations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', me.user_id);

    // 13 total is the smallest number that needs a second page at 12 a page.
    const need = Math.max(0, 13 - existing);
    for (let i = 0; i < need; i++) {
      const { data: made, error: insErr } = await sb
        .from('configurations')
        .insert({
          name: `${SEED_PREFIX} ${String(i + 1).padStart(2, '0')}`,
          board_id: me.board_id,
          user_id: me.user_id,
        })
        .select('id')
        .single();
      // The error was previously ignored and `made.id` dereferenced straight
      // away, so a single failed insert became "Cannot read properties of
      // null" from inside the gate - which reads like a broken gate rather
      // than a database that refused a write. It also left the row it HAD
      // written untracked, and therefore uncleaned.
      if (insErr || !made) {
        check(false, `seeding row ${i + 1} failed`, insErr?.message ?? 'insert returned no row');
        break;
      }
      seeded.push(made.id);
    }
    console.log(`\nseeded ${seeded.length} configurations (had ${existing}, need 13)`);

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const p1 = await page.evaluate(() => ({
      cards: document.querySelectorAll('article').length,
      pager: !!document.querySelector('nav[aria-label="Pagination"]'),
      text: document.querySelector('nav[aria-label="Pagination"]')?.innerText.replace(/\s+/g, ' ') ?? '',
      prevDisabled: [...document.querySelectorAll('nav[aria-label="Pagination"] button')]
        .find((b) => /Previous/.test(b.textContent))?.disabled,
    }));
    check(p1.pager, 'the pager appears once there is more than one page', p1.text);
    check(p1.cards === 12, 'page 1 shows a full page of boards', `${p1.cards} cards`);
    check(p1.prevDisabled === true, 'Previous is disabled on page 1, not a link to nowhere');

    await page.goto(`${BASE_URL}/dashboard?page=2`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const p2 = await page.evaluate(() => ({
      cards: document.querySelectorAll('article').length,
      nextDisabled: [...document.querySelectorAll('nav[aria-label="Pagination"] button')]
        .find((b) => /Next/.test(b.textContent))?.disabled,
      text: document.querySelector('nav[aria-label="Pagination"]')?.innerText.replace(/\s+/g, ' ') ?? '',
    }));
    check(
      p2.cards === 1,
      'page 2 reaches the 13th board - the one .limit(10) could never show',
      `${p2.cards} card, "${p2.text}"`
    );
    check(p2.nextDisabled === true, 'Next is disabled on the last page');

    // A page past the end clamps rather than showing an empty grid.
    await page.goto(`${BASE_URL}/dashboard?page=99`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const pN = await page.evaluate(() => document.querySelectorAll('article').length);
    check(pN > 0, 'a page past the end clamps instead of rendering nothing', `${pN} cards`);
  } catch (err) {
    check(false, 'gate ran to completion', err.stack || err.message);
  } finally {
    const censusAfter = await census();
    const afterIds = new Set(censusAfter.map((c) => c.id));
    const vanished = censusBefore.filter((c) => !afterIds.has(c.id));
    check(
      vanished.length === 0,
      'no board that existed before this gate ran has gone missing',
      vanished.length
        ? `LOST: ${vanished.map((c) => `${c.id.slice(0, 8)} ${JSON.stringify(c.name)}`).join(', ')}`
        : `${censusBefore.length} boards before this gate`
    );

    // Delete BY PREFIX, not only by the ids this run tracked.
    //
    // Tracking is not enough: a row can be written and then not recorded - an
    // insert whose `.select()` comes back empty leaves a real row with no id
    // in `seeded`, and it survived the cleanup and failed the next run. The
    // prefix is the gate's own namespace, so sweeping it is exactly as safe as
    // the ids were, and it covers the rows tracking missed.
    if (seeded.length) {
      const { data: mine, error } = await sb
        .from('configurations')
        .delete()
        .like('name', `${SEED_PREFIX}%`)
        .select('id');
      check(
        !error,
        `removed ${mine?.length ?? 0} seeded configuration(s) (${seeded.length} tracked)`,
        error?.message
      );
      const { count: leftovers } = await sb
        .from('configurations')
        .select('id', { count: 'exact', head: true })
        .like('name', `${SEED_PREFIX}%`);
      check(leftovers === 0, 'no seeded rows left behind', `${leftovers} remain`);
    }
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
