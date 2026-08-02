#!/usr/bin/env node
/**
 * Find the product photograph on a manufacturer page, using a real browser.
 *
 * The pedal mirror reads og:image out of raw HTML, which is enough for the
 * hosts it deals with. The amp and board makers are not so cooperative, and
 * they fail in three different ways:
 *
 *   - fender.com and evhgear.com answer a plain fetch with 403. Not a bot
 *     policy we can argue with from curl; a real browser gets the page.
 *   - voxamps.com serves the gallery from JS, so the static HTML contains
 *     only the shared navigation menu. That is worth spelling out because it
 *     is silently wrong rather than loudly wrong: four different Vox product
 *     pages return the SAME list of image URLs, and any of them would have
 *     been mirrored as "the AC30" without complaint.
 *   - marshall.com's archive section is a Mobify SPA whose og:image is the
 *     Marshall logo.
 *
 * So: open the page, wait for the network to settle, and report what is
 * actually rendered - with each candidate's natural size and on-screen area,
 * because the biggest rendered image is nearly always the hero and the small
 * ones are nav thumbnails.
 *
 * This REPORTS, it does not choose. Picking is done by a human reading the
 * output, because the failure that matters here is not a broken URL - it is a
 * plausible URL for the wrong object. Two already found this way:
 *   - voxamps.com/product/ac30c2/ 302s to the AC30C2 *canvas cover* page, so
 *     the "AC30" photo is a photo of a bag.
 *   - Pedaltrain's first product image is a composite of board AND gig bag.
 * Neither is detectable from the URL, and both look fine until you look.
 *
 * Usage:
 *   node scraper/resolve-gear-image.js <url> [<url> ...]
 *   node scraper/resolve-gear-image.js --json <url>     # machine-readable
 */
const { chromium } = require('playwright');

const JSON_OUT = process.argv.includes('--json');
const URLS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Nav chrome, social icons and spacers that rank high on count but never on area. */
const JUNK = /logo|favicon|sprite|icon|placeholder|spacer|badge|flag|payment|1x1|blank/i;

async function resolve(page, url) {
  const out = { requested: url, finalUrl: null, title: null, og: null, candidates: [] };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    out.error = String(err.message ?? err).split('\n')[0];
    return out;
  }
  // Galleries hydrate late; settle the network but don't fail the page if a
  // tracker keeps a socket open forever.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // Lazy loaders key off scroll position, so nudge the page.
  await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
  await page.waitForTimeout(1500);

  out.finalUrl = page.url();
  out.title = await page.title().catch(() => null);
  out.og = await page
    .locator('meta[property="og:image"]')
    .first()
    .getAttribute('content')
    .catch(() => null);

  out.candidates = await page.evaluate(() => {
    const seen = new Map();
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      const r = img.getBoundingClientRect();
      const rec = {
        src: src.split('?')[0],
        natural: [img.naturalWidth, img.naturalHeight],
        rendered: Math.round(r.width * r.height),
        alt: (img.alt || '').slice(0, 80),
      };
      const prev = seen.get(rec.src);
      if (!prev || rec.rendered > prev.rendered) seen.set(rec.src, rec);
    }
    return [...seen.values()];
  });

  out.candidates = out.candidates
    .filter((c) => !JUNK.test(c.src))
    .filter((c) => c.natural[0] >= 200 && c.natural[1] >= 200)
    .sort((a, b) => b.natural[0] * b.natural[1] - a.natural[0] * a.natural[1]);

  return out;
}

(async () => {
  const browser = await chromium.launch();
  // A default Playwright context still announces HeadlessChrome; Fender's edge
  // rejects that. A stock UA string plus a real viewport is enough.
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  const results = [];
  for (const url of URLS) {
    const r = await resolve(page, url);
    results.push(r);
    if (JSON_OUT) continue;
    console.log(`\n=== ${url}`);
    if (r.error) {
      console.log(`    ERROR ${r.error}`);
      continue;
    }
    if (r.finalUrl !== url) console.log(`    REDIRECTED -> ${r.finalUrl}`);
    console.log(`    title: ${r.title}`);
    console.log(`    og:image: ${r.og ?? '<none>'}`);
    for (const c of r.candidates.slice(0, 8)) {
      console.log(`    ${String(c.natural[0]).padStart(5)}x${String(c.natural[1]).padEnd(5)} ${c.src}`);
      if (c.alt) console.log(`          alt: ${c.alt}`);
    }
  }
  if (JSON_OUT) console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
