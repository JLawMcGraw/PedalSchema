'use strict';

/*
 * Canonical, runtime-neutral pedal image processing.
 *
 * This module is CommonJS on purpose: the Next client bundle can consume it,
 * and the repository's Node scraper can require the same bytes without a
 * TypeScript loader. Everything operates on { data, width, height } and knows
 * nothing about Canvas, Sharp, Files, storage, or catalogue-specific sources.
 */

const BG_TOL = 35;
const BG_GRAD_TOL = 12;
const BG_GRAD_MIN_LUM = 90;
const BG_GRAD_MAX_SAT = 48;
const ALREADY_CUTOUT_SHARE = 0.3;
const MAX_KNOCK_SHARE = 0.9;
const MIN_BORDER_KNOCK_SHARE = 0.85;
const MAX_CENTRE_KNOCK_SHARE = 0.02;
const OPAQUE = 20;
const SOLID = 200;
const LOW_ALPHA_MATTE = 32;
const STRAY_MAX_SHARE = 0.1;
const STRAY_MIN_LUM = 150;
const STRAY_MAX_SAT = 40;

function copyImage(input) {
  return {
    data: new Uint8ClampedArray(input.data),
    width: input.width,
    height: input.height,
  };
}

function knockOutBackground(input, options = {}) {
  const useGradient = options.useGradient !== false;
  const bgTol = options.bgTol ?? BG_TOL;
  const allowRagged = options.allowRagged === true;
  const { width: W, height: H } = input;
  const out = copyImage(input);
  const px = out.data;

  if (W < 3 || H < 3) return { image: out, status: 'no-background', knocked: 0 };

  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);

  let transparent = 0;
  for (const i of border) if (px[i * 4 + 3] < OPAQUE) transparent++;
  if (transparent > border.length * ALREADY_CUTOUT_SHARE) {
    return { image: out, status: 'already-cutout', knocked: 0 };
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const i of border) {
    if (px[i * 4 + 3] < OPAQUE) continue;
    r += px[i * 4];
    g += px[i * 4 + 1];
    b += px[i * 4 + 2];
    n++;
  }
  if (!n) return { image: out, status: 'no-background', knocked: 0 };
  r /= n;
  g /= n;
  b /= n;

  const isBg = (i) =>
    px[i * 4 + 3] >= OPAQUE &&
    Math.abs(px[i * 4] - r) <= bgTol &&
    Math.abs(px[i * 4 + 1] - g) <= bgTol &&
    Math.abs(px[i * 4 + 2] - b) <= bgTol;
  const lum = (i) =>
    0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const sat = (i) =>
    Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) -
    Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  const maxSat = Math.max(r, g, b) - Math.min(r, g, b) + BG_GRAD_MAX_SAT;
  const chainable = (j) =>
    px[j * 4 + 3] >= OPAQUE && lum(j) >= BG_GRAD_MIN_LUM && sat(j) <= maxSat;
  const chains = (i, j) =>
    chainable(j) &&
    Math.abs(px[j * 4] - px[i * 4]) <= BG_GRAD_TOL &&
    Math.abs(px[j * 4 + 1] - px[i * 4 + 1]) <= BG_GRAD_TOL &&
    Math.abs(px[j * 4 + 2] - px[i * 4 + 2]) <= BG_GRAD_TOL;

  const visited = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  for (const i of border) {
    if (!visited[i] && (isBg(i) || (useGradient && chainable(i)))) {
      visited[i] = 1;
      stack[top++] = i;
    }
  }

  const knockedIdx = [];
  while (top > 0) {
    const i = stack[--top];
    knockedIdx.push(i);
    const x = i % W;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= W * H) continue;
      if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
      if (!visited[j] && (isBg(j) || (useGradient && chains(i, j)))) {
        visited[j] = 1;
        stack[top++] = j;
      }
    }
  }

  if (knockedIdx.length > W * H * MAX_KNOCK_SHARE) {
    return { image: out, status: 'reverted', knocked: 0 };
  }

  const cx0 = Math.floor(W * 0.4);
  const cx1 = Math.ceil(W * 0.6);
  const cy0 = Math.floor(H * 0.4);
  const cy1 = Math.ceil(H * 0.6);
  let centreKnocked = 0;
  for (const i of knockedIdx) {
    const x = i % W;
    const y = (i / W) | 0;
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) centreKnocked++;
  }
  if (centreKnocked > (cx1 - cx0) * (cy1 - cy0) * MAX_CENTRE_KNOCK_SHARE) {
    return { image: out, status: 'subject-eaten', knocked: 0 };
  }

  let borderKnocked = 0;
  for (const i of border) if (visited[i]) borderKnocked++;
  if (!allowRagged && borderKnocked < border.length * MIN_BORDER_KNOCK_SHARE) {
    return { image: out, status: 'ragged-background', knocked: 0 };
  }

  for (const i of knockedIdx) px[i * 4 + 3] = 0;
  return { image: out, status: 'knocked-out', knocked: knockedIdx.length };
}

function trimTransparent(input, alphaThreshold = 25) {
  const { data, width: W, height: H } = input;
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return input;
  if (minX === 0 && minY === 0 && maxX === W - 1 && maxY === H - 1) return input;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = ((y + minY) * W + minX) * 4;
    out.set(data.subarray(src, src + width * 4), y * width * 4);
  }
  return { data: out, width, height };
}

function clearLowAlphaMatte(input, threshold = LOW_ALPHA_MATTE) {
  let cleared = 0;
  const out = copyImage(input);
  for (let i = 3; i < out.data.length; i += 4) {
    if (out.data[i] > 0 && out.data[i] < threshold) {
      out.data[i] = 0;
      cleared++;
    }
  }
  return { image: cleared ? out : input, cleared };
}

function labelSolidComponents(input) {
  const { data, width: W, height: H } = input;
  const label = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const blobs = [];
  for (let s = 0; s < W * H; s++) {
    if (label[s] !== -1 || data[s * 4 + 3] <= SOLID) continue;
    const id = blobs.length;
    let top = 0;
    let n = 0;
    let sl = 0;
    let ss = 0;
    stack[top++] = s;
    label[s] = id;
    while (top > 0) {
      const i = stack[--top];
      n++;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      sl += 0.299 * r + 0.587 * g + 0.114 * b;
      ss += Math.max(r, g, b) - Math.min(r, g, b);
      const x = i % W;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
        if (label[j] === -1 && data[j * 4 + 3] > SOLID) {
          label[j] = id;
          stack[top++] = j;
        }
      }
    }
    blobs.push({ id, n, lum: sl / n, sat: ss / n });
  }
  return { label, blobs };
}

function dropStrayBackground(input) {
  const { label, blobs } = labelSolidComponents(input);
  if (blobs.length < 2) return { image: input, dropped: 0, blobs: blobs.length };
  const main = blobs.reduce((a, b) => (b.n > a.n ? b : a));
  const doomed = new Set(
    blobs
      .filter(
        (blob) =>
          blob.id !== main.id &&
          blob.n < main.n * STRAY_MAX_SHARE &&
          blob.lum > STRAY_MIN_LUM &&
          blob.sat < STRAY_MAX_SAT
      )
      .map((blob) => blob.id)
  );
  if (!doomed.size) return { image: input, dropped: 0, blobs: blobs.length };

  const out = copyImage(input);
  let dropped = 0;
  for (let i = 0; i < input.width * input.height; i++) {
    if (doomed.has(label[i])) {
      out.data[i * 4 + 3] = 0;
      dropped++;
    }
  }
  return { image: out, dropped, blobs: blobs.length };
}

function alphaQualityReport(input) {
  const total = input.width * input.height;
  let transparent = 0;
  let lowAlpha = 0;
  let semiTransparent = 0;
  let opaque = 0;
  for (let i = 3; i < input.data.length; i += 4) {
    const alpha = input.data[i];
    if (alpha === 0) transparent++;
    else if (alpha < LOW_ALPHA_MATTE) lowAlpha++;
    else if (alpha <= SOLID) semiTransparent++;
    else opaque++;
  }
  const { blobs } = labelSolidComponents(input);
  const solidPixels = blobs.reduce((sum, blob) => sum + blob.n, 0);
  const mainPixels = blobs.reduce((largest, blob) => Math.max(largest, blob.n), 0);
  return {
    transparentShare: transparent / total,
    lowAlphaShare: lowAlpha / total,
    semiTransparentShare: semiTransparent / total,
    opaqueShare: opaque / total,
    solidComponents: blobs.length,
    solidStrayShare: solidPixels ? (solidPixels - mainPixels) / solidPixels : 0,
  };
}

module.exports = {
  knockOutBackground,
  trimTransparent,
  clearLowAlphaMatte,
  dropStrayBackground,
  alphaQualityReport,
};
