#!/usr/bin/env node
/**
 * The header says where you are, and controls answer when pressed.
 *
 * Both halves were missing, and both are the kind of thing that looks fine in
 * a screenshot: every nav link rendered at text-foreground/60 on every route,
 * so the header was decoration rather than navigation, and no control in the
 * app had any pressed state at all - hover only, which on a touch screen means
 * no feedback whatsoever.
 *
 * `aria-current` is the assertion rather than the colour, because the colour is
 * the part that can be restyled later. The colour IS checked too, but as a
 * second question: a marker nobody can see is not a marker.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-nav-state.js
 */
const { chromium } = require('playwright');
const { loadEnv, login } = require('./lib/twin');

loadEnv();

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const BASE = 'http://localhost:3000';

/** The desktop nav's links, with whatever marks the current one. */
const readNav = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('header nav');
    if (!nav) return null;
    return [...nav.querySelectorAll('a')].map((a) => ({
      href: new URL(a.href).pathname,
      text: a.textContent.trim(),
      current: a.getAttribute('aria-current'),
      color: getComputedStyle(a).color,
    }));
  });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);

    for (const [route, expected] of [
      ['/dashboard', 'Dashboard'],
      ['/pedals', 'Pedals'],
      ['/boards', 'Boards'],
    ]) {
      await page.goto(BASE + route);
      await page.waitForSelector('header nav a');
      const links = await readNav(page);

      console.log(`\n=== ${route} ===`);
      check(Array.isArray(links) && links.length >= 4, `the nav rendered (${links?.length} links)`);

      const marked = links.filter((l) => l.current === 'page');
      check(marked.length === 1, `exactly one link is aria-current="page" (found ${marked.length})`);
      check(
        marked[0]?.text === expected,
        `the marked link is "${expected}"`,
        `marked: ${marked.map((m) => m.text).join(', ') || 'none'}`
      );

      // A marker nobody can see is not a marker.
      const others = links.filter((l) => l.current !== 'page').map((l) => l.color);
      check(
        marked[0] && !others.includes(marked[0].color),
        'the current link is visually distinct from the rest',
        `current: ${marked[0]?.color} | others: ${[...new Set(others)].join(', ')}`
      );
    }

    // --- pressed feedback --------------------------------------------------
    console.log('\n=== controls answer when pressed ===');
    await page.goto(BASE + '/dashboard');
    await page.waitForSelector('header nav a');

    // ACTUALLY PRESS IT. The first version of this check scanned the
    // stylesheets for any `:active` rule mentioning scale, and passed on the
    // unstyled app - some vendor keyframe satisfied it. A check that passes
    // before the feature exists is not a check.
    // `:visible` matters: the first button in the header is the mobile menu
    // trigger, which is display:none at this viewport.
    const target = page.locator('header button:visible').first();
    await target.waitFor();
    const box = await target.boundingBox();

    const transformOf = () =>
      target.evaluate((el) => {
        const cs = getComputedStyle(el);
        // BOTH properties. Tailwind v4 compiles `scale-[0.97]` to the
        // standalone `scale` property, not to `transform` - reading only
        // `transform` reported "none" on a control that was visibly shrinking.
        return {
          transform: cs.transform,
          scale: cs.scale,
          duration: cs.transitionDuration,
          property: cs.transitionProperty,
        };
      });

    const resting = await transformOf();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Wait for the value to SETTLE, do not read it immediately. The transition
    // is 200ms, and reading on the same tick as mousedown caught scale at 1 -
    // the start of the animation - which differs from the resting `none` and
    // so passed this check while proving nothing about where it ends up.
    await target
      .evaluate(
        (el) =>
          new Promise((resolve, reject) => {
            // Settled = the same value three frames running. Resolving on the
            // first frame under a threshold would report a number from the
            // middle of the animation and tell us nothing about where it ends.
            const started = Date.now();
            let last = null;
            let same = 0;
            const poll = () => {
              const v = parseFloat(getComputedStyle(el).scale);
              same = v === last ? same + 1 : 0;
              last = v;
              if (same >= 3) return resolve(v);
              if (Date.now() - started > 3000) return reject(new Error('never settled'));
              requestAnimationFrame(poll);
            };
            poll();
          })
      )
      .catch(() => {}); // let the check below report it, with the numbers

    const pressed = await transformOf();
    await page.mouse.up();

    const moved =
      pressed.transform !== resting.transform || pressed.scale !== resting.scale;
    check(
      moved,
      'a header control visibly moves while held down',
      `resting: transform ${resting.transform} / scale ${resting.scale} | ` +
        `pressed: transform ${pressed.transform} / scale ${pressed.scale}`
    );

    const secs = (resting.duration || '')
      .split(',')
      .map((d) => parseFloat(d))
      .filter((n) => !Number.isNaN(n));
    const slowest = secs.length ? Math.max(...secs) : 0;
    check(
      slowest >= 0.2,
      `its transition is long enough to be seen: ${slowest}s (needs 0.2)`,
      `transition-property: ${resting.property}`
    );

    // The motion has to be opt-out. This one is a stylesheet question by
    // nature - the media query is the feature.
    const reducedMotion = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin
        }
        for (const rule of rules) {
          if (/prefers-reduced-motion/.test(rule.cssText || '')) return true;
        }
      }
      return false;
    });
    check(reducedMotion, 'a prefers-reduced-motion block exists, so the motion is opt-out');
  } finally {
    await browser.close();
  }

  console.log('\n-----------------------------------------');
  if (failures) {
    console.log(`FAIL: ${failures} check(s) failed\n`);
    process.exit(1);
  }
  console.log('PASS: the header says where you are, and controls answer\n');
})();
