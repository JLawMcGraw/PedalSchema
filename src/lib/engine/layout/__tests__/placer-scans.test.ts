/**
 * The placer's last-resort scans give the same answer as the walk they replaced.
 *
 * When a pedal finds no row, the placer scans the board for anywhere it fits:
 * every quarter-inch position, each tested against every pedal already down.
 * On a full board that was nearly all the work one press of Optimize did -
 * measured on the real 22-pedal board, 2026-11-16, 1,646 of 1,813ms.
 *
 * The scans now JUMP: a position blocked by a pedal stays blocked by that
 * pedal until the scan has moved clear of it, and how far that is follows
 * from the pedal. Same answer, far fewer tests - 1,867ms to 485ms on that
 * board from this alone.
 *
 * "Same answer" has to be exact, not close. The optimizer's results are
 * compared for strict equality throughout the suite, and a spot that moved by
 * a rounding error is a different board. So each helper is run here against
 * the obvious loop, written out below with its own copy of the overlap rule,
 * on fields built to sit ON the boundaries where a jump could go wrong: pedals
 * spaced at exactly the clearance, footprints that are exact multiples of the
 * step, and starts that are not.
 *
 * The scale version of this claim - every placement the placer and optimizer
 * produce on 436 fixture boards and both saved boards, identical before and
 * after - was checked by fingerprint when the change was made.
 */
import { describe, it, expect } from 'vitest';
import type { Board } from '@/types';
import { COLLISION_SPACING } from '../../collision';
import { MIN_ROW_CLEARANCE } from '../constants';
import { firstValidXScanningLeft, findAnyFreeSpot } from '../index';

interface PlacedBox { x: number; y: number; width: number; height: number }

const STEP = 0.25;
const EPSILON = 1e-6;

/** The overlap rule, restated here on purpose - the oracle must not import what it checks. */
function overlaps(a: PlacedBox, b: PlacedBox, spacingX: number, spacingY: number): boolean {
  return !(
    a.x + a.width + spacingX <= b.x + EPSILON ||
    b.x + b.width + spacingX <= a.x + EPSILON ||
    a.y + a.height + spacingY <= b.y + EPSILON ||
    b.y + b.height + spacingY <= a.y + EPSILON
  );
}

/** The walk firstValidXScanningLeft replaced: every step, one at a time. */
function walkLeft(width: number, depth: number, y: number, startX: number, minX: number, boxes: PlacedBox[], board: Board): number | null {
  for (let x = startX; x >= minX; x -= STEP) {
    const c = { x, y, width, height: depth };
    if (c.x < 0 || c.x + c.width > board.widthInches || c.y < 0 || c.y + c.height > board.depthInches) continue;
    if (!boxes.some((b) => overlaps(c, b, COLLISION_SPACING, MIN_ROW_CLEARANCE))) return x;
  }
  return null;
}

/** The walk findAnyFreeSpot replaced. */
function walkAnywhere(width: number, depth: number, boxes: PlacedBox[], board: Board): { x: number; y: number } | null {
  for (const spacing of [COLLISION_SPACING, 0.25, 0]) {
    for (let y = 0; y <= board.depthInches - depth + 1e-6; y += STEP) {
      for (let x = 0; x <= board.widthInches - width + 1e-6; x += STEP) {
        const c = { x, y, width, height: depth };
        if (!boxes.some((b) => overlaps(c, b, spacing, spacing))) return { x, y };
      }
    }
  }
  return null;
}

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

const board = (widthInches: number, depthInches: number): Board =>
  ({ id: 'b', name: 'B', widthInches, depthInches, railWidthInches: 0.6, isSystem: true } as Board);

/** Real pedal footprints, including ones that are exact multiples of the step. */
const FOOTPRINTS: Array<[number, number]> = [
  [2.87, 5.08], [2.87, 5.1], [2.4, 4.4], [3.98, 5.43], [4.7, 3.7], [3.5, 4.5], [2.87, 7.56], [6.75, 5.1],
  [2.5, 5.0], [3.0, 4.5], [2.75, 5.25],
];

/**
 * A crowded board. Pedals are laid in rows the way the placer lays them -
 * each one exactly the clearance from the last, which is the boundary the
 * overlap test's epsilon exists for - then a few are dropped in anywhere.
 */
function field(random: () => number, b: Board): PlacedBox[] {
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
  const boxes: PlacedBox[] = [];
  let y = pick([0, 0.1, 0.185]);
  while (y + 3.7 <= b.depthInches) {
    let rowDepth = 0;
    let x = b.widthInches;
    for (;;) {
      const [w, d] = pick(FOOTPRINTS);
      if (x - w < 0 || y + d > b.depthInches) break;
      x -= w;
      if (random() < 0.85) boxes.push({ x, y, width: w, height: d });
      rowDepth = Math.max(rowDepth, d);
      x -= pick([COLLISION_SPACING, COLLISION_SPACING, 0.25, 0.75, 1.5]);
    }
    if (rowDepth === 0) break;
    y += rowDepth + pick([MIN_ROW_CLEARANCE, 0.35, 0.185, 0.5]);
  }
  for (let i = 0; i < 3; i++) {
    const [w, d] = pick(FOOTPRINTS);
    if (random() < 0.5) boxes.push({ x: random() * (b.widthInches - w), y: random() * Math.max(0, b.depthInches - d), width: w, height: d });
  }
  return boxes;
}

const BOARDS = [board(32, 16), board(24, 12.5), board(18, 12.5), board(14, 5.5)];

describe('scanning one row leftward', () => {
  it('finds the same position as stepping, on 4,000 crowded rows', () => {
    const random = seeded(20261116);
    let found = 0;
    let none = 0;
    for (let i = 0; i < 4000; i++) {
      const b = BOARDS[i % BOARDS.length];
      const boxes = field(random, b);
      const [width, depth] = FOOTPRINTS[Math.floor(random() * FOOTPRINTS.length)];
      // Start from the right edge as the placer does - not a multiple of the
      // step - or from somewhere arbitrary mid-board.
      const startX = random() < 0.6 ? b.widthInches - width : random() * b.widthInches;
      const y = random() < 0.5 ? Math.floor((random() * b.depthInches) / STEP) * STEP : random() * b.depthInches;
      const minX = random() < 0.8 ? 0 : random() * 4;

      const expected = walkLeft(width, depth, y, startX, minX, boxes, b);
      const actual = firstValidXScanningLeft(width, depth, y, startX, minX, STEP, boxes, b);

      // toBe, not toBeCloseTo: the same double or it is a different board.
      expect(actual, `case ${i}`).toBe(expected);
      if (expected === null) none++; else found++;
    }
    // Both answers have to have come up, or half the claim went untested.
    expect(found).toBeGreaterThan(500);
    expect(none).toBeGreaterThan(500);
  });

  it('does not jump over a gap exactly one footprint wide', () => {
    // Two pedals with room for a 2.5in pedal plus clearance each side, to the
    // thousandth: the one position that fits is two steps from the blocker.
    const b = board(20, 6);
    const width = 2.5;
    const left = { x: 4, y: 0, width: 3, height: 5 };
    const right = { x: left.x + left.width + COLLISION_SPACING + width + COLLISION_SPACING, y: 0, width: 3, height: 5 };
    const start = right.x + right.width + COLLISION_SPACING + 2; // well right of both
    const expected = walkLeft(width, 5, 0, start, 0, [left, right], b);
    expect(expected).not.toBeNull();
    expect(firstValidXScanningLeft(width, 5, 0, start, 0, STEP, [left, right], b)).toBe(expected);
  });
});

describe('scanning the whole board for any free spot', () => {
  it('finds the same spot as stepping, on 1,500 crowded boards', () => {
    const random = seeded(7);
    let found = 0;
    let none = 0;
    for (let i = 0; i < 1500; i++) {
      const b = BOARDS[i % BOARDS.length];
      const boxes = field(random, b);
      const [width, depth] = FOOTPRINTS[Math.floor(random() * FOOTPRINTS.length)];

      const expected = walkAnywhere(width, depth, boxes, b);
      const actual = findAnyFreeSpot(width, depth, boxes, b);

      expect(actual, `case ${i}`).toEqual(expected);
      if (expected === null) none++; else found++;
    }
    expect(found).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(100);
  });
});
