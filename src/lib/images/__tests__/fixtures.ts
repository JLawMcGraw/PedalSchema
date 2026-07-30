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
    name: 'uniform white frame with no subject',
    expected: 'reverted',
    why: 'The fill would eat the whole frame, leaving nothing to draw.',
    build: () => image(40, 40, () => [255, 255, 255, 255]),
  },
];
