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

// The reserved STATUS colours are exempt throughout: they report state, they
// are not second brand colours. Everything else has to be in one of the two
// families.
const STATUS = ['destructive', 'warning'];
const families = Object.entries(tokens).filter(([name]) => !STATUS.includes(name));

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

// --- the pedal FAMILY palette ----------------------------------------------
//
// Ported here on purpose. These four hues were chosen by running the dataviz
// skill's validator, which lives in a bundled skill directory that this repo
// does not own and cannot count on finding later. A guarantee whose only proof
// lives outside the repo is the same mistake that lost the Phase B direction -
// so the arithmetic moves in.
//
// Machado, Oliveira & Fernandes (2009) CVD transforms at severity 1.0, applied
// in LINEAR rgb. Thresholds are OKLab dE x100 and are calibrated to this model.
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
const CVD_TARGET = 8.0; // adjacent/all-pairs floor under simulated protan+deutan
const NORMAL_FLOOR = 15.0; // worst pair under unsimulated vision
const CHROMA_FLOOR = 0.1; // below this a hue reads as grey

const hexToLinear = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
};
const linearToOklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const simulate = (lin, m) => m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
const deltaE = (a, b) => {
  const x = linearToOklab(a);
  const y = linearToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
};
const chromaOf = (lin) => {
  const [, A, B] = linearToOklab(lin);
  return Math.hypot(A, B);
};

console.log('\n=== the pedal family palette ===');
const famSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'lib', 'constants', 'pedal-categories.ts'),
  'utf8'
);

// Read the families out of the source, so this cannot drift from what ships.
const fams = [];
for (const m of famSrc.matchAll(
  /value:\s*'([a-z_]+)',\s*\n\s*label:\s*'[^']*',\s*\n\s*description:[\s\S]*?color:\s*'(#[0-9a-f]{6})'/g
)) {
  fams.push({ name: m[1], hex: m[2], lin: hexToLinear(m[2]) });
}
check(fams.length >= 2, `read ${fams.length} families out of pedal-categories.ts`);

// Every category must land in a family that exists, or a pedal renders with
// `undefined` for a colour and no test would notice.
const declared = new Set(fams.map((f) => f.name));
const mapped = [...famSrc.matchAll(/value:\s*'([a-z_]+)',\s*label:[^\n]*family:\s*'([a-z]+)'/g)];
check(mapped.length === 18, `all 18 categories declare a family (found ${mapped.length})`);
const orphans = mapped.filter(([, , fam]) => !declared.has(fam));
check(
  orphans.length === 0,
  'every category points at a family that exists',
  orphans.map((o) => `${o[1]} -> ${o[2]}`).join(', ')
);

// utility is the deliberate neutral: it says "not one effect". The rest must
// carry real colour.
const chromatic = fams.filter((f) => f.name !== 'utility');
const neutral = fams.find((f) => f.name === 'utility');
if (neutral) {
  const c = chromaOf(neutral.lin);
  check(c < CHROMA_FLOOR, `utility stays neutral (chroma ${c.toFixed(3)} < ${CHROMA_FLOOR})`);
}
for (const f of chromatic) {
  const c = chromaOf(f.lin);
  check(c >= CHROMA_FLOOR, `${f.name} carries real colour (chroma ${c.toFixed(3)})`);
}

// All pairs, not just adjacent: these dots are scattered across a board and a
// list, never laid out in a fixed series order.
let worstCvd = Infinity;
let worstCvdPair = '';
let worstNormal = Infinity;
let worstNormalPair = '';
for (let i = 0; i < chromatic.length; i++) {
  for (let j = i + 1; j < chromatic.length; j++) {
    const a = chromatic[i];
    const b = chromatic[j];
    const cvd = Math.min(
      deltaE(simulate(a.lin, MACHADO.protan), simulate(b.lin, MACHADO.protan)),
      deltaE(simulate(a.lin, MACHADO.deutan), simulate(b.lin, MACHADO.deutan))
    );
    const nrm = deltaE(a.lin, b.lin);
    if (cvd < worstCvd) { worstCvd = cvd; worstCvdPair = `${a.name}/${b.name}`; }
    if (nrm < worstNormal) { worstNormal = nrm; worstNormalPair = `${a.name}/${b.name}`; }
  }
}
check(
  worstCvd >= CVD_TARGET,
  `worst pair under protan/deutan: ${worstCvd.toFixed(1)} dE (needs ${CVD_TARGET}) - ${worstCvdPair}`
);
check(
  worstNormal >= NORMAL_FLOOR,
  `worst pair in normal vision: ${worstNormal.toFixed(1)} dE (needs ${NORMAL_FLOOR}) - ${worstNormalPair}`
);

// The dots sit on panels and on the canvas board; both have to hold them.
for (const surface of [tokens.card.lin, tokens.background.lin]) {
  for (const f of fams) {
    const r = contrast(f.lin, surface);
    check(r >= 3, `${f.name} ${f.hex} reads against ${hex(surface)}: ${r.toFixed(2)}:1 (needs 3)`);
  }
}

// --- the CABLE palette ------------------------------------------------------
//
// The canvas draws three cables a player has to tell apart at a glance, and
// they used to be three raw Tailwind hues. Held to the same arithmetic as
// everything else, and read out of the source so it cannot drift.
console.log('\n=== the cable palette ===');

const cableSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'lib', 'engine', 'cables', 'explain.ts'),
  'utf8'
);
const cables = {};
const cableBlock = cableSrc.slice(cableSrc.indexOf('const COLOURS'));
for (const m of cableBlock
  .slice(0, cableBlock.indexOf('};'))
  .matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/g)) {
  cables[m[1]] = { hex: m[2], lin: hexToLinear(m[2]) };
}
check(Object.keys(cables).length === 5, `read ${Object.keys(cables).length} cable colours out of explain.ts`);

// A power cable that looks like a failed one is the trap this guards. They
// shared a colour until 2026-08-19; power is unreachable today, which is
// exactly why nobody would have noticed.
check(
  cables.power && cables.unroutable && cables.power.hex !== cables.unroutable.hex,
  'a power cable is not drawn in the failure colour',
  `power ${cables.power?.hex} vs unroutable ${cables.unroutable?.hex}`
);

// A perimeter run is the same cable, just routed round the outside - the dash
// is what carries that, so the colour must NOT also change.
check(
  cables.around && cables.patch && cables.around.hex === cables.patch.hex,
  'a perimeter run keeps its cable colour, so the dash adds information',
  `around ${cables.around?.hex} vs patch ${cables.patch?.hex}`
);

// The three a player actually has to separate on a busy board.
const onCanvas = ['instrument', 'patch', 'unroutable'].map((k) => ({ name: k, ...cables[k] }));
let worstCable = Infinity;
let worstCablePair = '';
for (let i = 0; i < onCanvas.length; i++) {
  for (let j = i + 1; j < onCanvas.length; j++) {
    const a = onCanvas[i];
    const b = onCanvas[j];
    const cvd = Math.min(
      deltaE(simulate(a.lin, MACHADO.protan), simulate(b.lin, MACHADO.protan)),
      deltaE(simulate(a.lin, MACHADO.deutan), simulate(b.lin, MACHADO.deutan))
    );
    if (cvd < worstCable) {
      worstCable = cvd;
      worstCablePair = `${a.name}/${b.name}`;
    }
  }
}
check(
  worstCable >= CVD_TARGET,
  `worst cable pair under protan/deutan: ${worstCable.toFixed(1)} dE ` +
    `(needs ${CVD_TARGET}) - ${worstCablePair}`,
  'the raw-Tailwind set scored 6.4 here, on instrument/patch'
);

// The board is its own surface - a physical object on the substrate - so the
// cables are checked against IT, not against the panel colour.
const BOARD = hexToLinear('#1f2937');
for (const c of onCanvas) {
  const r = contrast(c.lin, BOARD);
  check(r >= 3, `${c.name} ${c.hex} reads against the board: ${r.toFixed(2)}:1 (needs 3)`);
}

// --- the JACK palette -------------------------------------------------------
//
// Colour on a jack dot encodes DIRECTION, not type. Six hues on an 8px mark
// with no legend anywhere was not an encoding, and it was measurably failing:
// input and output - 64% of every dot on screen - sat 6.4 dE apart under
// simulated deuteranopia. The pair that mattered most was the one that did
// not separate.
console.log('\n=== the jack palette ===');

const jackSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'lib', 'constants', 'jack-appearance.ts'),
  'utf8'
);
const jacks = {};
const jackBlock = jackSrc.slice(jackSrc.indexOf('JACK_COLOURS'));
for (const m of jackBlock
  .slice(0, jackBlock.indexOf('};'))
  .matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/g)) {
  jacks[m[1]] = { hex: m[2], lin: hexToLinear(m[2]) };
}
check(Object.keys(jacks).length === 3, `read ${Object.keys(jacks).length} jack colours (in / out / other)`);

// Every jack type must land in a group, or a dot renders with `undefined`.
const declaredTypes = [...jackSrc.matchAll(/^\s{2}(\w+):\s*'(in|out|other)'/gm)].map((m) => m[1]);
const ALL_TYPES = ['input', 'output', 'send', 'return', 'power', 'expression', 'midi_in', 'midi_out'];
const unmapped = ALL_TYPES.filter((t) => !declaredTypes.includes(t));
check(unmapped.length === 0, `all ${ALL_TYPES.length} jack types are grouped`, `unmapped: ${unmapped.join(', ')}`);

// send is the loop's output and return is its input - grouping them the other
// way round would invert the one thing this colour is carrying.
const groupOf = (t) => {
  const m = jackSrc.match(new RegExp('^\\s{2}' + t + ": '(in|out|other)'", 'm'));
  return m ? m[1] : null;
};
check(groupOf('input') === 'in' && groupOf('return') === 'in', 'input and return are both `in`');
check(groupOf('output') === 'out' && groupOf('send') === 'out', 'output and send are both `out`');
check(groupOf('power') === 'other', 'power is not on the signal path, so it is grey');

let worstJack = Infinity;
let worstJackPair = '';
const jk = Object.keys(jacks);
for (let i = 0; i < jk.length; i++) {
  for (let j = i + 1; j < jk.length; j++) {
    const a = jacks[jk[i]];
    const b = jacks[jk[j]];
    const c = Math.min(
      deltaE(simulate(a.lin, MACHADO.protan), simulate(b.lin, MACHADO.protan)),
      deltaE(simulate(a.lin, MACHADO.deutan), simulate(b.lin, MACHADO.deutan))
    );
    if (c < worstJack) {
      worstJack = c;
      worstJackPair = `${jk[i]}/${jk[j]}`;
    }
  }
}
check(
  worstJack >= CVD_TARGET,
  `worst jack pair under protan/deutan: ${worstJack.toFixed(1)} dE (needs ${CVD_TARGET}) - ${worstJackPair}`,
  'the six-hue set scored 6.4 here, on input/output'
);

// in and out is the distinction the whole encoding exists for, so it is held
// to more than the bare minimum.
const inOut = Math.min(
  deltaE(simulate(jacks.in.lin, MACHADO.protan), simulate(jacks.out.lin, MACHADO.protan)),
  deltaE(simulate(jacks.in.lin, MACHADO.deutan), simulate(jacks.out.lin, MACHADO.deutan))
);
check(inOut >= 20, `in and out separate strongly: ${inOut.toFixed(1)} dE (needs 20)`);

console.log('\n-----------------------------------------');
if (failures) {
  console.log(`FAIL: ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('PASS: palette is legible, one grey family, one accent, families separate\n');
