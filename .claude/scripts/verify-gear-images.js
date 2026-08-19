#!/usr/bin/env node
/**
 * Do the amp and board library cards actually SHOW their photos?
 *
 * "The row has an image_url" and "the card shows a picture" are different
 * claims, and only the second is what was asked for. Between them sit a
 * dozen ways to fail silently: the column not selected by the query, a 404
 * from storage, a bucket that is not public, an <img> that renders at zero
 * height inside a flex container, or an image whose intrinsic size is 0
 * because it never decoded.
 *
 * So this asserts on the rendered DOM, per card:
 *   - an <img> exists,
 *   - it points at OUR storage host (not a hotlink to the manufacturer),
 *   - naturalWidth > 0, i.e. the bytes actually decoded in the browser,
 *   - its painted box is non-empty and sits inside the card.
 *
 * naturalWidth is the load-bearing check. A broken <img> still has a
 * bounding box and still passes a screenshot glance; it reports
 * naturalWidth === 0.
 *
 * Rows with no image (Marshall JCM2000 DSL, deliberately - see
 * scraper/mirror-gear-images.js UNSOURCED) must render a card with NO <img>
 * rather than a broken one, so those are asserted too.
 *
 * Usage: node .claude/scripts/verify-gear-images.js
 *   (needs the dev server on BASE_URL and VERIFY_EMAIL/PASSWORD in .env.local)
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login } = require('./lib/twin');
loadEnv();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUR_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;

/** Cards with no photo, by the title text shown on the card. */
const EXPECTED_IMAGELESS = new Set(['JCM2000 DSL']);

async function auditPage(page, route) {
  await page.goto(`${BASE_URL}${route}`);
  /*
   * `networkidle` is a GUESS at readiness, and on these two routes it is a bad
   * one: every card pulls a photo from Supabase storage, so the network is
   * busy for reasons that have nothing to do with whether the grid rendered.
   * It timed out at 30s here on a page that had in fact painted - the same
   * race twin.js:openEditor documents after verify-jack-render lost it.
   *
   * So give it a short budget and let the real condition - the grid, with
   * cards in it - be the judge. The scroll-and-decode below is what actually
   * guarantees the images are loaded.
   */
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(
    () => !!document.querySelector('.grid')?.children.length,
    null,
    { timeout: 30000 }
  );
  // Images are lazy; scroll the whole grid so every card decodes.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      [...document.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : null))
    );
  });
  await page.waitForTimeout(600);

  return page.evaluate(() => {
    // Cards are the grid's direct children
    const grid = document.querySelector('.grid');
    if (!grid) return [];
    return [...grid.children].map((card) => {
      const cr = card.getBoundingClientRect();
      const img = card.querySelector('img');
      const title = card.querySelector('[class*="font-semibold"], h3, [data-slot="card-title"]');
      const base = { name: (title?.textContent ?? card.textContent.slice(0, 24)).trim() };
      if (!img) return { ...base, hasImg: false };
      const ir = img.getBoundingClientRect();
      return {
        ...base,
        hasImg: true,
        src: img.currentSrc || img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        painted: Math.round(ir.width) + 'x' + Math.round(ir.height),
        boxOk: ir.width > 1 && ir.height > 1,
        insideCard:
          ir.left >= cr.left - 0.5 && ir.right <= cr.right + 0.5 &&
          ir.top >= cr.top - 0.5 && ir.bottom <= cr.bottom + 0.5,
      };
    });
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    .then((c) => c.newPage());
  let fail = 0;
  try {
    await login(page);
    for (const route of ['/amps', '/boards']) {
      const cards = await auditPage(page, route);
      console.log(`\n=== ${route}  (${cards.length} cards)`);
      if (!cards.length) { console.log('  NO CARDS FOUND'); fail++; continue; }
      for (const c of cards) {
        const expectNone = [...EXPECTED_IMAGELESS].some((n) => c.name.includes(n));
        if (!c.hasImg) {
          const ok = expectNone;
          if (!ok) fail++;
          console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(24)} no image ${ok ? '(expected)' : '(EXPECTED A PHOTO)'}`);
          continue;
        }
        if (expectNone) {
          fail++;
          console.log(`  FAIL ${c.name.padEnd(24)} has an image but should have none`);
          continue;
        }
        const ours = c.src.includes(OUR_HOST);
        const decoded = c.naturalWidth > 0;
        const ok = ours && decoded && c.boxOk && c.insideCard;
        if (!ok) fail++;
        console.log(
          `  ${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(24)}` +
          ` natural ${c.naturalWidth}x${c.naturalHeight}` +
          `  painted ${c.painted}` +
          `  ours:${ours ? 'y' : 'N'} decoded:${decoded ? 'y' : 'N'}` +
          ` box:${c.boxOk ? 'y' : 'N'} inside:${c.insideCard ? 'y' : 'N'}`
        );
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${fail === 0 ? 'PASS - every card renders as expected' : `FAIL - ${fail} problem(s)`}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
