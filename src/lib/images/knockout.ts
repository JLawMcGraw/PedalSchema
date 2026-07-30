/**
 * Background knockout for pedal photos.
 *
 * Ported from the local image-mirror pipeline (scraper/mirror-pedal-images.js)
 * so user uploads on /pedals/new become the same cut-out silhouettes the
 * mirrored system-pedal photos already are. The canvas renderer draws a photo
 * with no body box behind it, so any surviving background reads as a white or
 * grey rectangle sitting on the board.
 *
 * Everything here is pure RGBA-buffer math - no canvas, no DOM - so it runs in
 * tests and in a worker as easily as in the browser.
 */

export interface RgbaImage {
  /** Pinned to ArrayBuffer (not ArrayBufferLike) so an ImageData is assignable. */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Per-channel distance from the average border color still counted as background. */
const BG_TOL = 35;
/** Per-channel step allowed when following a smooth backdrop gradient. */
const BG_GRAD_TOL = 12;
/** Gradient-following never enters pixels darker than this, so it cannot creep
 *  through a drop shadow into a black enclosure. */
const BG_GRAD_MIN_LUM = 90;
/** Border transparency above this share means the image is already a silhouette. */
const ALREADY_CUTOUT_SHARE = 0.3;
/** A knockout that eats more than this share of the frame leaked into the subject. */
const MAX_KNOCK_SHARE = 0.9;
/**
 * A real backdrop surrounds the subject, so the fill must clear essentially the
 * whole frame border. Below this, the fill only nibbled a ragged fraction of a
 * busy background (a phone shot on a patterned surface) and would leave random
 * transparent speckles - worse than doing nothing. Studio and evenly-textured
 * backgrounds both clear 100% of the border; noisy ones stall near 55%.
 */
const MIN_BORDER_KNOCK_SHARE = 0.85;
/**
 * Share of the centre 40% box the fill may touch before it counts as having
 * eaten the subject. A product photo has the product in the middle, so a fill
 * that reaches there has leaked out of the backdrop. Measured across 64
 * mirrored pedal photos the split is unambiguous: healthy fills touch at most
 * 0.49% of the centre box, damaged ones 4.48% and up (worst: 59%). Without
 * this, a JPEG of a pedal with light areas gets hollowed out and renders as a
 * black blob - only its dark knobs and footswitch survive.
 */
const MAX_CENTRE_KNOCK_SHARE = 0.02;
/** Alpha at or above this counts as an opaque pixel. */
const OPAQUE = 20;

export type KnockoutStatus =
  | 'knocked-out' // background removed
  | 'already-cutout' // image already had an alpha silhouette
  | 'no-background' // no opaque border pixels to sample
  | 'ragged-background' // background too busy to clear cleanly; discarded
  | 'subject-eaten' // fill reached the middle of the frame; discarded
  | 'reverted'; // fill ran away and was discarded

export interface KnockoutResult {
  image: RgbaImage;
  status: KnockoutStatus;
  /** Pixels made transparent (0 unless status is 'knocked-out'). */
  knocked: number;
}

/**
 * Flood fill from every border pixel, absorbing pixels whose color stays within
 * BG_TOL per channel of the border's average background color, OR that continue
 * a smooth gradient from an absorbed neighbour (studio backdrops fade 240->110).
 * Edge-connected only: white knobs and labels on the pedal face are interior and
 * unreachable, so they survive.
 *
 * Returns a new image; the input buffer is not modified.
 */
export function knockOutBackground(
  input: RgbaImage,
  /**
   * Follow smooth backdrop gradients. Needed for studio shots that fade
   * 240->110, but it is also what lets a fill walk out of a soft backdrop into
   * a pedal's own light areas - so prepareSilhouette retries without it.
   */
  useGradient = true
): KnockoutResult {
  const { width: W, height: H } = input;
  const px = new Uint8ClampedArray(input.data);
  const out: RgbaImage = { data: px, width: W, height: H };

  if (W < 3 || H < 3) return { image: out, status: 'no-background', knocked: 0 };

  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);

  // Already a silhouette? (a real alpha edge, not just an alpha channel)
  let transparent = 0;
  for (const i of border) if (px[i * 4 + 3] < OPAQUE) transparent++;
  if (transparent > border.length * ALREADY_CUTOUT_SHARE) {
    return { image: out, status: 'already-cutout', knocked: 0 };
  }

  // Average opaque border color = background reference
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
  // Unreachable by construction, kept as a division guard: every border pixel
  // is counted either as `transparent` or in `n`, and the check above already
  // returned when transparent exceeded 30% of the border - so n is at least
  // 70% of a border that has >= 12 pixels once W,H >= 3. Building the fixture
  // corpus surfaced this: the only specimen that can produce 'no-background'
  // is the sub-3px guard at the top of the function.
  if (!n) return { image: out, status: 'no-background', knocked: 0 };
  r /= n;
  g /= n;
  b /= n;

  const isBg = (i: number) =>
    px[i * 4 + 3] >= OPAQUE &&
    Math.abs(px[i * 4] - r) <= BG_TOL &&
    Math.abs(px[i * 4 + 1] - g) <= BG_TOL &&
    Math.abs(px[i * 4 + 2] - b) <= BG_TOL;

  const lum = (i: number) =>
    0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

  /** j continues a smooth, light gradient from already-background i. */
  const chains = (i: number, j: number) =>
    px[j * 4 + 3] >= OPAQUE &&
    lum(j) >= BG_GRAD_MIN_LUM &&
    Math.abs(px[j * 4] - px[i * 4]) <= BG_GRAD_TOL &&
    Math.abs(px[j * 4 + 1] - px[i * 4 + 1]) <= BG_GRAD_TOL &&
    Math.abs(px[j * 4 + 2] - px[i * 4 + 2]) <= BG_GRAD_TOL;

  const visited = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  for (const i of border) {
    if (!visited[i] && (isBg(i) || (useGradient && px[i * 4 + 3] >= OPAQUE && lum(i) >= BG_GRAD_MIN_LUM))) {
      visited[i] = 1;
      stack[top++] = i;
    }
  }

  const knockedIdx: number[] = [];
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

  // A knockout that ate (almost) the whole frame leaked into the subject
  if (knockedIdx.length > W * H * MAX_KNOCK_SHARE) {
    return { image: out, status: 'reverted', knocked: 0 };
  }

  // A fill that reached the MIDDLE of the frame leaked into the subject
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

  // A fill that never made it around the frame found no real backdrop
  let borderKnocked = 0;
  for (const i of border) if (visited[i]) borderKnocked++;
  if (borderKnocked < border.length * MIN_BORDER_KNOCK_SHARE) {
    return { image: out, status: 'ragged-background', knocked: 0 };
  }

  for (const i of knockedIdx) px[i * 4 + 3] = 0;

  return { image: out, status: 'knocked-out', knocked: knockedIdx.length };
}

/**
 * Crop away fully-transparent margins so the photo fills its box on the board.
 * The canvas stretches each photo to the pedal's physical footprint, so leftover
 * padding would shrink and offset the pedal inside its own rect.
 *
 * Returns the input unchanged when there is nothing to trim or nothing opaque.
 */
export function trimTransparent(input: RgbaImage, alphaThreshold = 25): RgbaImage {
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

  if (maxX < 0) return input; // fully transparent - nothing to trim toward
  if (minX === 0 && minY === 0 && maxX === W - 1 && maxY === H - 1) return input;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y + minY) * W + minX) * 4;
    out.set(data.subarray(src, src + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/**
 * Knock out the background, then trim - the pipeline a pedal photo needs before
 * it can be drawn on the board. A trim that keeps almost nothing means the
 * knockout was wrong about what the subject was, so the trim is skipped.
 */
export function prepareSilhouette(input: RgbaImage): {
  image: RgbaImage;
  status: KnockoutStatus;
} {
  let { image, status } = knockOutBackground(input);
  // Gradient-following is what walks a fill into the subject. When that
  // happens, retry with a strict border-colour match: across the 14 pedal
  // photos this broke, it cut centre penetration from ~50-59% to 0% on most,
  // recovering the cut-out instead of giving up on it.
  if (status === 'subject-eaten') {
    ({ image, status } = knockOutBackground(input, false));
  }
  if (status !== 'knocked-out' && status !== 'already-cutout') {
    return { image, status };
  }
  const trimmed = trimTransparent(image);
  const tooSmall =
    trimmed.width < 8 ||
    trimmed.height < 8 ||
    trimmed.width * trimmed.height < input.width * input.height * 0.02;
  return { image: tooSmall ? image : trimmed, status };
}
