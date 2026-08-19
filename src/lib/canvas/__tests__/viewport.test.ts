/**
 * Viewport mathematics.
 *
 * These run in NODE with no DOM, which is the whole reason `viewport.ts` is
 * pure. The browser seam it feeds - getBoundingClientRect, ResizeObserver,
 * pointer capture, passive listeners - is not testable here and is covered by
 * `.claude/scripts/verify-viewport.js` instead. Adding jsdom would not change
 * that: it performs no layout and has no getScreenCTM, so nothing about SVG
 * viewport fitting is representable in it.
 */
import { describe, it, expect } from 'vitest';
import {
  WORLD_UNITS_PER_INCH,
  PADDING_PX,
  MAX_ZOOM,
  fitScale,
  letterbox,
  userToOffset,
  offsetToUser,
  offsetToInches,
  inchesToOffset,
  viewBoxFor,
  contentBounds,
  fitZoom,
  fitPan,
  clampZoom,
  clampPan,
  panForZoomAt,
  panByPixels,
  wheelIntent,
  type ViewBox,
  type Size,
  type Bounds,
} from '../viewport';
import { INCHES_TO_PIXELS } from '@/store/derived';

/** The board that motivated all of this: Pedaltrain Classic Pro, 32x16in. */
const CLASSIC_PRO: ViewBox = { minX: -80, minY: -80, width: 1440, height: 800 };

describe('the scale is the same one the rest of the app draws at', () => {
  it('WORLD_UNITS_PER_INCH matches INCHES_TO_PIXELS', () => {
    // viewport.ts deliberately does not import derived.ts (it must stay
    // dependency-free to be testable in node). This is what stops the
    // duplication drifting.
    expect(WORLD_UNITS_PER_INCH).toBe(INCHES_TO_PIXELS);
  });
});

describe('letterbox-aware mapping', () => {
  it('computes the fit scale and the centring bars', () => {
    // Width-constrained: 900/1440 < 600/800, so bars appear top and bottom.
    const el: Size = { width: 900, height: 600 };
    expect(fitScale(CLASSIC_PRO, el)).toBeCloseTo(0.625, 10);
    expect(letterbox(CLASSIC_PRO, el).x).toBeCloseTo(0, 10);
    expect(letterbox(CLASSIC_PRO, el).y).toBeCloseTo(50, 10);
  });

  it('has ZERO letterbox when the aspects agree - the twin.js degeneration', () => {
    // This is the property that lets `.claude/scripts/lib/twin.js` keep working
    // byte-identical once the viewBox aspect is matched to the element.
    const el: Size = { width: 1440, height: 800 };
    expect(letterbox(CLASSIC_PRO, el).x).toBe(0);
    expect(letterbox(CLASSIC_PRO, el).y).toBe(0);
  });

  it('round-trips offset -> user -> offset across zoom, pan and viewport shape', () => {
    const els: Size[] = [
      { width: 1440, height: 900 },
      { width: 600, height: 900 },   // very narrow
      { width: 2000, height: 300 },  // very wide
      { width: 320, height: 480 },   // phone
    ];
    const pans = [{ x: 0, y: 0 }, { x: 120, y: -80 }, { x: -300, y: 410 }];
    const zooms = [0.1, 0.25, 0.5, 1, 1.6, 4];

    for (const el of els) {
      for (const pan of pans) {
        for (const zoom of zooms) {
          const vb = viewBoxFor(pan, zoom, el, CLASSIC_PRO);
          const samples = [
            { x: 0, y: 0 }, { x: el.width, y: 0 }, { x: 0, y: el.height },
            { x: el.width, y: el.height }, { x: el.width / 2, y: 0 },
            { x: 0, y: el.height / 2 }, { x: el.width, y: el.height / 2 },
            { x: el.width / 2, y: el.height }, { x: el.width / 2, y: el.height / 2 },
          ];
          for (const s of samples) {
            const u = offsetToUser(vb, el, s.x, s.y);
            const back = userToOffset(vb, el, u.x, u.y);
            expect(back.x).toBeCloseTo(s.x, 9);
            expect(back.y).toBeCloseTo(s.y, 9);
          }
        }
      }
    }
  });

  it('inchesToOffset is the exact inverse of offsetToInches', () => {
    const el: Size = { width: 1100, height: 700 };
    const vb = viewBoxFor({ x: 40, y: -25 }, 0.8, el, CLASSIC_PRO);
    for (const p of [{ x: 0, y: 0 }, { x: 16, y: 8 }, { x: 31.5, y: 15.9 }]) {
      const off = inchesToOffset(vb, el, p.x, p.y);
      const back = offsetToInches(vb, el, off.x, off.y);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe('the bug this module was written to end', () => {
  it('maps the recorded case correctly', () => {
    /*
     * Element 600x900, viewBox -80 -80 1440 800, click 300px right and 450px
     * down of the element origin.
     *
     *   fitScale = min(600/1440, 900/800) = 0.41667
     *   letterbox = (0, 283.33)
     *   x = (300 - 0)/0.41667 + (-80) = 640 world px = 16.0 in
     *   y = (450 - 283.33)/0.41667 + (-80) = 320 world px = 8.0 in
     *
     * THE PRE-FIX CODE RETURNED {5.5, 9.25} - a 2.9x error in x. It divided by
     * `zoom` instead of `zoom * fitScale` and ignored the letterbox entirely.
     */
    const el: Size = { width: 600, height: 900 };
    const got = offsetToInches(CLASSIC_PRO, el, 300, 450);
    expect(got.x).toBeCloseTo(16, 6);
    expect(got.y).toBeCloseTo(8, 6);

    const buggy = { x: 300 / 40 - 2, y: 450 / 40 - 2 };
    expect(buggy).toEqual({ x: 5.5, y: 9.25 });
    expect(Math.abs(got.x - buggy.x)).toBeGreaterThan(10);
  });

  it('adds pan rather than subtracting it', () => {
    // viewBox minX is `-PADDING_PX + pan.x`, so a POSITIVE pan must yield a
    // LARGER board x for a fixed offset. The old code subtracted it; the sign
    // was latent only because pan was permanently {0,0}.
    const el: Size = { width: 1440, height: 800 };
    const at0 = offsetToInches(viewBoxFor({ x: 0, y: 0 }, 1, el, CLASSIC_PRO), el, 500, 300);
    const at80 = offsetToInches(viewBoxFor({ x: 80, y: 0 }, 1, el, CLASSIC_PRO), el, 500, 300);
    expect(at80.x - at0.x).toBeCloseTo(2, 9); // 80 world px = 2 inches
  });

  it('moves a dragged pedal at the cursor rate, not fitScale x the cursor rate', () => {
    /*
     * The property a user actually feels. Measured against the real app before
     * the fix (J$ Home, 80px drag):
     *
     *   viewport 1440x900  fitScale 1.0182  measured 2.0000in  correct 1.9643in
     *   viewport 1100x800  fitScale 0.7045  measured 2.0000in  correct 2.8387in
     *   viewport  700x900  fitScale 0.7955  measured 2.0000in  correct 2.5143in
     *
     * measured/correct equalled fitScale in every case - the pedal tracked the
     * cursor at 70% of its distance on a 1100x800 window.
     */
    // The 1100x800 row above, reconstructed exactly: J$ Home is 18x12.5in, so
    // the CURRENT viewBox is -80 -80 880 660, measured into a 620x696 canvas.
    const el: Size = { width: 620, height: 696 };
    const currentFormulaViewBox: ViewBox = { minX: -80, minY: -80, width: 880, height: 660 };
    const s = fitScale(currentFormulaViewBox, el);
    expect(s).toBeCloseTo(0.7045, 4); // the fitScale measured in the browser

    for (const dPx of [10, 80, 250]) {
      const a = offsetToInches(currentFormulaViewBox, el, 100, 100);
      const b = offsetToInches(currentFormulaViewBox, el, 100 + dPx, 100);
      expect(b.x - a.x).toBeCloseTo(dPx / (WORLD_UNITS_PER_INCH * s), 9);
      // ...and NOT the old behaviour, which ignored fitScale entirely.
      expect(b.x - a.x).not.toBeCloseTo(dPx / WORLD_UNITS_PER_INCH, 3);
    }
    // The headline number: an 80px drag should move the pedal 2.84in, not 2.00in.
    const a = offsetToInches(currentFormulaViewBox, el, 100, 100);
    const b = offsetToInches(currentFormulaViewBox, el, 180, 100);
    expect(b.x - a.x).toBeCloseTo(2.8387, 3);

    // NOTE for whoever reads this after P1: once the viewBox aspect is matched
    // to the element, fitScale is 1 BY CONSTRUCTION and the two formulas
    // coincide. That is why this test pins the pre-P1 viewBox shape explicitly
    // rather than building one with viewBoxFor - otherwise it would silently
    // stop testing anything.
  });
});

describe('zoom-to-cursor', () => {
  it('leaves the world point under the anchor exactly where it was', () => {
    const el: Size = { width: 1200, height: 800 };
    const anchors = [
      { x: 0, y: 0 }, { x: 1200, y: 800 }, { x: 600, y: 400 },
      { x: -50, y: 120 }, // pointers do leave the element mid-gesture
    ];
    for (const anchor of anchors) {
      for (const [zOld, zNew] of [[1, 1.2], [1, 0.5], [0.3, 4], [2.5, 2.5]]) {
        const panOld = { x: 30, y: -60 };
        const panNew = panForZoomAt(panOld, zOld, zNew, anchor);
        const before = offsetToUser(viewBoxFor(panOld, zOld, el, CLASSIC_PRO), el, anchor.x, anchor.y);
        const after = offsetToUser(viewBoxFor(panNew, zNew, el, CLASSIC_PRO), el, anchor.x, anchor.y);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
    }
  });
});

describe('bounds policy', () => {
  const content: Bounds = contentBounds(32, 16);

  it('force-centres an axis whose visible extent covers the content', () => {
    // Zoomed out past fit: pan is not user-controllable, so the board cannot
    // drift off into grey. Any input must produce the same centred answer.
    const el: Size = { width: 1440, height: 800 };
    const zoom = fitZoom(content, el) / 2;
    const a = clampPan({ x: 9999, y: -9999 }, zoom, el, content);
    const b = clampPan({ x: -9999, y: 9999 }, zoom, el, content);
    expect(a).toEqual(b);
  });

  it('is idempotent', () => {
    const el: Size = { width: 800, height: 600 };
    const once = clampPan({ x: 4000, y: 4000 }, 2, el, content);
    expect(clampPan(once, 2, el, content)).toEqual(once);
  });

  it('never produces NaN for degenerate inputs', () => {
    const el: Size = { width: 0, height: 0 };
    for (const p of [clampPan({ x: 5, y: 5 }, 0, el, content), clampPan({ x: 5, y: 5 }, 1, el, content)]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('keeps Fit reachable on a small canvas', () => {
    // A fixed 0.25 floor would forbid fitting the largest board on a phone.
    const phone: Size = { width: 320, height: 480 };
    const fit = fitZoom(content, phone);
    expect(fit).toBeLessThan(0.25);
    expect(clampZoom(fit, phone, content)).toBeCloseTo(fit, 9);
  });

  it('clamps zoom to the ceiling and rejects nonsense', () => {
    const el: Size = { width: 1000, height: 800 };
    expect(clampZoom(99, el, content)).toBe(MAX_ZOOM);
    expect(clampZoom(0, el, content)).toBe(1);
    expect(clampZoom(Number.NaN, el, content)).toBe(1);
  });

  it('fitPan centres the content it was given', () => {
    const el: Size = { width: 1000, height: 800 };
    const z = fitZoom(content, el);
    const pan = fitPan(content, el, z);
    const vb = viewBoxFor(pan, z, el, CLASSIC_PRO);
    const centreOfContent = { x: content.minX + content.width / 2, y: content.minY + content.height / 2 };
    const centreOfView = { x: vb.minX + vb.width / 2, y: vb.minY + vb.height / 2 };
    expect(centreOfView.x).toBeCloseTo(centreOfContent.x, 6);
    expect(centreOfView.y).toBeCloseTo(centreOfContent.y, 6);
  });

  it('panByPixels moves by the pixel delta at the current zoom', () => {
    expect(panByPixels({ x: 0, y: 0 }, 2, 100, -50)).toEqual({ x: 50, y: -25 });
  });
});

describe('contentBounds keeps the off-board glyphs reachable', () => {
  it('contains external endpoints that sit outside the padded board', () => {
    // The guitar and amp glyphs are drawn outside the board box. If content were
    // defined as board+padding, they would fall behind the pan clamp at high zoom.
    const external = [{ x: -240, y: 300 }, { x: 1500, y: 120 }];
    const b = contentBounds(32, 16, external);
    for (const p of external) {
      expect(p.x).toBeGreaterThan(b.minX);
      expect(p.x).toBeLessThan(b.minX + b.width);
      expect(p.y).toBeGreaterThan(b.minY);
      expect(p.y).toBeLessThan(b.minY + b.height);
    }
  });
});

describe('wheel classification', () => {
  const el: Size = { width: 1000, height: 800 };
  const base = { ctrlKey: false, metaKey: false, shiftKey: false, deltaX: 0, deltaY: 0, deltaMode: 0 };

  it('treats ctrl/meta as zoom - which is also how a trackpad pinch arrives', () => {
    expect(wheelIntent({ ...base, ctrlKey: true, deltaY: -100 }, el).kind).toBe('zoom');
    expect(wheelIntent({ ...base, metaKey: true, deltaY: 100 }, el).kind).toBe('zoom');
  });

  it('zoom direction: wheel up magnifies', () => {
    const up = wheelIntent({ ...base, ctrlKey: true, deltaY: -100 }, el);
    const down = wheelIntent({ ...base, ctrlKey: true, deltaY: 100 }, el);
    if (up.kind !== 'zoom' || down.kind !== 'zoom') throw new Error('expected zoom');
    expect(up.factor).toBeGreaterThan(1);
    expect(down.factor).toBeLessThan(1);
  });

  it('normalises deltaMode - LINE and PAGE are not pixels', () => {
    const px = wheelIntent({ ...base, deltaY: 3, deltaMode: 0 }, el);
    const line = wheelIntent({ ...base, deltaY: 3, deltaMode: 1 }, el);
    const page = wheelIntent({ ...base, deltaY: 1, deltaMode: 2 }, el);
    if (px.kind !== 'pan' || line.kind !== 'pan' || page.kind !== 'pan') throw new Error('expected pan');
    expect(px.dy).toBe(3);
    expect(line.dy).toBe(48);
    expect(page.dy).toBe(800);
  });

  it('shift turns a vertical wheel horizontal', () => {
    const r = wheelIntent({ ...base, shiftKey: true, deltaY: 60 }, el);
    if (r.kind !== 'pan') throw new Error('expected pan');
    expect(r.dx).toBe(60);
    expect(r.dy).toBe(0);
  });
});

describe('twin.js parity - the consumer contract', () => {
  it('agrees with the harness mapping that 15 verify scripts depend on', () => {
    /*
     * THIS IS A DELIBERATE COPY of `.claude/scripts/lib/twin.js` toScreen().
     * That file runs in node against a live browser and cannot import from
     * here, so the only way to stop the two drifting is to assert them equal.
     * If you change the mapping in viewport.ts, this fails in `npm test` -
     * which is the point. Do not "fix" it by editing the copy.
     */
    const twinToScreen = (
      vb: ViewBox, rect: Size, bxInches: number, byInches: number
    ): { x: number; y: number } => {
      const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
      const SCALE_PX_PER_INCH = 40;
      return {
        x: (rect.width - vb.width * scale) / 2 + (bxInches * SCALE_PX_PER_INCH - vb.minX) * scale,
        y: (rect.height - vb.height * scale) / 2 + (byInches * SCALE_PX_PER_INCH - vb.minY) * scale,
      };
    };

    const cases: Array<[ViewBox, Size]> = [
      [CLASSIC_PRO, { width: 900, height: 600 }],    // letterboxed
      [CLASSIC_PRO, { width: 1440, height: 800 }],   // aspect-matched
      [{ minX: -80, minY: -80, width: 800, height: 900 }, { width: 620, height: 696 }],
    ];
    for (const [vb, el] of cases) {
      for (const p of [{ x: 0, y: 0 }, { x: 16, y: 8 }, { x: 31.5, y: 15.5 }]) {
        const mine = inchesToOffset(vb, el, p.x, p.y);
        const theirs = twinToScreen(vb, el, p.x, p.y);
        expect(mine.x).toBeCloseTo(theirs.x, 9);
        expect(mine.y).toBeCloseTo(theirs.y, 9);
      }
    }
  });
});

describe('viewBoxFor', () => {
  it('returns the fallback verbatim before the element is measured', () => {
    // Stable first render: the attribute must not change between SSR and
    // hydration or React 19 reports a mismatch.
    expect(viewBoxFor({ x: 0, y: 0 }, 1, { width: 0, height: 0 }, CLASSIC_PRO)).toEqual(CLASSIC_PRO);
  });

  it('matches the element aspect, which is what zeroes the letterbox', () => {
    const el: Size = { width: 1100, height: 700 };
    const vb = viewBoxFor({ x: 0, y: 0 }, 0.5, el, CLASSIC_PRO);
    expect(vb.width / vb.height).toBeCloseTo(el.width / el.height, 9);
    expect(letterbox(vb, el).x).toBeCloseTo(0, 9);
    expect(letterbox(vb, el).y).toBeCloseTo(0, 9);
    expect(vb.minX).toBe(-PADDING_PX);
  });
});
