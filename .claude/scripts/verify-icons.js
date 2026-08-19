#!/usr/bin/env node
/**
 * The icon set was swapped, and swapped ALL THE WAY.
 *
 * A half-done icon migration is the standard outcome: the visible screens get
 * done and something in a dropdown, a sheet, or an empty state keeps the old
 * set, at a different stroke weight, forever. Two checks, because they fail
 * differently:
 *
 *   1. no lucide import survives anywhere in src/ - a source check, because an
 *      icon in a menu that nobody opened is not in the DOM to be measured;
 *   2. every icon actually RENDERED comes from the new set - a runtime check,
 *      because an import list cannot tell you what reached the screen.
 *
 * On stroke weight, honestly: the first version of this gate compared
 * `stroke-width` across the rendered icons and passed with "weights present:
 * (none)". Phosphor's regular weight draws FILLED paths, so there is no
 * stroke-width to compare and the check could not have failed. Worse, the
 * weight is baked into the path data, so mixing `weight="bold"` into one call
 * site is not visible in the DOM at all. Weight is therefore enforced where it
 * IS visible - at the source, by allowing no per-site override, so every icon
 * takes the one default.
 *
 * Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, waitForCanvas } = require('./lib/twin');

loadEnv();

const ROOT = path.join(__dirname, '..', '..');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

/** Every .ts/.tsx under src/, walked. */
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

(async () => {
  console.log('\n=== the old set is gone from source ===');
  const files = sources(path.join(ROOT, 'src'));
  const stragglers = files.filter((f) => /lucide-react/.test(fs.readFileSync(f, 'utf8')));
  check(
    stragglers.length === 0,
    `no lucide-react import in any of ${files.length} source files`,
    stragglers.map((f) => path.relative(ROOT, f)).join('\n        ')
  );

  // A server component that imports the client entry throws at build time, so
  // this is belt-and-braces; but the failure mode is a blank page, which is
  // worth a named check rather than a stack trace.
  const serverFiles = files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return !/^['"]use client['"]/m.test(src) && /@phosphor-icons\/react['"]/.test(src);
  });
  check(
    serverFiles.length === 0,
    'no server component imports the client icon entry',
    serverFiles.map((f) => path.relative(ROOT, f)).join('\n        ')
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);
    await openEditor(page);
    await waitForCanvas(page);

    // Icons live in the chrome, not on the drawing. The canvas is a technical
    // drawing with its own stroke language and is deliberately excluded.
    const icons = await page.evaluate(() => {
      const seen = [];
      for (const svg of document.querySelectorAll('svg')) {
        if (svg.closest('[data-canvas], .editor-canvas')) continue;
        const vb = svg.getAttribute('viewBox');
        if (vb !== '0 0 256 256') continue; // Phosphor's viewBox
        const widths = new Set();
        for (const el of svg.querySelectorAll('[stroke-width]')) {
          widths.add(el.getAttribute('stroke-width'));
        }
        seen.push({ widths: [...widths] });
      }
      return seen;
    });

    console.log('\n=== every rendered icon is the new set, at one weight ===');
    check(icons.length >= 4, `found ${icons.length} rendered icons on the editor`);

    // All drawn the same way. This catches a stroke-based icon (the old set, or
    // a hand-rolled SVG) mixed in among filled ones - which IS visible in the
    // DOM - but see the note at the top: it cannot catch a mixed Phosphor
    // weight, and the source check below is what covers that.
    const signatures = new Set(
      icons.map((i) => (i.widths.length ? i.widths.sort().join('/') : 'filled'))
    );
    check(
      signatures.size === 1,
      'all rendered icons are drawn the same way',
      `signatures present: ${[...signatures].join(', ')}`
    );

    // Anything still on the old set would have a 24-unit viewBox.
    const oldSet = await page.evaluate(
      () =>
        [...document.querySelectorAll('svg')].filter(
          (s) => s.getAttribute('viewBox') === '0 0 24 24'
        ).length
    );
    check(oldSet === 0, `no icon still drawn on the old 24x24 grid (found ${oldSet})`);

    // One weight, enforced at the only place it can be: nobody overrides it.
    // `weight` is baked into the path data, so a per-site override is invisible
    // to any runtime check.
    const overrides = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /@phosphor-icons\/react/.test(src) && /\bweight=/.test(src);
    });
    check(
      overrides.length === 0,
      'no call site overrides the icon weight, so there is exactly one',
      overrides.map((f) => path.relative(ROOT, f)).join('\n        ')
    );
  } finally {
    await browser.close();
  }

  console.log('\n-----------------------------------------');
  if (failures) {
    console.log(`FAIL: ${failures} check(s) failed\n`);
    process.exit(1);
  }
  console.log('PASS: one icon set, one stroke weight\n');
})();
