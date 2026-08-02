#!/usr/bin/env node
/**
 * Are all the editor's right-panel tabs reachable, at every width?
 *
 * Adding a fifth tab (Power) pushed the last one - Props - off the end of the
 * strip at every viewport: it needed 316px in a panel 256px wide at lg and
 * 288px at xl. `overflow-x-auto` made it technically scrollable, but a
 * scrollbar nobody can see on a tab strip is the same as a missing tab.
 *
 * Asserts on geometry rather than a screenshot: every tab's box must sit
 * inside the tablist's box, horizontally AND vertically. The vertical half
 * matters because TabsTrigger's default height is a percentage of the LIST's
 * height, which is circular once the list wraps - the tabs then render taller
 * than the container that is supposed to hold them.
 *
 * Usage: node .claude/scripts/verify-panel-tabs.js
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { loadEnv, login, openEditor } = require('./lib/twin');
loadEnv();

const WIDTHS = [1024, 1280, 1440, 1920];

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
        await page.waitForTimeout(700);
        const info = await page.evaluate(() => {
          const list = document.querySelector('[role="tablist"]');
          if (!list) return null;
          const lr = list.getBoundingClientRect();
          const tabs = [...list.querySelectorAll('[role="tab"]')].map((t) => {
            const r = t.getBoundingClientRect();
            return {
              label: t.textContent.trim(),
              inside: r.right <= lr.right + 0.5 && r.left >= lr.left - 0.5 &&
                      r.bottom <= lr.bottom + 0.5 && r.top >= lr.top - 0.5,
            };
          });
          return {
            rows: new Set([...list.querySelectorAll('[role="tab"]')]
              .map((t) => Math.round(t.getBoundingClientRect().top))).size,
            overflows: list.scrollWidth > list.clientWidth + 1,
            tabs,
          };
        });
        if (!info) { console.log(`  SKIP  ${width}px - panel not rendered`); continue; }
        const escaped = info.tabs.filter((t) => !t.inside).map((t) => t.label);
        const ok = escaped.length === 0 && !info.overflows;
        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(width).padStart(4)}px: ` +
          `${info.tabs.length} tabs on ${info.rows} row(s)` +
          (escaped.length ? ` - OUTSIDE THE STRIP: ${escaped.join(', ')}` : '') +
          (info.overflows ? ' - strip overflows' : ''));
        if (!ok) fail++;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : fail + ' WIDTH(S) FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
