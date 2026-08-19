#!/usr/bin/env node
/**
 * The palette is legible, in one grey family, and has exactly one accent.
 *
 * This reads the REAL token values out of src/app/globals.css. A gate that
 * carried its own copy of the palette would pass forever while the stylesheet
 * drifted underneath it, which is the failure mode it exists to prevent.
 *
 * Why a gate at all: "the contrast looks fine" is the exact kind of claim
 * nobody can check later. Phase B picked its oklch values by arithmetic - the
 * first pass put --card one step too close to the substrate, 1.08:1, and only
 * the arithmetic said so. This keeps that arithmetic runnable.
 *
 * No browser, no database, no dev server. Nothing here is saved.
 *
 * Usage: node .claude/scripts/verify-palette.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = path.join(ROOT, 'src', 'app', 'globals.css');
const LAYOUT = path.join(ROOT, 'src', 'app', 'layout.tsx');

// --- oklch -> linear sRGB -> WCAG relative luminance ------------------------
function oklchToLinear(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const clamp = (c) => Math.min(1, Math.max(0, c));
const encode = (c) =>
  clamp(c) <= 0.0031308 ? 12.92 * clamp(c) : 1.055 * Math.pow(clamp(c), 1 / 2.4) - 0.055;
const hex = (lin) =>
  '#' + lin.map((c) => Math.round(encode(c) * 255).toString(16).padStart(2, '0')).join('');
const luminance = (lin) => {
  const [r, g, b] = lin.map(clamp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (x, y) => {
  const a = luminance(x);
  const b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const inGamut = (lin) => lin.every((c) => c >= -0.0005 && c <= 1.0005);

// --- read the tokens the app actually ships --------------------------------
const css = fs.readFileSync(CSS, 'utf8');
const rootStart = css.indexOf(':root {');
const rootBlock = css.slice(rootStart, css.indexOf('}', rootStart));

/** Every `--name: oklch(L C H);` in :root, resolved to linear sRGB. */
const tokens = {};
for (const m of rootBlock.matchAll(/--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
  tokens[m[1]] = { lch: [+m[2], +m[3], +m[4]], lin: oklchToLinear(+m[2], +m[3], +m[4]) };
}

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

console.log('\n=== tokens read from globals.css ===');
for (const [name, t] of Object.entries(tokens)) {
  const [L, C, H] = t.lch;
  console.log(`  --${name.padEnd(20)} oklch(${L} ${C} ${H})`.padEnd(54) + hex(t.lin));
}

// A missing token here means the palette was restructured. That is a failure,
// not a silently skipped check.
const REQUIRED = [
  'background', 'foreground', 'card', 'popover', 'primary', 'primary-foreground',
  'muted', 'muted-foreground', 'accent', 'destructive', 'border', 'input', 'ring',
];

console.log('\n=== the palette exists ===');
for (const name of REQUIRED) {
  check(!!tokens[name], `--${name} is defined as an oklch triple in :root`);
}
if (failures) {
  console.log(`\nFAIL: ${failures} check(s) failed - the palette structure changed\n`);
  process.exit(1);
}

console.log('\n=== every colour is inside the sRGB gamut ===');
for (const [name, t] of Object.entries(tokens)) {
  const ok = inGamut(t.lin);
  check(ok, `--${name} does not clip`, ok ? '' : `clamped to ${hex(t.lin)}`);
}

console.log('\n=== contrast ===');
const PAIRS = [
  ['foreground', 'background', 4.5, 'body text on the substrate'],
  ['foreground', 'card', 4.5, 'body text on a panel'],
  ['foreground', 'popover', 4.5, 'body text on a popover'],
  ['muted-foreground', 'background', 4.5, 'labels on the substrate'],
  ['muted-foreground', 'card', 4.5, 'labels on a panel'],
  ['primary', 'background', 4.5, 'signal green as text on the substrate'],
  ['primary', 'card', 4.5, 'signal green as text on a panel'],
  ['primary-foreground', 'primary', 4.5, 'ink on a green button'],
  ['destructive', 'card', 4.5, 'error text on a panel'],
  // Not text: these only have to be SEEN. The hairline is what separates one
  // panel from the next in this direction, so if it vanishes the layout does.
  ['border', 'card', 1.3, 'hairline visible against a panel'],
  ['border', 'background', 1.3, 'hairline visible against the substrate'],
  ['card', 'background', 1.1, 'a panel reads as raised off the substrate'],
];
for (const [a, b, need, label] of PAIRS) {
  const r = contrast(tokens[a].lin, tokens[b].lin);
  check(r >= need, `${label}: ${r.toFixed(2)}:1 (needs ${need})`);
}

// --- the rules the direction imposes ---------------------------------------
console.log('\n=== one grey family, one accent ===');

// Grouping by chroma is the wrong cut, and the first version of this gate got
// it wrong: --primary-foreground is the dark ink on a green button, tinted to
// hue 152 at chroma 0.04. Low chroma, but it is not a grey - it belongs to the
// accent family. So group by HUE, and take the family hues from the two tokens
// that define them.
const NEUTRAL_HUE = tokens.background.lch[2];
const ACCENT_HUE = tokens.primary.lch[2];
const NEUTRAL_MAX_CHROMA = 0.05;

// --destructive is exempt throughout: a failure colour is a signal, not a
// second brand colour.
const families = Object.entries(tokens).filter(([name]) => name !== 'destructive');

// "Mixing warm and cool grays... stick to one gray family." A third hue
// anywhere is what that looks like.
const strays = families.filter(
  ([, t]) => t.lch[2] !== NEUTRAL_HUE && t.lch[2] !== ACCENT_HUE
);
check(
  strays.length === 0,
  `every token is in one of the two families (grey ${NEUTRAL_HUE}, accent ${ACCENT_HUE})`,
  strays.length ? `stray: ${strays.map(([n, t]) => `--${n} @ ${t.lch[2]}`).join(', ')}` : ''
);

// The greys stay grey: nothing at the neutral hue is allowed to carry real colour.
const greys = families.filter(([, t]) => t.lch[2] === NEUTRAL_HUE);
const loudGreys = greys.filter(([, t]) => t.lch[1] > NEUTRAL_MAX_CHROMA);
check(
  loudGreys.length === 0,
  `all ${greys.length} tokens in the grey family stay under chroma ${NEUTRAL_MAX_CHROMA}`,
  loudGreys.map(([n, t]) => `--${n} @ ${t.lch[1]}`).join(', ')
);

// "More than one accent color. Pick one."
const accents = families.filter(([, t]) => t.lch[2] === ACCENT_HUE);
check(
  accents.length > 0,
  `the accent family is used: ${accents.map(([n]) => '--' + n).join(', ')}`
);

// "Oversaturated accent colors. Keep saturation below 80%." oklch chroma is
// unbounded in principle; 0.25 is about the sRGB edge at these lightnesses.
for (const [name, t] of accents) {
  check(t.lch[1] <= 0.25, `--${name} is not oversaturated (chroma ${t.lch[1]})`);
}

// "Pure #000000 background. Replace with off-black."
const bgHex = hex(tokens.background.lin);
check(bgHex !== '#000000', `the substrate is off-black, not #000 (${bgHex})`);
check(tokens.background.lch[1] > 0, 'the substrate is tinted, not chroma 0');

// There is one palette by decision. A .dark block reappearing means somebody
// started a second one. The class on <html> is only there to arm shadcn's own
// `dark:` utilities - without it, 22 of them silently never fire.
console.log('\n=== one palette, not two ===');
check(!/^\.dark\s*\{/m.test(css), 'no second .dark palette block in globals.css');
const layout = fs.readFileSync(LAYOUT, 'utf8');
check(
  /<html[^>]*className="dark"/.test(layout),
  'the dark class is on <html>, so shadcn dark: utilities resolve'
);

console.log('\n-----------------------------------------');
if (failures) {
  console.log(`FAIL: ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('PASS: palette is legible, one grey family, one accent\n');
