/**
 * The sparse-grid search finds a route exactly when one exists.
 *
 * That sentence is the whole reason it replaced the dense 8px A*, which found
 * a route only when one existed AND was about 0.9in wide: measured on
 * 2026-11-16, a straight run through a 14, 20, 24, 28 or 32px gap was legal by
 * the validation policy and the dense grid refused every one. The placer packs
 * pedals 20px apart side to side and 14px row to row.
 *
 * "Exactly when one exists" is checked two ways here:
 *
 *   by hand    gaps from 12px (illegal: two margins, touching) upward, one
 *              pixel either side of the limit
 *   by oracle  seeded random fields, against a flood fill over every
 *              half-pixel of the board. The oracle knows nothing about lines
 *              or corners - it only asks which points are far enough from
 *              every pedal - so agreeing with it is not agreeing with itself.
 */
import { describe, it, expect } from 'vitest';
import type { Box, BoardBounds, Point } from '../../geometry';
import { OBSTACLE_MARGIN, lineIntersectsBox } from '../../geometry';
import { findOrthogonalPath } from '../sparse-grid';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/** Every segment axis-aligned and a full margin clear of every box. */
function expectLegal(path: Point[], boxes: Box[]): void {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    expect(
      Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
      `diagonal segment (${a.x},${a.y})->(${b.x},${b.y})`
    ).toBe(true);
    for (const obstacle of boxes) {
      expect(
        lineIntersectsBox(a, b, obstacle, OBSTACLE_MARGIN),
        `segment (${a.x},${a.y})->(${b.x},${b.y}) within the margin of box at (${obstacle.x},${obstacle.y})`
      ).toBe(false);
    }
  }
}

const length = (path: Point[]): number =>
  path.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);

/**
 * Two pedal-sized boxes `gap` px apart, walled in on both sides right out to
 * the board edges, so the gap is the ONLY way from the top half to the bottom.
 */
function gapField(gap: number) {
  const bounds: BoardBounds = { minX: 0, maxX: 1000, minY: 0, maxY: 600 };
  const leftEdge = 440;
  const rightEdge = leftEdge + gap;
  const boxes = [
    box(0, 200, 315, 200),              // wall, out to the left board edge
    box(325, 200, leftEdge - 325, 200), // 10px from the wall: sealed
    box(rightEdge, 200, 115, 200),
    box(rightEdge + 125, 200, 1000 - (rightEdge + 125), 200), // sealed, out to the right edge
  ];
  return { bounds, boxes, leftEdge, rightEdge, start: { x: 380, y: 150 }, end: { x: rightEdge + 60, y: 450 } };
}

describe('threads every gap a cable is allowed through', () => {
  for (const gap of [13, 14, 20, 24, 28, 32, 36, 44]) {
    it(`${gap}px gap`, () => {
      const f = gapField(gap);
      const path = findOrthogonalPath(f.start, f.end, f.boxes, { boardBounds: f.bounds });
      expect(path, 'no route found').not.toBeNull();
      expectLegal(path!, f.boxes);
      // It went THROUGH the gap: some vertical leg lies between the two pedals
      // and spans their full depth.
      const through = path!.some((p, i) => {
        const q = path![i + 1];
        return q !== undefined && Math.abs(p.x - q.x) < 0.01 &&
          p.x > f.leftEdge && p.x < f.rightEdge &&
          Math.min(p.y, q.y) < 200 && Math.max(p.y, q.y) > 400;
      });
      expect(through).toBe(true);
    });
  }

  it('12.5px gap: only the exact middle is legal, and it is found', () => {
    // Each pedal's own grid line lands inside the OTHER pedal's margin here;
    // the route exists only on the line halfway between them.
    const f = gapField(12.5);
    const path = findOrthogonalPath(f.start, f.end, f.boxes, { boardBounds: f.bounds });
    expect(path).not.toBeNull();
    expectLegal(path!, f.boxes);
    expect(path!.some((p) => Math.abs(p.x - (f.leftEdge + 6.25)) < 0.01)).toBe(true);
  });

  it('12px gap: two margins with nothing between them is not a route', () => {
    const f = gapField(12);
    expect(findOrthogonalPath(f.start, f.end, f.boxes, { boardBounds: f.bounds })).toBeNull();
  });

  it('runs down the middle of a narrow gap rather than hugging one pedal', () => {
    const f = gapField(20);
    const path = findOrthogonalPath(f.start, f.end, f.boxes, { boardBounds: f.bounds })!;
    expect(path.some((p) => Math.abs(p.x - (f.leftEdge + 10)) < 0.01)).toBe(true);
  });
});

describe('the shape of the route', () => {
  const bounds: BoardBounds = { minX: 0, maxX: 800, minY: 0, maxY: 600 };

  it('is a single corner across open space - never a staircase', () => {
    const path = findOrthogonalPath({ x: 100, y: 100 }, { x: 500, y: 400 }, [box(600, 450, 100, 100)], { boardBounds: bounds })!;
    expect(path.length).toBe(3);
    expect(length(path)).toBe(700);
  });

  it('is a straight line when the ends line up', () => {
    const path = findOrthogonalPath({ x: 100, y: 100 }, { x: 500, y: 100 }, [], { boardBounds: bounds })!;
    expect(path).toEqual([{ x: 100, y: 100 }, { x: 500, y: 100 }]);
  });

  it('goes round the SHORT side of a pedal in the way', () => {
    // Start and end either side of a box, level with a point near its top:
    // over the top is 2 x 46.5 of detour, under the bottom is 2 x 166.5.
    const obstacle = box(300, 100, 100, 200);
    const path = findOrthogonalPath({ x: 200, y: 140 }, { x: 500, y: 140 }, [obstacle], { boardBounds: bounds })!;
    expectLegal(path, [obstacle]);
    expect(Math.min(...path.map((p) => p.y))).toBeCloseTo(100 - OBSTACLE_MARGIN - 0.5, 6);
    expect(length(path)).toBeCloseTo(300 + 2 * 46.5, 6);
  });

  it('starts and ends on the points it was given', () => {
    const start = { x: 123.4, y: 77.7 };
    const end = { x: 611.1, y: 402.9 };
    const path = findOrthogonalPath(start, end, [box(300, 100, 100, 200)], { boardBounds: bounds })!;
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(end);
  });

  it('does not depend on the order of the boxes', () => {
    const boxes = [box(150, 80, 90, 160), box(300, 220, 120, 90), box(480, 60, 70, 300), box(260, 380, 200, 60)];
    const start = { x: 60, y: 300 };
    const end = { x: 620, y: 200 };
    const reference = findOrthogonalPath(start, end, boxes, { boardBounds: bounds });
    expect(reference).not.toBeNull();
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) {
      expect(findOrthogonalPath(start, end, order.map((i) => boxes[i]), { boardBounds: bounds })).toEqual(reference);
    }
  });
});

describe('the edge of the board', () => {
  const bounds: BoardBounds = { minX: 0, maxX: 600, minY: 0, maxY: 400 };
  // A pedal flush against the back edge, with a top-mounted jack: its standoff
  // pokes past the board, and the only way round its own body is along outside.
  const flush = box(200, 0, 120, 200);
  const standoff = { x: 260, y: -10 };
  const end = { x: 450, y: 300 };

  it('an on-board cable may not travel outside it', () => {
    expect(findOrthogonalPath(standoff, end, [flush], { boardBounds: bounds })).toBeNull();
  });

  it('a cable to the guitar or amp may', () => {
    const path = findOrthogonalPath(standoff, end, [flush], { boardBounds: bounds, allowOffBoard: true });
    expect(path).not.toBeNull();
    expectLegal(path!, [flush]);
  });
});

it('says there is no route when the end is sealed in', () => {
  const bounds: BoardBounds = { minX: 0, maxX: 600, minY: 0, maxY: 400 };
  // A ring of four boxes, 10px apart at the corners, around the end point.
  const ring = [box(200, 100, 200, 40), box(200, 260, 200, 40), box(150, 100, 40, 200), box(410, 100, 40, 200)];
  expect(findOrthogonalPath({ x: 50, y: 50 }, { x: 300, y: 200 }, ring, { boardBounds: bounds })).toBeNull();
});

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/** Seeded generator, so a failure names a field that can be rebuilt. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Field {
  width: number;
  height: number;
  boxes: Box[];
}

/** Half-pixel lattice: every coordinate the sparse grid can use on integer boxes. */
const STEP = 0.5;

/** Is this point more than a margin from every box? (The inclusive test the router is held to.) */
function free(x: number, y: number, boxes: Box[]): boolean {
  return !boxes.some((b) =>
    x >= b.x - OBSTACLE_MARGIN && x <= b.x + b.width + OBSTACLE_MARGIN &&
    y >= b.y - OBSTACLE_MARGIN && y <= b.y + b.height + OBSTACLE_MARGIN
  );
}

/** Flood fill over every half-pixel of the board. Slow, obvious, and independent. */
function reachable(start: Point, end: Point, field: Field): boolean {
  const nx = field.width / STEP + 1;
  const ny = field.height / STEP + 1;
  const blocked = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!free(ix * STEP, iy * STEP, field.boxes)) blocked[iy * nx + ix] = 1;
    }
  }
  const at = (p: Point) => Math.round(p.y / STEP) * nx + Math.round(p.x / STEP);
  const target = at(end);
  const seen = new Uint8Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  let head = 0;
  let tail = 0;
  queue[tail++] = at(start);
  seen[at(start)] = 1;
  while (head < tail) {
    const n = queue[head++];
    if (n === target) return true;
    const ix = n % nx;
    const iy = (n - ix) / nx;
    const visit = (jx: number, jy: number) => {
      if (jx < 0 || jx >= nx || jy < 0 || jy >= ny) return;
      const m = jy * nx + jx;
      if (seen[m] || blocked[m]) return;
      seen[m] = 1;
      queue[tail++] = m;
    };
    visit(ix + 1, iy); visit(ix - 1, iy); visit(ix, iy + 1); visit(ix, iy - 1);
  }
  return false;
}

type Int = (lo: number, hi: number) => number;

/** Boxes thrown anywhere. Mostly open: a test of finding A route, and a legal one. */
function scatterField(int: Int): Field {
  const width = 240;
  const height = 200;
  const boxes: Box[] = [];
  const count = int(5, 9);
  for (let i = 0; i < count; i++) {
    const w = int(24, 70);
    const h = int(24, 70);
    boxes.push(box(int(0, width - w), int(0, height - h), w, h));
  }
  return { width, height, boxes };
}

/**
 * Boxes in rows and columns, like pedals on a board, with every gap drawn from
 * 4-16px - straddling the 12px a cable needs. More than half the gaps are shut,
 * so whether two points connect turns on getting the limit right to the pixel,
 * gap by gap. This is the generator that produces sealed fields.
 */
function packedField(int: Int): Field {
  const cols = int(3, 4);
  const rows = int(2, 3);
  const colW = Array.from({ length: cols }, () => int(30, 56));
  const rowH = Array.from({ length: rows }, () => int(30, 52));
  const boxes: Box[] = [];
  let y = int(0, 9);
  for (let r = 0; r < rows; r++) {
    let x = int(0, 9);
    for (let c = 0; c < cols; c++) {
      // Each pedal sits somewhere inside its cell, so no two gaps are alike.
      const inL = int(0, 2), inR = int(0, 2), inT = int(0, 2), inB = int(0, 2);
      boxes.push(box(x + inL, y + inT, colW[c] - inL - inR, rowH[r] - inT - inB));
      x += colW[c] + int(4, 12);
    }
    y += rowH[r] + int(4, 12);
  }
  const width = Math.max(...boxes.map((b) => b.x + b.width)) + int(0, 9);
  const height = Math.max(...boxes.map((b) => b.y + b.height)) + int(0, 9);
  return { width, height, boxes };
}

describe('agrees with a flood fill over every half-pixel', () => {
  let routed = 0;
  let sealed = 0;

  for (let seed = 1; seed <= 120; seed++) {
    const kind = seed % 3 === 0 ? 'scattered' : 'packed';

    it(`${kind} field #${seed}`, () => {
      const random = seeded(seed);
      const int: Int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
      const field = kind === 'scattered' ? scatterField(int) : packedField(int);
      const bounds: BoardBounds = { minX: 0, maxX: field.width, minY: 0, maxY: field.height };

      const pick = (): Point | null => {
        for (let tries = 0; tries < 400; tries++) {
          const p = { x: int(0, field.width), y: int(0, field.height) };
          if (free(p.x, p.y, field.boxes)) return p;
        }
        return null;
      };
      const start = pick();
      const end = pick();
      if (!start || !end || (start.x === end.x && start.y === end.y)) return; // no free pair in this field

      const expected = reachable(start, end, field);
      const path = findOrthogonalPath(start, end, field.boxes, { boardBounds: bounds });

      expect(path !== null, `seed ${seed}: oracle says ${expected ? 'reachable' : 'sealed'}`).toBe(expected);
      if (path) {
        expectLegal(path, field.boxes);
        for (const p of path) {
          expect(
            p.x >= 0 && p.x <= field.width && p.y >= 0 && p.y <= field.height,
            `seed ${seed}: point off the board`
          ).toBe(true);
        }
        routed++;
      } else {
        sealed++;
      }
    });
  }

  it('exercised both answers', () => {
    // If every field were open (or every one sealed) the agreement above
    // would be agreement about one case.
    // Measured when written: 95 routed, 23 sealed, 2 fields with no free pair.
    expect(routed).toBeGreaterThan(20);
    expect(sealed).toBeGreaterThan(15);
  });
});
