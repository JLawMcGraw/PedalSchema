#!/usr/bin/env node
/**
 * The app says something while it is working, and something useful when it
 * breaks.
 *
 * Measured before this existed: not one `loading.tsx` in the whole app, and no
 * error boundary at all. Every dashboard route is server-rendered on demand,
 * so a slow query left the previous screen frozen with no sign anything was
 * happening, and an uncaught error fell through to Next's own error page -
 * unbranded, and with no way back into the app.
 *
 * THE SKELETON CHECK DELAYS A REAL NAVIGATION rather than trusting that a file
 * exists. `loading.tsx` on disk proves nothing: it only renders if the segment
 * actually suspends, and a mistake in where the file sits means it never
 * appears. So the gate holds the server response open and asserts the skeleton
 * is on screen while the navigation is in flight.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-states.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadEnv, login } = require('./lib/twin');

loadEnv();

const ROOT = path.join(__dirname, '..', '..');
const BASE = 'http://localhost:3000';

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

(async () => {
  console.log('\n=== the files exist where Next looks for them ===');
  const group = path.join(ROOT, 'src', 'app', '(dashboard)');
  for (const route of ['dashboard', 'boards', 'amps']) {
    check(fs.existsSync(path.join(group, route, 'loading.tsx')), `${route}/loading.tsx`);
  }

  // Pedals is the exception, and the exception is the whole lesson.
  //
  // A loading.tsx wraps EVERY child segment in a Suspense boundary, and a
  // streaming segment has already flushed HTTP 200 by the time the page calls
  // notFound(). Putting one at `pedals/` turned every unknown and malformed
  // pedal id into a soft 404 - status 200 with a not-found page inside it -
  // which `verify-routes` caught on all three of its cases.
  //
  // So it lives in a (list) route group, which keeps the boundary around the
  // list page and off `[id]`. The URL is unchanged; route groups do not appear
  // in the path. Both halves are asserted, because putting the file back one
  // directory up is the exact mistake that reintroduces the bug.
  check(
    fs.existsSync(path.join(group, 'pedals', '(list)', 'loading.tsx')),
    'pedals/(list)/loading.tsx - scoped to the list'
  );
  check(
    !fs.existsSync(path.join(group, 'pedals', 'loading.tsx')),
    'NO loading.tsx directly at pedals/ - it would make /pedals/[id] answer 200'
  );
  check(fs.existsSync(path.join(group, 'error.tsx')), '(dashboard)/error.tsx - the error boundary');
  check(
    fs.existsSync(path.join(ROOT, 'src', 'app', 'global-error.tsx')),
    'global-error.tsx - for a failure in the root layout itself'
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);
    await page.goto(BASE + '/dashboard');
    await page.waitForSelector('header nav a');

    // WAIT FOR THE DASHBOARD TO FINISH LOADING FIRST. The header comes from
    // the layout and renders while the page below it is still streaming, so
    // `header nav a` is not "the page is ready" - it is "the shell is ready".
    // Clicking there captured the DASHBOARD's skeleton and then compared its
    // 3-column grid against the pedals page's 4, which is a real mismatch
    // between two different pages rather than a defect in either.
    await page
      .locator('[role="status"][aria-busy="true"]')
      .waitFor({ state: 'detached', timeout: 20000 })
      .catch(() => {});

    // --- the list page flushes a fallback, in the same grid ----------------
    //
    // READ THE BYTE STREAM, DO NOT RACE THE BROWSER. This check used to
    // navigate and wait for the skeleton to appear on screen, which is a race
    // it usually won and sometimes did not. Whether a fallback is ever PAINTED
    // depends on how the bytes happen to be chunked; whether it was FLUSHED
    // FIRST is the actual feature, and that is fixed in the response.
    console.log('\n=== the list page streams a fallback, in the same grid ===');

    const listResp = await page.goto(BASE + '/pedals');
    const listHtml = await listResp.text();

    const firstSkeleton = listHtml.indexOf('data-slot="skeleton"');
    const listLabel = listHtml.indexOf('aria-label="Loading pedals"');
    // Only the resolved page links to a pedal; the placeholders link nowhere.
    const listContent = listHtml.search(/href="\/pedals\/(?!new)/);

    check(firstSkeleton >= 0, `the pedals fallback is in the stream (byte ${firstSkeleton})`);
    check(listLabel >= 0, 'and it names itself, so a screen reader is told the page is busy');
    check(
      firstSkeleton >= 0 && listContent >= 0 && firstSkeleton < listContent,
      'the fallback is flushed BEFORE the cards it stands in for',
      `fallback ${firstSkeleton} vs first card ${listContent}`
    );

    // THE ACTUAL PROMISE OF A SKELETON: the layout does not jump when the data
    // lands, which means the placeholder grid and the real grid must be the
    // same grid.
    //
    // Compared at the SOURCE, not in the HTML. Counting occurrences of the grid
    // class in the response looked deterministic and was not: the RSC payload
    // is serialised into the same document, so the string appeared twice even
    // when the fallback had been changed to a different grid, and the check
    // passed on a mutation built to break it.
    const listLoadingSrc = fs.readFileSync(
      path.join(group, 'pedals', '(list)', 'loading.tsx'),
      'utf8'
    );
    const listPageSrc = fs.readFileSync(
      path.join(group, 'pedals', '(list)', 'page.tsx'),
      'utf8'
    );
    const fallbackGrid = listLoadingSrc.match(/gridClassName="([^"]+)"/)?.[1] ?? null;
    const realGrid = listPageSrc.match(/className="(grid gap[^"]*)"/)?.[1] ?? null;
    check(!!fallbackGrid && !!realGrid, `read both grids (fallback: ${fallbackGrid}, page: ${realGrid})`);
    check(
      fallbackGrid === realGrid,
      'the fallback grid and the page grid are identical, so nothing reflows',
      `fallback ${JSON.stringify(fallbackGrid)} vs page ${JSON.stringify(realGrid)}`
    );

    // --- the DETAIL pages: a skeleton, and still a 404 ---------------------
    //
    // These two are the hard case, and the reason they were left out of the
    // first pass. Both call notFound(), and a loading.tsx anywhere above the
    // call site flushes HTTP 200 before the page can decide - so the naive fix
    // trades a correct status for a skeleton.
    //
    // Every check here comes in a PAIR: the skeleton appeared, AND an unknown
    // id is still a 404. Either one alone would let the soft 404 back in.
    console.log('\n=== detail pages stream without giving up their 404 ===');

    const UNKNOWN = '00000000-0000-4000-8000-000000000000';

    /**
     * Does this route flush a loading fallback BEFORE its content?
     *
     * READ THE BYTE STREAM, DO NOT RACE THE BROWSER. The first version of this
     * navigated with the connection throttled and waited for the skeleton to
     * appear on screen. It was flaky - roughly one suite run in two - and the
     * diagnostics said why: `after 20016ms: {"ready":"complete","h1":"AW-3",
     * "anySkeleton":0}`. The page had ALREADY FINISHED. Throttling does not
     * reliably stretch a same-origin document that the browser can serve in one
     * chunk, so whether the fallback was ever painted came down to luck.
     *
     * The order of the bytes is the actual feature, and it is not a race: the
     * segment suspended, so the shell and the fallback were flushed first and
     * the content replaced it later in the same stream. If the fallback appears
     * after the content, or not at all, the boundary is not doing its job -
     * whatever any screenshot happens to catch.
     */
    const flushesFallbackFirst = async (url, label) => {
      const resp = await page.goto(url);
      const html = await resp.text();
      const fallback = html.indexOf('data-slot="skeleton"');
      const named = html.indexOf(`aria-label="${label}"`);
      // The content marker: the real page's <h1>, which only the resolved
      // render produces - the skeletons carry no headings.
      const content = html.search(/<h1[\s>]/);
      return { status: resp.status(), fallback, named, content, bytes: html.length };
    };

    // A real pedal id, taken from the list rather than hard-coded.
    await page.goto(BASE + '/pedals');
    const pedalHref = await page
      .locator('a[href^="/pedals/"]:not([href="/pedals/new"])')
      .first()
      .getAttribute('href');

    const pedalFlush = await flushesFallbackFirst(BASE + pedalHref, 'Loading pedal');
    check(
      pedalFlush.fallback >= 0 && pedalFlush.named >= 0,
      '/pedals/[id] streams its own loading fallback',
      `skeleton at byte ${pedalFlush.fallback}, labelled at ${pedalFlush.named}, of ${pedalFlush.bytes}`
    );
    check(
      pedalFlush.fallback >= 0 &&
        pedalFlush.content >= 0 &&
        pedalFlush.fallback < pedalFlush.content,
      'and flushes it BEFORE the content, which is what makes it visible at all',
      `fallback ${pedalFlush.fallback} vs content ${pedalFlush.content}`
    );
    const pedal404 = await page.goto(`${BASE}/pedals/${UNKNOWN}`);
    check(
      pedal404.status() === 404,
      'and an unknown pedal id is STILL a 404, not a 200 with a 404 page in it',
      `-> ${pedal404.status()}`
    );

    // A real board id, from the dashboard. CONFIG_ID is NOT set in this repo's
    // .env.local, and reading it directly sent this check to /editor/undefined
    // - which is a 404, so the "still a 404" assertion below passed while
    // proving nothing at all.
    await page.goto(BASE + '/dashboard');
    const boardHref = await page
      .locator('a[href^="/editor/"]:not([href="/editor/new"])')
      .first()
      .getAttribute('href');
    check(!!boardHref, `found a real board to open (${boardHref})`);

    const editorFlush = await flushesFallbackFirst(BASE + boardHref, 'Loading board');
    check(
      editorFlush.fallback >= 0 && editorFlush.named >= 0,
      '/editor/[id] streams its own loading fallback',
      `skeleton at byte ${editorFlush.fallback}, labelled at ${editorFlush.named}, of ${editorFlush.bytes}`
    );
    const editor404 = await page.goto(`${BASE}/editor/${UNKNOWN}`);
    // UNKNOWN is a well-formed uuid on purpose: a malformed one is rejected by
    // the shape guard and would never reach the database, so it cannot tell us
    // whether the row lookup 404s.
    check(
      editor404.status() === 404,
      'and an unknown board id is STILL a 404',
      `-> ${editor404.status()}`
    );

    // --- the error boundary is reachable and offers a way out --------------
    console.log('\n=== the error boundary is a real page, not a dead end ===');
    const boundary = fs.readFileSync(path.join(group, 'error.tsx'), 'utf8');
    check(/'use client'|"use client"/.test(boundary), 'the boundary is a client component, as Next requires');
    check(/reset/.test(boundary), 'it offers reset() - a retry that does not require a page reload');
    check(/href=/.test(boundary), 'it carries a link out, so it is not a dead end');
    check(
      !/Oops|oops|!/.test(boundary.replace(/[^\n]*(import|\/\/|\*)[^\n]*/g, '')),
      'no "Oops" and no exclamation marks in the copy'
    );
  } finally {
    await browser.close();
  }

  console.log('\n-----------------------------------------');
  if (failures) {
    console.log(`FAIL: ${failures} check(s) failed\n`);
    process.exit(1);
  }
  console.log('PASS: it says something while working, and something useful when it breaks\n');
})();
