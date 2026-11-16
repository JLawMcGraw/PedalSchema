/**
 * Orthogonal pathfinding on a SPARSE grid - the lines that matter, and no
 * others.
 *
 * This replaces a dense A* over 8px cells, which could not do the one thing it
 * was in the cascade for. It marked a cell blocked if any part of it lay within
 * OBSTACLE_MARGIN of a pedal, rounding outward on both sides, so two pedals had
 * to be about 0.9in apart before a single free cell survived between them.
 * Measured on 2026-11-16: a straight run through a 14, 20, 24, 28 or 32px gap
 * is legal by isPathClear, and the dense grid refused every one - it first
 * threaded a gap at 36px. The placer packs at 20px side to side and 14px row to
 * row. So the rung only ever found routes around the OUTSIDE of the pedals,
 * and then lost to the perimeter strategy or failed outright:
 *
 *   share of Optimize's time spent in it      84%   (6,798 of 8,075ms, 216 boards)
 *   cables it ended up drawing                 2 of 1,962
 *
 * A grid's resolution is the wrong knob. Whether a cable fits through a gap is
 * decided at the gap's edges, to the pixel, and nowhere else - so put the grid
 * lines THERE:
 *
 *   one line just outside each pedal's margin, on all four sides
 *   one down the middle of any narrow gap those lines leave
 *   the start's and the end's own row and column
 *
 * A shortest orthogonal path, if one exists at all, exists on those lines.
 * Twenty pedals make about forty lines an axis instead of 160 x 80 cells, every
 * legal gap is exactly representable however thin, and "no route" is a real
 * answer instead of an iteration cap.
 *
 * Pure geometry: boxes in, points out. The caller owns the policy - the
 * cascade still validates whatever this returns through candidateOk, so a path
 * this module gets wrong costs it a turn rather than drawing through a pedal.
 */

import type { Point, Box, BoardBounds } from '../geometry';
import { OBSTACLE_MARGIN, STANDOFF } from '../geometry';

/**
 * How far beyond a pedal's margin its grid lines sit, in pixels.
 *
 * Not zero: lineIntersectsBox treats a segment exactly ON the margin as a
 * violation, so a line at `edge - OBSTACLE_MARGIN` would be illegal along its
 * whole length. Half a pixel clears that and still leaves a legal line in a
 * corridor only 1px wider than two margins - the 14px row corridor carries
 * lines at 6.5 and 7.5 from the row above it.
 */
const LINE_CLEARANCE = OBSTACLE_MARGIN + 0.5;

/**
 * Gaps up to this wide between two neighbouring grid lines get a line down
 * their middle, so a cable through a tight gap runs centred instead of hugging
 * one pedal. Wider gaps are open space, where hugging is not a visual problem
 * and the midline would only be another line to search.
 */
const NARROW_GAP = 2 * STANDOFF;

/**
 * What a corner costs, in pixels of extra length the search will accept to
 * avoid one. Without it every staircase between two points is as good as the
 * L - they are all the same length - and which one came out would be an
 * accident of search order.
 */
const TURN_COST = 2 * STANDOFF;

/**
 * Lines that hug a pedal cost fractionally more per pixel than a gap's
 * midline or the endpoints' own lines. Only ever a tie-break between routes of
 * equal length and equal corners: it decides WHICH line in a corridor, never
 * whether to take the corridor.
 */
const HUG_WEIGHT = 1.01;

/** Coordinates closer than this are the same line. */
const SAME_LINE = 0.01;

export interface SparsePathOptions {
  boardBounds?: BoardBounds | null;
  /**
   * True when either end of the cable is off the board (guitar, amp). Such a
   * cable may run outside the board on its way in; an on-board cable may not.
   */
  allowOffBoard?: boolean;
}

interface Axis {
  /** Sorted, de-duplicated line coordinates */
  at: number[];
  /** Per-pixel cost multiplier of travelling ALONG each line */
  weight: number[];
}

function buildAxis(
  ranges: Array<[lo: number, hi: number]>,
  min: number,
  max: number,
  own: number[]
): Axis {
  const hug: number[] = [];
  for (const [lo, hi] of ranges) {
    for (const c of [lo - LINE_CLEARANCE, hi + LINE_CLEARANCE]) {
      if (c >= min && c <= max) hug.push(c);
    }
  }
  hug.sort((a, b) => a - b);

  // Midlines of narrow gaps. No lower limit on purpose: when two pedals are
  // between 12 and 13px apart their two hug lines CROSS - each lands on or
  // inside the other pedal's margin and is illegal - and the only legal line
  // left in the gap is the one halfway between them. Skipping "gaps" under a
  // pixel would lose exactly the thinnest corridors this grid exists to keep.
  const mids: number[] = [];
  for (let i = 0; i < hug.length - 1; i++) {
    const gap = hug[i + 1] - hug[i];
    if (gap > SAME_LINE && gap <= NARROW_GAP) mids.push((hug[i] + hug[i + 1]) / 2);
  }

  // The endpoints' own lines and the midlines travel at full value. Where two
  // candidates land on the same coordinate (an endpoint lined up with a
  // pedal's margin) the sort puts the cheaper weight first and the dedupe
  // below keeps the first, so the line takes the better of the two.
  const entries: Array<{ c: number; w: number }> = [
    ...hug.map((c) => ({ c, w: HUG_WEIGHT })),
    ...mids.map((c) => ({ c, w: 1 })),
    ...own.map((c) => ({ c, w: 1 })),
  ].sort((a, b) => a.c - b.c || a.w - b.w);

  const at: number[] = [];
  const weight: number[] = [];
  for (const e of entries) {
    if (at.length > 0 && e.c - at[at.length - 1] < SAME_LINE) continue; // first seen has the lower weight
    at.push(e.c);
    weight.push(e.w);
  }
  return { at, weight };
}

function indexOf(axis: Axis, c: number): number {
  for (let i = 0; i < axis.at.length; i++) {
    if (Math.abs(axis.at[i] - c) < SAME_LINE) return i;
  }
  return -1;
}

/** Tiny binary heap keyed on (f, state) - the state breaks ties, so results are deterministic. */
class StateHeap {
  private f: number[] = [];
  private s: number[] = [];

  get size(): number { return this.f.length; }

  private less(i: number, j: number): boolean {
    return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && this.s[i] < this.s[j]);
  }

  private swap(i: number, j: number): void {
    [this.f[i], this.f[j]] = [this.f[j], this.f[i]];
    [this.s[i], this.s[j]] = [this.s[j], this.s[i]];
  }

  push(f: number, state: number): void {
    this.f.push(f);
    this.s.push(state);
    let i = this.f.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { f: number; state: number } {
    const top = { f: this.f[0], state: this.s[0] };
    const lastF = this.f.pop()!;
    const lastS = this.s.pop()!;
    if (this.f.length > 0) {
      this.f[0] = lastF;
      this.s[0] = lastS;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.f.length && this.less(l, m)) m = l;
        if (r < this.f.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * The shortest orthogonal path from `start` to `end` that keeps
 * OBSTACLE_MARGIN from every box, or null when there is none.
 *
 * EVERY box is an obstacle, including the pedals the cable terminates on:
 * `start` and `end` are standoff points, already clear of their own pedal, and
 * the stubs that reach the jacks are the caller's to add.
 *
 * Returns corners only - collinear points are dropped - beginning with `start`
 * and ending with `end`.
 */
export function findOrthogonalPath(
  start: Point,
  end: Point,
  boxes: Box[],
  options: SparsePathOptions = {}
): Point[] | null {
  const bounds = options.boardBounds ?? null;
  const allowOffBoard = options.allowOffBoard ?? false;
  const solid = boxes.filter((b) => b.width > 0 && b.height > 0);

  const xs = buildAxis(
    solid.map((b) => [b.x, b.x + b.width]),
    bounds ? bounds.minX : -Infinity,
    bounds ? bounds.maxX : Infinity,
    [start.x, end.x]
  );
  const ys = buildAxis(
    solid.map((b) => [b.y, b.y + b.height]),
    bounds ? bounds.minY : -Infinity,
    bounds ? bounds.maxY : Infinity,
    [start.y, end.y]
  );
  const nx = xs.at.length;
  const ny = ys.at.length;
  const node = (ix: number, iy: number): number => iy * nx + ix;

  // --- Which grid edges are legal -------------------------------------------
  // hOpen[node] : the edge from this node to the one on its RIGHT
  // vOpen[node] : the edge from this node to the one BELOW it
  const hOpen = new Uint8Array(nx * ny).fill(1);
  const vOpen = new Uint8Array(nx * ny).fill(1);
  for (let iy = 0; iy < ny; iy++) hOpen[node(nx - 1, iy)] = 0;
  for (let ix = 0; ix < nx; ix++) vOpen[node(ix, ny - 1)] = 0;

  // Same inclusive test lineIntersectsBox applies to an axis-aligned segment:
  // it is illegal if it touches the box grown by the margin.
  for (const b of solid) {
    const left = b.x - OBSTACLE_MARGIN;
    const right = b.x + b.width + OBSTACLE_MARGIN;
    const top = b.y - OBSTACLE_MARGIN;
    const bottom = b.y + b.height + OBSTACLE_MARGIN;

    for (let iy = 0; iy < ny; iy++) {
      const y = ys.at[iy];
      if (y < top || y > bottom) continue;
      for (let ix = 0; ix < nx - 1; ix++) {
        if (xs.at[ix + 1] >= left && xs.at[ix] <= right) hOpen[node(ix, iy)] = 0;
      }
    }
    for (let ix = 0; ix < nx; ix++) {
      const x = xs.at[ix];
      if (x < left || x > right) continue;
      for (let iy = 0; iy < ny - 1; iy++) {
        if (ys.at[iy + 1] >= top && ys.at[iy] <= bottom) vOpen[node(ix, iy)] = 0;
      }
    }
  }

  // An on-board cable does not TRAVEL outside the board. Only the endpoints'
  // own lines can lie out there (a jack on a pedal flush to the edge points
  // its standoff past it), so this closes exactly the runs along them.
  if (bounds && !allowOffBoard) {
    const outsideX = xs.at.map((x) => x < bounds.minX || x > bounds.maxX);
    const outsideY = ys.at.map((y) => y < bounds.minY || y > bounds.maxY);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const here = outsideX[ix] || outsideY[iy];
        if (!here) continue;
        if (ix < nx - 1 && (outsideX[ix + 1] || outsideY[iy])) hOpen[node(ix, iy)] = 0;
        if (iy < ny - 1 && (outsideX[ix] || outsideY[iy + 1])) vOpen[node(ix, iy)] = 0;
      }
    }
  }

  const sx = indexOf(xs, start.x);
  const sy = indexOf(ys, start.y);
  const tx = indexOf(xs, end.x);
  const ty = indexOf(ys, end.y);
  if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
  const source = node(sx, sy);
  const target = node(tx, ty);
  if (source === target) return [start, end];

  /** Legal neighbours of a node, as [neighbour, movedHorizontally, length x weight]. */
  const neighbours = (n: number, visit: (to: number, horizontal: boolean, cost: number) => void): void => {
    const ix = n % nx;
    const iy = (n - ix) / nx;
    if (ix < nx - 1 && hOpen[n]) visit(n + 1, true, (xs.at[ix + 1] - xs.at[ix]) * ys.weight[iy]);
    if (ix > 0 && hOpen[n - 1]) visit(n - 1, true, (xs.at[ix] - xs.at[ix - 1]) * ys.weight[iy]);
    if (iy < ny - 1 && vOpen[n]) visit(n + nx, false, (ys.at[iy + 1] - ys.at[iy]) * xs.weight[ix]);
    if (iy > 0 && vOpen[n - nx]) visit(n - nx, false, (ys.at[iy] - ys.at[iy - 1]) * xs.weight[ix]);
  };

  // --- Is there a route at all? ---------------------------------------------
  // A plain flood fill, before the real search. "No" is the common answer at
  // this rung - the cable that wraps a full board has no on-board route - and
  // a best-first search only learns that by exhausting every state it can
  // reach, which is the expensive way to hear it.
  {
    const seen = new Uint8Array(nx * ny);
    const queue = new Int32Array(nx * ny);
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    seen[source] = 1;
    while (head < tail && !seen[target]) {
      neighbours(queue[head++], (to) => {
        if (!seen[to]) {
          seen[to] = 1;
          queue[tail++] = to;
        }
      });
    }
    if (!seen[target]) return null;
  }

  // --- Shortest path, counting corners --------------------------------------
  // A state is a node AND the direction it was entered in, because turning is
  // what costs: state = node * 2 + (entered vertically ? 1 : 0).
  const cost = new Float64Array(nx * ny * 2).fill(Infinity);
  const cameFrom = new Int32Array(nx * ny * 2).fill(-1);
  const closed = new Uint8Array(nx * ny * 2);
  const heap = new StateHeap();
  const remaining = (n: number): number => {
    const ix = n % nx;
    const iy = (n - ix) / nx;
    return Math.abs(xs.at[ix] - xs.at[tx]) + Math.abs(ys.at[iy] - ys.at[ty]);
  };

  // Leaving the start costs no corner whichever way it goes.
  for (const direction of [0, 1]) {
    cost[source * 2 + direction] = 0;
    heap.push(remaining(source), source * 2 + direction);
  }

  let goal = -1;
  while (heap.size > 0) {
    const { state } = heap.pop();
    if (closed[state]) continue;
    closed[state] = 1;
    const n = state >> 1;
    if (n === target) {
      goal = state;
      break;
    }
    const enteredVertically = (state & 1) === 1;
    neighbours(n, (to, horizontal, stepCost) => {
      const next = to * 2 + (horizontal ? 0 : 1);
      if (closed[next]) return;
      const turned = horizontal === enteredVertically;
      const total = cost[state] + stepCost + (turned ? TURN_COST : 0);
      if (total < cost[next]) {
        cost[next] = total;
        cameFrom[next] = state;
        heap.push(total + remaining(to), next);
      }
    });
  }
  if (goal < 0) return null;

  // --- Rebuild, corners only -------------------------------------------------
  const points: Point[] = [];
  for (let state = goal; state >= 0; state = cameFrom[state]) {
    const n = state >> 1;
    const ix = n % nx;
    points.push({ x: xs.at[ix], y: ys.at[(n - ix) / nx] });
  }
  points.reverse();

  const corners: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = corners[corners.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const straight =
      (Math.abs(a.x - b.x) < SAME_LINE && Math.abs(b.x - c.x) < SAME_LINE) ||
      (Math.abs(a.y - b.y) < SAME_LINE && Math.abs(b.y - c.y) < SAME_LINE);
    if (!straight) corners.push(b);
  }
  corners.push(points[points.length - 1]);

  // Hand back the caller's own endpoints rather than the grid's copies of them.
  corners[0] = start;
  corners[corners.length - 1] = end;
  return corners;
}
