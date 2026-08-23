#!/usr/bin/env node
/**
 * Is every right-panel drawer reachable, at every width, with the chain intact?
 *
 * WHAT THIS USED TO CHECK, AND WHY IT CHANGED. The right panel was a five-tab
 * strip, and adding a fifth tab (Power) pushed the last one - Props - off the
 * end at every viewport: it needed 316px in a panel 256px wide at lg and 288px
 * at xl. This gate asserted that every `[role="tab"]` box sat inside the
 * `[role="tablist"]` box, which was the right assertion for that shape.
 *
 * That shape is gone. The chain is now always mounted and the other four
 * panels are collapsed drawers pinned to the bottom, one open at a time, so
 * there is no strip left to overflow and the old assertion cannot fail - it
 * cannot even run. A check that cannot fail is not a check.
 *
 * The equivalent guarantee for the new shape is three things, and the reason
 * each is here is that each is a way the drawers could regress into the same
 * class of bug the strip had - something the user needs, off the bottom of a
 * fixed-height panel:
 *
 *   1. all four drawer headers are present and inside the panel's box;
 *   2. opening one really opens it, and closes the previously open one;
 *   3. the chain SURVIVES an open drawer. This is the direct descendant of the
 *      old check: the failure mode is a drawer expanding to fill the panel and
 *      pushing the chain - the thing the panel is for - to zero height.
 *
 * Asserts on geometry rather than a screenshot, for the same reason as before.
 *
 * Usage: node .claude/scripts/verify-panel-tabs.js
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login, openEditor } = require('./lib/twin');
loadEnv();

const WIDTHS = [1024, 1280, 1440, 1920];
const DRAWERS = ['cables', 'routing', 'power', 'properties'];

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  try {
    for (const width of WIDTHS) {
      const page = await browser.newContext({ viewport: { width, height: 1000 } })
        .then((c) => c.newPage());
      try {
        await login(page);
        await openEditor(page, process.env.CONFIG_ID);
        await page.waitForSelector('[data-panel-tab]', { timeout: 10000 });

        // --- 1. every drawer header is present and inside the panel --------
        const headers = await page.evaluate((ids) => {
          const first = document.querySelector('[data-panel-tab]');
          if (!first) return null;
          // The panel is the scroll/---clip boundary the headers must sit in.
          const panel = first.closest('.flex.h-full.w-full.flex-col') || first.parentElement;
          const pr = panel.getBoundingClientRect();
          return ids.map((id) => {
            const el = document.querySelector(`[data-panel-tab="${id}"]`);
            if (!el) return { id, found: false };
            const r = el.getBoundingClientRect();
            return {
              id,
              found: true,
              inside:
                r.right <= pr.right + 0.5 && r.left >= pr.left - 0.5 &&
                r.bottom <= pr.bottom + 0.5 && r.top >= pr.top - 0.5,
            };
          });
        }, DRAWERS);

        if (!headers) { console.log(`  SKIP  ${width}px - panel not rendered`); continue; }

        const missing = headers.filter((h) => !h.found).map((h) => h.id);
        const escaped = headers.filter((h) => h.found && !h.inside).map((h) => h.id);

        // --- 2 & 3. open each drawer; check exclusivity and the chain ------
        const opened = [];
        for (const id of DRAWERS) {
          await page.locator(`[data-panel-tab="${id}"]`).click();
          await page
            .locator(`[data-panel-tab="${id}"][data-state="active"]`)
            .waitFor({ timeout: 5000 })
            .catch(() => {});
          const state = await page.evaluate((openId) => {
            const active = [...document.querySelectorAll('[data-panel-tab][data-state="active"]')]
              .map((e) => e.getAttribute('data-panel-tab'));
            const body = document.querySelector(`[data-panel-body="${openId}"]`);
            // The chain's own header is the handle for "the chain is still
            // here" - it is the one element in the panel that is never
            // conditional, so a zero height on it is unambiguous.
            const chain = [...document.querySelectorAll('h3')]
              .find((h) => /signal chain/i.test(h.textContent || ''));
            const chainBox = chain ? chain.closest('div').parentElement.getBoundingClientRect() : null;
            return {
              active,
              bodyShown: !!body && body.getBoundingClientRect().height > 0,
              chainHeight: chainBox ? Math.round(chainBox.height) : 0,
            };
          }, id);
          opened.push({ id, ...state });
        }

        const notExclusive = opened.filter((o) => o.active.length !== 1 || o.active[0] !== o.id);
        const notShown = opened.filter((o) => !o.bodyShown);
        const chainCrushed = opened.filter((o) => o.chainHeight < 40);

        const ok =
          missing.length === 0 && escaped.length === 0 &&
          notExclusive.length === 0 && notShown.length === 0 && chainCrushed.length === 0;

        console.log(
          `  ${ok ? 'PASS' : 'FAIL'}  ${String(width).padStart(4)}px: ` +
          `${headers.filter((h) => h.found).length}/${DRAWERS.length} drawers, ` +
          `chain ${Math.min(...opened.map((o) => o.chainHeight))}px at its shortest` +
          (missing.length ? ` - MISSING: ${missing.join(', ')}` : '') +
          (escaped.length ? ` - OUTSIDE THE PANEL: ${escaped.join(', ')}` : '') +
          (notShown.length ? ` - OPENED NOTHING: ${notShown.map((o) => o.id).join(', ')}` : '') +
          (notExclusive.length
            ? ` - NOT EXCLUSIVE: ${notExclusive.map((o) => `${o.id}->[${o.active}]`).join(', ')}`
            : '') +
          (chainCrushed.length
            ? ` - CHAIN CRUSHED BY: ${chainCrushed.map((o) => `${o.id}(${o.chainHeight}px)`).join(', ')}`
            : '')
        );
        if (!ok) fail++;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : fail + ' WIDTH(S) FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
