/**
 * A self-declaring fixture corpus for the knockout detector.
 *
 * Each specimen states the status it must produce, typed as KnockoutStatus,
 * so renaming or retiring a status breaks compilation here rather than
 * silently leaving a fixture asserting a value the engine no longer emits.
 * The corpus test additionally enforces coverage in both directions: every
 * status must have a specimen, and every specimen must produce its status.
 */
import type { KnockoutStatus, RgbaImage } from '../knockout';

type Rgba = [number, number, number, number];

export function image(
  width: number,
  height: number,
  at: (x: number, y: number) => Rgba
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

/** A dark pedal body on a white studio backdrop. */
export function pedalOnWhite(size = 40, inset = 10): RgbaImage {
  const inBody = (x: number, y: number) =>
    x >= inset && x < size - inset && y >= inset && y < size - inset;
  return image(size, size, (x, y) => (inBody(x, y) ? [30, 30, 35, 255] : [255, 255, 255, 255]));
}

/** Linear blend between two colours, rounded to bytes. */
function mix(a: [number, number, number], b: [number, number, number], t: number): Rgba {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

/**
 * A pedal with a bright COLOURED plate whose edge fades into the backdrop -
 * the BOSS DM-2W, reduced to its essentials.
 *
 * The soft band is not decoration: it is the whole mechanism. Traced on the
 * real photo (2026-08-03), the fill enters at (0,133) on white and walks a
 * pink halo up the pedal's left edge - sat 20, 26, 41, 45, 49, 51, 61, 76, 78
 * - onto the red plate at sat ~99, where the uniform colour lets it flood.
 * No single step exceeds BG_GRAD_TOL, so brightness alone never stops it, and
 * the damage is entirely in the TOP BAND where the centre guard cannot see it:
 * measured centre penetration 0.00%, top-band coverage 27.8% against 100%
 * in the middle.
 */
export function pedalWithColouredPlate(): RgbaImage {
  const WHITE: [number, number, number] = [252, 252, 252];
  const PLATE: [number, number, number] = [185, 86, 102]; // measured off the DM-2W
  const HALO0 = 16;
  const PEDAL_X = 32;
  return image(80, 60, (x, y) => {
    const inPedal = x >= PEDAL_X && x < 72 && y >= 10 && y < 50;
    if (inPedal) return y < 22 ? [...PLATE, 255] : [30, 30, 35, 255];
    // Pink halo cast on the backdrop beside the plate: 16 steps of <=11 per
    // channel, so every step chains.
    if (y >= 10 && y < 22 && x >= HALO0 && x < PEDAL_X) {
      return mix(WHITE, PLATE, (x - HALO0) / (PEDAL_X - HALO0));
    }
    return [...WHITE, 255];
  });
}

/**
 * A pedal on a neutral backdrop ramp, with a soft edge blending into it.
 *
 * The proportions are what make this a faithful specimen rather than a toy.
 * The body covers a QUARTER of the frame and its lower half is dark, so when
 * the fill walks in it eats 88.5% - under the 90% runaway floor - and the
 * failure surfaces as 'subject-eaten' from the centre guard, which is what the
 * real photos do. A small body instead trips the runaway revert first and the
 * fixture would be testing a different guard than the one that fires in
 * production.
 *
 * The soft edge blends toward the NEAREST body pixel, so the band beside the
 * dark lower half is dark too - a body-coloured halo there would be a glow no
 * photograph produces.
 */
function pedalOnRamp(
  body: [number, number, number],
  rampTop: number,
  rampBottom: number
): RgbaImage {
  const DARK: [number, number, number] = [25, 25, 30];
  const BAND = 16;
  const X0 = 24;
  const X1 = 72;
  const Y0 = 24;
  const Y1 = 72;
  /** Everything from here down is the dark half of the body. */
  const DARK_Y = 50;
  const colourAt = (x: number, y: number) => (y >= DARK_Y ? DARK : body);
  return image(96, 96, (x, y) => {
    if (x >= X0 && x < X1 && y >= Y0 && y < Y1) return [...colourAt(x, y), 255];
    const v = Math.round(rampTop - ((rampTop - rampBottom) * y) / 95);
    const back: [number, number, number] = [v, v, v];
    const d = Math.max(X0 - x, 0, x - (X1 - 1), Y0 - y, 0, y - (Y1 - 1));
    if (d >= BAND) return [...back, 255];
    // Nearest body pixel, so the halo matches the edge it sits against
    const nx = Math.min(Math.max(x, X0), X1 - 1);
    const ny = Math.min(Math.max(y, Y0), Y1 - 1);
    return mix(back, colourAt(nx, ny), (BAND - d) / BAND);
  });
}

/**
 * A strongly COLOURED body on a neutral backdrop that ramps far past BG_TOL -
 * the Strymon BigSky.
 *
 * Traced on the real photo: the fill runs along the backdrop at sat 0, then
 * steps onto the pedal through sat 70 -> 115 -> 127 -> 224 and hollows it out
 * (centre penetration 35.75%). Being rejected as 'subject-eaten' is what sends
 * the pipeline to the strict pass, and the strict pass cannot span the ramp -
 * so the dark end of the backdrop survives as the grey box the owner saw.
 */
export function colouredPedalOnRamp(): RgbaImage {
  return pedalOnRamp([90, 120, 235], 240, 90);
}

/**
 * A NEUTRAL body on a NEUTRAL backdrop ramp - the Strymon Timeline, and the
 * case colour cannot solve.
 *
 * Traced on the real photo: the fill walks from the border to the centre
 * through pixels of saturation 0,0,4,5,4,5,3,3,3,3,3,3,3,3. Of the 1,243,441
 * pixels it absorbed, 621 (0.0%) had saturation above 24. A silver enclosure
 * lit by a neutral studio ramp is the same colour as its own backdrop, so no
 * saturation threshold separates them.
 */
export function neutralPedalOnNeutralRamp(): RgbaImage {
  return pedalOnRamp([140, 140, 142], 255, 200);
}

/**
 * Every status the detector can return. A Record keyed by the union is the
 * type-link: omitting a status, or inventing one, fails to compile. Its keys
 * are the runtime list the coverage assertion iterates.
 */
export const ALL_STATUSES: Record<KnockoutStatus, true> = {
  'knocked-out': true,
  'already-cutout': true,
  'no-background': true,
  'ragged-background': true,
  'subject-eaten': true,
  reverted: true,
};

export interface Specimen {
  name: string;
  /** The status this image is built to produce. */
  expected: KnockoutStatus;
  /** Why this image produces it - the reason the specimen exists. */
  why: string;
  build: () => RgbaImage;
}

export const SPECIMENS: Specimen[] = [
  {
    name: 'dark pedal on white studio backdrop',
    expected: 'knocked-out',
    why: 'The ordinary case: a uniform backdrop the border flood reaches everywhere.',
    build: () => pedalOnWhite(),
  },
  {
    name: 'pedal on a backdrop that fades 245 -> 120',
    expected: 'knocked-out',
    why: 'Gradient-following must carry the fill past BG_TOL to the far edge.',
    build: () =>
      image(40, 40, (x, y) => {
        if (x >= 12 && x < 28 && y >= 12 && y < 28) return [20, 20, 20, 255];
        const v = Math.round(245 - (125 * y) / 39);
        return [v, v, v, 255];
      }),
  },
  {
    name: 'pedal on evenly textured wood grain',
    expected: 'knocked-out',
    why: 'A real upload surface. Texture within BG_GRAD_TOL still clears fully.',
    build: () =>
      image(60, 60, (x, y) => {
        if (x >= 20 && x < 40 && y >= 20 && y < 40) return [30, 30, 35, 255];
        const g = Math.round(Math.sin(y * 0.7) * 8);
        return [160 + g, 120 + g, 80 + g, 255];
      }),
  },
  {
    name: 'image that already ships an alpha silhouette',
    expected: 'already-cutout',
    why: 'Mirrored BOSS/Ibanez PNGs arrive cut out; re-knocking them is wasted work.',
    build: () =>
      image(40, 40, (x, y) => {
        const inBody = x >= 10 && x < 30 && y >= 10 && y < 30;
        return inBody ? [30, 30, 35, 255] : [0, 0, 0, 0];
      }),
  },
  {
    name: 'image too small to have an interior',
    expected: 'no-background',
    why:
      'Below 3x3 there is no non-border pixel, so "background" is not a ' +
      'meaningful question. This is the ONLY reachable producer of this ' +
      'status - see the note in knockout.ts on the unreachable !n branch.',
    build: () => image(2, 2, () => [255, 255, 255, 255]),
  },
  {
    name: 'busy multicoloured background',
    expected: 'ragged-background',
    why:
      'The fill nibbles ~6% of pixels and stalls near 55% of the border. ' +
      'Applying that would punch random transparent holes in a user photo.',
    build: () =>
      image(40, 40, (x, y) => [(x * 37) % 256, (y * 91) % 256, (x * y * 13) % 256, 255]),
  },
  {
    name: 'body reachable only by following the backdrop gradient',
    expected: 'subject-eaten',
    why:
      'The body is far outside BG_TOL of the backdrop, so a strict fill stops ' +
      'at its edge - but a smooth ramp lets gradient-chaining walk all the way ' +
      'in and hollow out the centre. This is what made BF-3 and PH-3 render as ' +
      'black blobs: only their dark knobs and footswitch survived. ' +
      'prepareSilhouette retries without gradient following and recovers it.',
    build: () =>
      image(40, 40, (x, y) => {
        // dark block: keeps survivors above the runaway-revert floor
        if (x >= 24 && x < 38 && y >= 24 && y < 38) return [30, 30, 30, 255];
        const d = Math.max(Math.abs(x - 16), Math.abs(y - 16));
        if (d < 4) return [150, 150, 150, 255];
        if (d < 12) { const v = 150 + (d - 4) * 12; return [v, v, v, 255]; }
        return [255, 255, 255, 255];
      }),
  },
  {
    name: 'uniform white frame with no subject',
    expected: 'reverted',
    why: 'The fill would eat the whole frame, leaving nothing to draw.',
    build: () => image(40, 40, () => [255, 255, 255, 255]),
  },
];
