/**
 * Randomized property test: the optimizer never hands back a broken board.
 *
 * The configuration matrix sweeps hand-built scenarios. This sweeps a
 * POPULATION instead - hundreds of random boards, pedal counts and depth
 * mixes - because the failures worth catching here are emergent: they show up
 * at a particular fill ratio with a particular outlier, not in any scenario
 * anyone would think to write down.
 *
 * WHY THIS TEST EXISTS, and what it corrects. An earlier sweep reported "231
 * of 1777 random dense boards still overlap" and that reading was wrong twice
 * over:
 *
 *  1. The generator admitted boards up to 72% area fill. Rectangles do not
 *     pack to 72% when their depths differ - rows quantize and the leftovers
 *     are unusable. An independent shelf packer, sorting by decreasing depth
 *     and ignoring chain order entirely, also failed on 214 of those 231. They
 *     were not defects; they were boards with genuinely too many pedals.
 *  2. It measured calculateGreedyPlacement, which really can emit overlapping
 *     positions - its last resort clamps a pedal on-board rather than dropping
 *     it. But greedy is not the answer the app uses. calculateOptimalLayoutJoint
 *     scores any colliding candidate Infinity, so when nothing legal exists it
 *     keeps the user's own layout and reports noLegalCandidate. Nobody is ever
 *     shown pedals stacked on each other.
 *
 * So the property that actually matters, and the one asserted here, is:
 * given a layout that IS legal, the optimizer never returns a worse one.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { calculateOptimalLayoutJoint } from '../index';
import { COLLISION_SPACING } from '../../collision';
import type { Board, Pedal, PlacedPedal, RoutingConfig } from '@/types';

const ROUTING: RoutingConfig = {
  useLoopPedals: true, use4CableMethod: false, useEffectsLoop: false, pedalConfigs: [],
};

/** Deterministic LCG - a property test that cannot be replayed is a rumour. */
function makeRandom(seed: number) {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return { next, pick: <T,>(a: T[]): T => a[Math.floor(next() * a.length)] };
}

// Real catalogue dimensions, not invented ones
const BOARDS: Array<[number, number]> = [[18, 12.5], [22, 12.5], [24, 16], [32, 16], [28, 14], [16, 10]];
const DEPTHS = [5.08, 5.1, 5.43, 5.6, 7.3, 7.52, 7.56, 9.06];
const WIDTHS = [2.87, 2.9, 3.15, 3.3, 3.98, 4.8, 5.5, 6.5];

/**
 * Independent reference packer - shelves by decreasing depth, first fit.
 *
 * Its ONLY job is to decide whether a legal arrangement exists at all, so the
 * test can skip boards that are simply over-full. It is deliberately not the
 * algorithm under test and ignores chain order, which is why it must never be
 * used to judge the engine's OUTPUT - only to qualify its INPUT.
 */
function shelfPack(
  items: Array<{ id: string; w: number; d: number }>,
  boardW: number,
  boardD: number
): Record<string, { x: number; y: number }> | null {
  const out: Record<string, { x: number; y: number }> = {};
  let y = 0, shelfDepth = 0, x = 0;
  for (const it of [...items].sort((a, b) => b.d - a.d)) {
    if (x + it.w > boardW + 1e-9) { y += shelfDepth + 0.2; x = 0; shelfDepth = 0; }
    if (y + it.d > boardD + 1e-9) return null;
    out[it.id] = { x, y };
    x += it.w + COLLISION_SPACING;
    shelfDepth = Math.max(shelfDepth, it.d);
  }
  return out;
}

function overlappingPairs(
  placements: Array<{ id: string; x: number; y: number }>,
  pedalsById: Record<string, Pedal>
): string[] {
  const boxes = placements.map((p) => ({
    id: p.id, x: p.x, y: p.y,
    w: pedalsById[p.id].widthInches, h: pedalsById[p.id].depthInches,
  }));
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.01 && oy > 0.01) {
        bad.push(`${a.id}/${b.id} by ${ox.toFixed(2)}x${oy.toFixed(2)}in`);
      }
    }
  }
  return bad;
}

describe('placement property sweep', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  /*
   * 700 seeded trials of the full joint optimizer, so this is the heaviest
   * test in the suite by an order of magnitude - and vitest's default budget
   * is 5s per test, which is a budget written against whatever machine ran it
   * first.
   *
   * Measured: 1487ms alone, 2340ms under full-suite contention, on an
   * M-series Mac. It FAILED on CI (ubuntu-latest, 2 shared cores) at the 5s
   * default. The work is fixed and deterministic - makeRandom(999) - so this
   * is purely how fast the machine is, not how much there is to do.
   *
   * 30s, not "trials reduced": the point of a property sweep is the breadth
   * of the random space, and buying CI headroom by testing less is buying it
   * with the only thing this test has. A real hang still surfaces in 30s.
   */
  it('a legal board in is always a legal board out', () => {
    const rng = makeRandom(999);
    const failures: string[] = [];
    let tested = 0;

    for (let trial = 0; trial < 700; trial++) {
      const [boardW, boardD] = rng.pick(BOARDS);
      const board = {
        id: 'b', name: 'b', widthInches: boardW, depthInches: boardD,
        railWidthInches: 0.6, isSystem: true,
      } as Board;

      const count = 3 + Math.floor(rng.next() * 18);
      const pedalsById: Record<string, Pedal> = {};
      const items: Array<{ id: string; w: number; d: number }> = [];
      for (let i = 0; i < count; i++) {
        const id = `p${i}`;
        // ~1 in 6 is an outlier: the deep and wide pedals that break row models
        const outlier = rng.next() < 0.18;
        const w = outlier ? rng.pick(WIDTHS) : 2.87;
        const d = outlier ? rng.pick(DEPTHS) : 5.08;
        pedalsById[id] = {
          id, name: id, manufacturer: 'T', category: 'utility',
          widthInches: w, depthInches: d, heightInches: 2, jacks: [],
        } as unknown as Pedal;
        items.push({ id, w, d });
      }

      // Skip boards that are simply over-full - there is no right answer there
      // beyond "declines to act", which the next test covers.
      const start = shelfPack(items, boardW, boardD);
      if (!start) continue;
      tested++;

      const placed = items.map((it, i) => ({
        id: it.id, pedalId: it.id, pedal: pedalsById[it.id],
        xInches: start[it.id].x, yInches: start[it.id].y,
        rotationDegrees: 0, chainPosition: i + 1,
      })) as unknown as PlacedPedal[];

      const result = calculateOptimalLayoutJoint(placed, pedalsById, board, ROUTING);
      const label = `board ${boardW}x${boardD} n=${count}`;

      const bad = overlappingPairs(
        result.placements.map((p) => ({ id: p.id, x: p.x, y: p.y })), pedalsById
      );
      if (bad.length) failures.push(`${label}: overlaps ${bad.slice(0, 3).join(', ')}`);

      for (const p of result.placements) {
        const d = pedalsById[p.id];
        if (p.x < -0.01 || p.y < -0.01 ||
            p.x + d.widthInches > boardW + 0.01 ||
            p.y + d.depthInches > boardD + 0.01) {
          failures.push(`${label}: ${p.id} off board at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
          break;
        }
      }
    }

    // Guard the guard: if the generator stopped producing packable boards this
    // test would pass by testing nothing.
    expect(tested).toBeGreaterThan(200);
    expect(failures).toEqual([]);
  }, 30_000);

  /**
   * WHY the baseline collision guard never fires, measured rather than assumed.
   *
   * That guard carries a comment admitting it was never observed to change an
   * outcome - "300 random legal layouts and 24 tight-board configurations" all
   * produced a greedy candidate at least as good as the baseline. Disabling it
   * leaves this whole suite green, so it really is unexercised.
   *
   * The reason turns out to be structural, not luck. Overlapping pedals make
   * the cables between them unroutable, and the routing cost penalises that
   * far more than tight packing can ever save: even a 0.02in overlap - pedals
   * all but touching, cables all but zero-length - scores about FOUR times
   * worse than a properly spaced layout. A colliding layout can never win on
   * points, so the guard is belt-and-braces.
   *
   * This test pins that reasoning rather than the guard. If someone rebalances
   * the cost so a collision becomes cheap, this fails and says so - which is
   * the moment the guard stops being redundant and starts being load-bearing.
   */
  it('cannot profit from colliding, however small the overlap', () => {
    const board = {
      id: 'b', name: 'b', widthInches: 32, depthInches: 16,
      railWidthInches: 0.6, isSystem: true,
    } as Board;

    for (const overlap of [0.02, 0.1, 1.0]) {
      const pedalsById: Record<string, Pedal> = {};
      const placed: PlacedPedal[] = [];
      let x = 20;
      for (let i = 0; i < 6; i++) {
        const id = `p${i}`;
        pedalsById[id] = {
          id, name: id, manufacturer: 'T', category: 'utility',
          widthInches: 2.87, depthInches: 5.08, heightInches: 2, jacks: [],
        } as unknown as Pedal;
        placed.push({
          id, pedalId: id, pedal: pedalsById[id],
          xInches: x, yInches: 5, rotationDegrees: 0, chainPosition: i + 1,
        } as unknown as PlacedPedal);
        x -= 2.87 - overlap; // each pedal eats `overlap` into its neighbour
      }

      const result = calculateOptimalLayoutJoint(placed, pedalsById, board, ROUTING);

      // The colliding input must score WORSE than what the optimizer chose...
      expect(
        result.baselineCost!.totalScore,
        `a ${overlap}in overlap scored better than a legal layout - the baseline ` +
        `collision guard is now load-bearing and needs its own test`
      ).toBeGreaterThan(result.cost!.totalScore);

      // ...and the board it hands back is legal and actually rearranged
      expect(overlappingPairs(
        result.placements.map((p) => ({ id: p.id, x: p.x, y: p.y })), pedalsById
      )).toEqual([]);
      expect(result.placements.some((p, i) => p.x !== placed[i].xInches)).toBe(true);
    }
  });

  it('declines to act on an over-full board rather than stacking pedals', () => {
    // Twelve 5.08in-deep pedals will not fit a 16x10in board: two rows of
    // 5.08in leaves 10.16in of depth, so the third row has nowhere to go, and
    // one row holds at most five. The engine must say so, not improvise.
    const board = {
      id: 'b', name: 'b', widthInches: 16, depthInches: 10,
      railWidthInches: 0.6, isSystem: true,
    } as Board;
    const pedalsById: Record<string, Pedal> = {};
    const placed: PlacedPedal[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `p${i}`;
      pedalsById[id] = {
        id, name: id, manufacturer: 'T', category: 'utility',
        widthInches: 2.87, depthInches: 5.08, heightInches: 2, jacks: [],
      } as unknown as Pedal;
      placed.push({
        id, pedalId: id, pedal: pedalsById[id],
        xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: i + 1,
      } as unknown as PlacedPedal);
    }

    const result = calculateOptimalLayoutJoint(placed, pedalsById, board, ROUTING);

    // The contract: it reports that nothing legal was found, and leaves the
    // caller's positions alone rather than inventing an overlapping layout.
    expect(result.noLegalCandidate).toBe(true);
    for (const p of result.placements) {
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    }
  });
});
