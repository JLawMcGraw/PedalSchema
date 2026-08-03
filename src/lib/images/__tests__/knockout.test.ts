/**
 * Pixel-outcome tests: what SURVIVES and what CLEARS.
 *
 * The status each fixture returns is asserted by the corpus in
 * ./corpus.test.ts. These are the complementary assertions a status label
 * cannot capture - an interior knob staying opaque, a shadow ring not being
 * crossed - so both files are needed and neither subsumes the other.
 */
import { describe, expect, it } from 'vitest';
import {
  knockOutBackground,
  prepareSilhouette,
  trimTransparent,
  type RgbaImage,
} from '../knockout';
import {
  colouredPedalOnRamp,
  image,
  neutralPedalOnNeutralRamp,
  pedalOnWhite,
  pedalWithColouredPlate,
} from './fixtures';

const alphaAt = (img: RgbaImage, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3];

describe('knockOutBackground', () => {
  it('makes a white studio background transparent and leaves the body opaque', () => {
    const { image: out, status, knocked } = knockOutBackground(pedalOnWhite());

    expect(status).toBe('knocked-out');
    // 40x40 frame, 20x20 body => 1600 - 400 = 1200 background pixels
    expect(knocked).toBe(1200);
    expect(alphaAt(out, 0, 0)).toBe(0); // corner: background
    expect(alphaAt(out, 20, 20)).toBe(255); // centre: body
    expect(alphaAt(out, 10, 10)).toBe(255); // body's top-left corner
    expect(alphaAt(out, 9, 9)).toBe(0); // pixel just outside it
  });

  it('does not modify the input buffer', () => {
    const input = pedalOnWhite();
    const before = new Uint8ClampedArray(input.data);
    knockOutBackground(input);
    expect(input.data).toEqual(before);
  });

  it('keeps light interior details that are not edge-connected', () => {
    // Dark body with a white knob in the middle: same colour as the backdrop,
    // but unreachable from the border without crossing the body.
    const img = image(40, 40, (x, y) => {
      const inBody = x >= 10 && x < 30 && y >= 10 && y < 30;
      if (!inBody) return [255, 255, 255, 255];
      const inKnob = x >= 18 && x < 22 && y >= 18 && y < 22;
      return inKnob ? [255, 255, 255, 255] : [30, 30, 35, 255];
    });

    const { image: out, status } = knockOutBackground(img);

    expect(status).toBe('knocked-out');
    expect(alphaAt(out, 19, 19)).toBe(255); // white knob survives
    expect(alphaAt(out, 0, 0)).toBe(0); // white backdrop does not
  });

  it('follows a smooth backdrop gradient all the way to the body', () => {
    // Backdrop fades 245 -> 120 top to bottom; far outside BG_TOL of the border
    // average, so only gradient-chaining can clear it.
    const img = image(40, 40, (x, y) => {
      const inBody = x >= 12 && x < 28 && y >= 12 && y < 28;
      if (inBody) return [20, 20, 20, 255];
      const v = Math.round(245 - (125 * y) / 39);
      return [v, v, v, 255];
    });

    const { image: out, status } = knockOutBackground(img);

    expect(status).toBe('knocked-out');
    expect(alphaAt(out, 20, 39)).toBe(0); // darkest backdrop row cleared
    expect(alphaAt(out, 20, 20)).toBe(255); // body intact
  });

  it('does not creep through a drop shadow into the enclosure', () => {
    // Mid-grey shadow ring (luminance below BG_GRAD_MIN_LUM) around a black body.
    const img = image(40, 40, (x, y) => {
      const d = Math.max(Math.abs(x - 20), Math.abs(y - 20));
      if (d < 8) return [10, 10, 10, 255]; // body
      if (d < 11) return [70, 70, 70, 255]; // shadow, lum 70 < 90
      return [250, 250, 250, 255]; // backdrop
    });

    const { image: out } = knockOutBackground(img);

    expect(alphaAt(out, 20, 10)).toBe(255); // shadow ring kept
    expect(alphaAt(out, 20, 20)).toBe(255); // body kept
    expect(alphaAt(out, 0, 0)).toBe(0); // backdrop cleared
  });

  it('leaves an image that is already a silhouette untouched', () => {
    const img = image(40, 40, (x, y) => {
      const inBody = x >= 10 && x < 30 && y >= 10 && y < 30;
      return inBody ? [30, 30, 35, 255] : [0, 0, 0, 0];
    });

    const { status, knocked } = knockOutBackground(img);

    expect(status).toBe('already-cutout');
    expect(knocked).toBe(0);
  });

  it('reverts a fill that would eat the whole frame', () => {
    // A uniform white image has no subject: clearing it would leave nothing.
    const img = image(40, 40, () => [255, 255, 255, 255]);

    const { image: out, status, knocked } = knockOutBackground(img);

    expect(status).toBe('reverted');
    expect(knocked).toBe(0);
    expect(alphaAt(out, 20, 20)).toBe(255);
  });

  it('discards a ragged fill on a busy background instead of speckling it', () => {
    // Loud multicoloured background: the fill nibbles ~6% of pixels and stalls
    // at ~55% of the border. Applying that would punch random holes in a photo.
    const img = image(40, 40, (x, y) => [(x * 37) % 256, (y * 91) % 256, (x * y * 13) % 256, 255]);

    const { image: out, status, knocked } = knockOutBackground(img);

    expect(status).toBe('ragged-background');
    expect(knocked).toBe(0);
    // Every pixel still opaque - the photo is returned untouched
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        expect(alphaAt(out, x, y)).toBe(255);
      }
    }
  });

  it('does not chain off the backdrop onto a bright coloured pedal feature', () => {
    // The DM-2W: a soft pink halo beside the red plate lets the fill walk in
    // one small step at a time and flood the plate. Every step is within
    // BG_GRAD_TOL and every pixel is above BG_GRAD_MIN_LUM, so only COLOUR
    // distinguishes the plate from the backdrop it is standing on.
    const { image: out, status } = knockOutBackground(pedalWithColouredPlate());

    expect(status).toBe('knocked-out');
    expect(alphaAt(out, 0, 0)).toBe(0); // real backdrop still cleared
    expect(alphaAt(out, 52, 16)).toBe(255); // the plate survives
    expect(alphaAt(out, 34, 16)).toBe(255); // including its outermost column
    expect(alphaAt(out, 52, 40)).toBe(255); // dark body untouched, as before

    // The whole plate, not just the sampled pixels: this is the band that
    // measured 27.8% coverage on the real photo.
    let opaque = 0;
    for (let y = 10; y < 22; y++) {
      for (let x = 32; x < 72; x++) if (alphaAt(out, x, y) === 255) opaque++;
    }
    expect(opaque).toBe(12 * 40);
  });

  it('clears a backdrop ramp without hollowing out a coloured body', () => {
    // The BigSky. Chaining is REQUIRED here (the ramp runs far outside BG_TOL),
    // so the fix must not simply refuse to chain - it must chain along the
    // neutral backdrop and stop at the colour.
    const { image: out, status } = knockOutBackground(colouredPedalOnRamp());

    expect(status).toBe('knocked-out');
    expect(alphaAt(out, 48, 95)).toBe(0); // darkest end of the ramp cleared
    expect(alphaAt(out, 48, 0)).toBe(0); // lightest end cleared
    expect(alphaAt(out, 48, 48)).toBe(255); // body intact
  });

  it('cannot separate a neutral body from a neutral backdrop - the Timeline', () => {
    // Documents the LIMIT of the colour test, so that nobody reads the two
    // cases above and assumes the knockout now handles every studio photo.
    // A silver enclosure on a neutral ramp offers no colour difference to
    // measure; the fill walks in and the centre guard is what stops it, which
    // sends the pipeline to the strict pass and leaves the backdrop's dark end.
    // Strymon Timeline is held at mode:'skip' in mirror-pedal-images.js for
    // exactly this reason. If this test ever fails, the knockout got better -
    // re-run .claude/scripts/knockout-targets.js and lift the override.
    const { status } = knockOutBackground(neutralPedalOnNeutralRamp());

    expect(status).toBe('subject-eaten');
  });

  it('still clears an evenly textured surface, like a pedal on wood or carpet', () => {
    const img = image(60, 60, (x, y) => {
      if (x >= 20 && x < 40 && y >= 20 && y < 40) return [30, 30, 35, 255];
      const grain = Math.round(Math.sin(y * 0.7) * 8);
      return [160 + grain, 120 + grain, 80 + grain, 255];
    });

    const { image: out, status, knocked } = knockOutBackground(img);

    expect(status).toBe('knocked-out');
    expect(knocked).toBe(60 * 60 - 20 * 20); // the whole surface, none of the pedal
    expect(alphaAt(out, 0, 0)).toBe(0);
    expect(alphaAt(out, 30, 30)).toBe(255);
  });
});

describe('trimTransparent', () => {
  it('crops transparent margins down to the opaque subject', () => {
    const img = image(40, 40, (x, y) => {
      const inBody = x >= 10 && x < 30 && y >= 12 && y < 32;
      return inBody ? [30, 30, 35, 255] : [0, 0, 0, 0];
    });

    const out = trimTransparent(img);

    expect([out.width, out.height]).toEqual([20, 20]);
    expect(alphaAt(out, 0, 0)).toBe(255);
    expect(alphaAt(out, 19, 19)).toBe(255);
  });

  it('returns the image unchanged when it has no transparent margin', () => {
    const img = image(10, 10, () => [1, 2, 3, 255]);
    expect(trimTransparent(img)).toBe(img);
  });

  it('returns the image unchanged when nothing is opaque', () => {
    const img = image(10, 10, () => [0, 0, 0, 0]);
    expect(trimTransparent(img)).toBe(img);
  });
});

describe('prepareSilhouette', () => {
  it('knocks out and trims in one pass, leaving the body filling the frame', () => {
    const { image: out, status } = prepareSilhouette(pedalOnWhite());

    expect(status).toBe('knocked-out');
    expect([out.width, out.height]).toEqual([20, 20]);
    // Every pixel of the result is body
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        expect(alphaAt(out, x, y)).toBe(255);
      }
    }
  });

  it('skips the trim when it would keep almost nothing', () => {
    // One stray opaque speck on white: knockout leaves a 1px subject, and
    // cropping to it would be a worse result than leaving the frame alone.
    const img = image(40, 40, (x, y) =>
      x === 20 && y === 20 ? [10, 10, 10, 255] : [255, 255, 255, 255]
    );

    const { image: out } = prepareSilhouette(img);

    expect([out.width, out.height]).toEqual([40, 40]);
  });

  it('passes a reverted knockout through at full size', () => {
    const img = image(40, 40, () => [255, 255, 255, 255]);

    const { image: out, status } = prepareSilhouette(img);

    expect(status).toBe('reverted');
    expect([out.width, out.height]).toEqual([40, 40]);
  });
});

describe('prepareSilhouette two-pass recovery', () => {
  /**
   * A body far outside BG_TOL of the backdrop, reachable ONLY by following a
   * smooth ramp. This isolates the mechanism: the gradient pass walks the ramp
   * into the body and hollows it out; the strict pass stops at the body edge.
   * The real BF-3/PH-3 photos fail exactly this way.
   */
  const rampIntoBody = () =>
    image(40, 40, (x, y) => {
      if (x >= 24 && x < 38 && y >= 24 && y < 38) return [30, 30, 30, 255];
      const d = Math.max(Math.abs(x - 16), Math.abs(y - 16));
      if (d < 4) return [150, 150, 150, 255];
      if (d < 12) { const v = 150 + (d - 4) * 12; return [v, v, v, 255]; }
      return [255, 255, 255, 255];
    });

  it('the gradient pass alone eats the subject', () => {
    expect(knockOutBackground(rampIntoBody()).status).toBe('subject-eaten');
  });

  it('a pedal whose body differs clearly from the backdrop still uses one pass', () => {
    // The common case must not be pushed down the strict path unnecessarily.
    const { status } = prepareSilhouette(pedalOnWhite());
    expect(status).toBe('knocked-out');
  });

  it('the strict pass recovers the same image', () => {
    // Not merely "does not fail" - it must actually produce a cut-out.
    const strict = knockOutBackground(rampIntoBody(), false);
    expect(strict.status).toBe('knocked-out');
    expect(strict.knocked).toBeGreaterThan(0);
  });

  it('prepareSilhouette runs both passes so callers never see the failure', () => {
    expect(prepareSilhouette(rampIntoBody()).status).toBe('knocked-out');
  });
});
