#!/usr/bin/env node
/**
 * Does any page ship a full-resolution original straight out of the bucket?
 *
 * On 2026-08-21 Supabase reported 40.78 GB of CACHED egress against a 5.5 GB
 * allowance, with three days before the Fair Use Policy stopped the projects.
 * The previous session had already cured the DATABASE side - 167 KB of
 * catalogue per editor load - and that was the wrong half. Cached egress is
 * the CDN in front of STORAGE, and the bucket held 85 objects totalling
 * 77.56 MB, the largest a 7.42 MB PNG of an amp. Every one was served to the
 * browser at full size by a raw `<img>` and painted into a box 144px tall.
 *
 * Measured before the fix:
 *
 *     /pedals                25,967 KB from the storage host, 40 requests
 *     /editor/<id>           12,132 KB from the storage host, 21 requests
 *
 * After: zero, on both. The originals now go through Next's optimiser, which
 * fetches each one once per (src, width) and serves a WebP derivative - the
 * largest is 61 KB where the PNG behind it is 2,755 KB.
 *
 * THIS GATE EXISTS BECAUSE THE REGRESSION IS INVISIBLE. Add one `<img
 * src={row.image_url}>` and every page still looks perfect, every test still
 * passes, and the bill moves. The only symptom is an email.
 *
 * Read-only. Loads pages and counts bytes; writes nothing.
 *
 * Usage: node .claude/scripts/verify-image-egress.js
 */
const { chromium } = require('playwright');
const { loadEnv, login } = require('./lib/twin');

loadEnv();

const BASE = process.env.BASE_URL || 'http://localhost:3000';

/**
 * A little headroom, not a licence.
 *
 * Zero is the right number and what the app measures today, but a gate that
 * fails on a single stray byte fails on things that are not this defect - a
 * favicon, a redirect probe. One 60 KB derivative is the smallest real
 * regression this can see, so the threshold sits comfortably under it.
 */
const BUDGET_KB = 40;

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  let storageHost = null;
  try {
    storageHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    console.error('NEXT_PUBLIC_SUPABASE_URL is not a URL; cannot identify the storage host');
    process.exit(1);
  }
  console.log(`storage host: ${storageHost}\n`);

  let bytes = 0;
  let requests = [];
  page.on('response', async (res) => {
    let url;
    try {
      url = new URL(res.url());
    } catch {
      return;
    }
    if (url.host !== storageHost) return;
    const len = Number(res.headers()['content-length'] || 0);
    let size = len;
    if (!size) {
      try {
        size = (await res.body()).length;
      } catch {
        size = 0;
      }
    }
    bytes += size;
    requests.push(`${(size / 1024).toFixed(1)} KB ${url.pathname.slice(0, 80)}`);
  });

  try {
    await login(page);

    // Every page that renders gear photos. The editor is the one that matters
    // most - it is opened over and over during a session, by people and by
    // this very suite.
    const dashboardHref = await (async () => {
      await page.goto(`${BASE}/dashboard`);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      return page
        .locator('a[href^="/editor/"]:not([href="/editor/new"])')
        .first()
        .getAttribute('href');
    })();

    const targets = ['/pedals', '/amps', '/boards'];
    if (dashboardHref) targets.push(dashboardHref);

    for (const target of targets) {
      bytes = 0;
      requests = [];
      await page.goto(`${BASE}${target}`);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      // Scroll the whole page: the images are lazy, so a gate that never
      // scrolls proves only that the top of the page is clean.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      await page.waitForTimeout(2500);

      check(
        bytes / 1024 <= BUDGET_KB,
        `${target} pulls nothing from the bucket`,
        `${(bytes / 1024).toFixed(1)} KB in ${requests.length} request(s)` +
          (requests.length ? `\n        ${requests.slice(0, 4).join('\n        ')}` : '')
      );
    }

    // And the images are actually THERE. A page that renders no images at all
    // would sail through the check above, which would be the worst possible
    // way to pass it.
    await page.goto(`${BASE}/pedals`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    await page.waitForTimeout(2500);
    const imgs = await page.evaluate(() =>
      [...document.querySelectorAll('img')].map((i) => ({
        optimised: (i.currentSrc || i.src).includes('/_next/image'),
        decoded: i.naturalWidth > 0,
        width: i.naturalWidth,
      }))
    );
    check(imgs.length > 0, `/pedals renders gear photos at all`, `${imgs.length} <img> elements`);
    check(
      imgs.every((i) => i.decoded),
      'every one of them decoded',
      `${imgs.filter((i) => i.decoded).length}/${imgs.length}`
    );
    check(
      imgs.every((i) => i.optimised),
      'every one of them came through the optimiser',
      `${imgs.filter((i) => i.optimised).length}/${imgs.length}`
    );
    // A derivative, not the original. The originals are 1000-3000px wide.
    const widest = Math.max(...imgs.map((i) => i.width));
    check(
      widest <= 700,
      'and is a derivative, not the original',
      `widest decoded image: ${widest}px`
    );

    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  } catch (err) {
    console.error(err);
    failures++;
  } finally {
    await browser.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})();
