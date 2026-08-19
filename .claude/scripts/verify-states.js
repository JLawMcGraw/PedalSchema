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

    // --- the skeleton actually renders -------------------------------------
    console.log('\n=== a skeleton is on screen while the page is still loading ===');

    // HOW THIS REPRODUCES, after two approaches that did not:
    //
    // Holding the RSC request with page.route() renders nothing at all. The
    // App Router ships loading.tsx AS PART OF that payload, and Next does not
    // prefetch in dev - block the request and the navigation simply stalls on
    // the old page.
    //
    // A fresh navigation is the real thing. The server streams the shell and
    // the loading fallback first, then replaces it when the Supabase query
    // returns, so the skeleton is genuinely on screen for the length of that
    // round trip. `waitUntil: 'commit'` returns as soon as the response starts
    // rather than when it finishes, which is what makes the window catchable.
    const nav = page.goto(BASE + '/pedals', { waitUntil: 'commit' });

    let skeletons = 0;
    let which = { label: null, url: null };
    let shape = { inAGrid: false, inGrid: 0, gridCols: 0 };
    try {
      await page.locator('[data-slot="skeleton"]').first().waitFor({ timeout: 10000 });
      skeletons = await page.locator('[data-slot="skeleton"]').count();
      which = await page.evaluate(() => {
        const el = document.querySelector('[role="status"][aria-busy="true"]');
        return { label: el ? el.getAttribute('aria-label') : null, url: location.pathname };
      });
      shape = await page.evaluate(() => {
        // The grid holding the MOST placeholders. `closest('.grid')` alone is
        // not enough: shadcn's own CardHeader is a grid, so the nearest one is
        // a two-line header inside a single card, not the card grid.
        const all = [...document.querySelectorAll('[data-slot="skeleton"]')];
        const candidates = new Set();
        for (const el of all) {
          const g = el.closest('.grid');
          if (g) candidates.add(g);
        }
        let grid = null;
        let best = 0;
        for (const g of candidates) {
          const total = g.querySelectorAll('[data-slot="skeleton"]').length;
          if (total > best) {
            best = total;
            grid = g;
          }
        }
        return {
          inAGrid: !!grid,
          inGrid: best,
          gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        };
      });
    } catch {
      /* reported by the checks below, with the numbers */
    }

    check(skeletons > 0, `a skeleton was on screen mid-load (${skeletons} placeholders)`);

    // WHICH skeleton, not just "a" skeleton. Each route labels its own, and a
    // count alone cannot tell you another route's placeholder is showing - an
    // earlier version of this gate clicked while the DASHBOARD was still
    // loading, caught its skeleton, and then compared that page's 3-column
    // grid against the pedals page's 4.
    check(
      which.label === 'Loading pedals',
      "it is the PEDALS skeleton, not another route's",
      `aria-label: ${which.label} | url at the time: ${which.url}`
    );

    // A skeleton is a loading announcement, not decoration: a screen reader
    // gets nothing from a grid of empty grey boxes unless something says busy.
    check(!!which.label, 'the skeleton announces itself as busy to a screen reader');

    check(
      shape.inAGrid && shape.gridCols >= 2,
      'the card placeholders sit in a real card grid ' +
        `(${shape.inGrid} placeholders across ${shape.gridCols} columns)`
    );

    await nav;
    await page
      .locator('a[href^="/pedals/"]:not([href="/pedals/new"])')
      .first()
      .waitFor({ timeout: 20000 });

    // THE ACTUAL PROMISE OF A SKELETON: the layout does not jump when the data
    // lands. Matching column counts is what makes that true, and it is the
    // only reason to prefer this over a spinner.
    const realCols = await page.evaluate(() => {
      // Not [href^="/pedals/"] alone: that also matches the "Add Custom Pedal"
      // button, which sits in the header and has no grid above it.
      const card = document.querySelector('a[href^="/pedals/"]:not([href="/pedals/new"])');
      const grid = card && card.closest('.grid');
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    });
    check(
      realCols === shape.gridCols,
      'the real grid has the same column count as the skeleton did ' +
        `(${realCols} vs ${shape.gridCols})`
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
