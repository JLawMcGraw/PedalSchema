/**
 * Rotation-aware placement search (roadmap Phase 4)
 *
 * The optimizer must pick the jack orientation that minimizes the routed cost
 * for pedals whose rotation changes jack FACING - and stay deterministic and
 * idempotent.
 *
 * It must ALSO refuse to turn a pedal you could not then operate, even when
 * turning it would score better. That is not a cost question, so the cost
 * function cannot express it: see ../rotation-eligibility.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { makeBoard, makePedalSet, type PedalSet } from '../../__tests__/support/fixtures';
import { calculateOptimalLayoutJoint, calculateGreedyPlacement } from '../index';
import { calculateRoutingCost } from '../routing-cost';
import { mayRotateTo, isLargePedal } from '../rotation-eligibility';
import type { Pedal, PlacedPedal, RoutingConfig } from '@/types';

/**
 * The angles the optimizer is allowed to choose. Ground truth has to be
 * computed over THESE, not over all four - a half turn leaves the pedal upside
 * down and is refused whatever it scores, so including it would assert the
 * search should do something it is forbidden to do.
 */
const ALLOWED = [0, 90, 180, 270].filter((r) => mayRotateTo(r));

const routingConfig: RoutingConfig = {
  useLoopPedals: true, use4CableMethod: false, useEffectsLoop: false, pedalConfigs: [],
};

function scoreAtRotation(set: PedalSet, board: ReturnType<typeof makeBoard>, eqId: string, rotation: number): number {
  const pedals = set.placedPedals.map((p) =>
    p.id === eqId ? { ...p, rotationDegrees: rotation } : p);
  const placements = calculateGreedyPlacement(pedals, set.pedalsById, board, routingConfig);
  return calculateRoutingCost(
    placements, pedals, set.pedalsById, board, undefined, false, false, routingConfig
  ).totalScore;
}

/**
 * The same twelve-pedal set with the top-jack pedal shrunk to a compact
 * enclosure, so it passes the size guard and the search may actually turn it.
 * Real hardware this stands in for: the many modern compacts that put their
 * jacks on the top edge.
 */
function withCompactTopJackPedal(set: PedalSet): PedalSet {
  return {
    ...set,
    pedalsById: {
      ...set.pedalsById,
      eq: { ...set.pedalsById.eq, widthInches: 2.87, depthInches: 5.08 },
    },
  };
}


/**
 * A board where a QUARTER turn genuinely pays, which the twelve-pedal set is
 * not: there the only rotation that ever improved anything was the half turn,
 * and half turns are refused (they leave the pedal upside down). A test whose
 * only temptation is a forbidden angle proves nothing - it would pass whether
 * or not the rule under test existed.
 *
 * This is the shape that does pay, and it is the real one: a top-jack pedal
 * added mid-chain to a small board. Turning it swaps a 6.5 x 5.1in footprint
 * to 5.1 x 6.5in, which fits the rows differently and shortens the run
 * dramatically - 134.17 at rest against 51.61 turned.
 */
function withTopJackPedal(
  size: { widthInches: number; depthInches: number },
  chainPosition = 3
): { placed: PlacedPedal[]; pedalsById: Record<string, Pedal>; id: string } {
  const base = makePedalSet('trio');
  const extra = {
    id: 'topjack', name: 'TopJack', manufacturer: 'Strymon', category: 'reverb',
    heightInches: 1.6, voltage: 9, currentMa: 300, preferredLocation: 'front_of_amp',
    ...size,
    jacks: [
      { id: 'tj0', pedalId: 'topjack', jackType: 'output', side: 'top', positionPercent: 20, label: 'OUT' },
      { id: 'tj1', pedalId: 'topjack', jackType: 'input', side: 'top', positionPercent: 80, label: 'IN' },
    ],
  } as unknown as Pedal;
  return {
    pedalsById: { ...base.pedalsById, topjack: extra },
    placed: [...base.placedPedals, {
      id: 'p-topjack', pedalId: 'topjack', pedal: extra, xInches: 1, yInches: 1,
      rotationDegrees: 0, chainPosition, isActive: true, useLoop: false,
      location: 'front_of_amp',
    } as unknown as PlacedPedal],
    id: 'p-topjack',
  };
}

/** Score that fixture with the added pedal at a given angle. */
function scoreFixtureAt(
  f: ReturnType<typeof withTopJackPedal>,
  board: ReturnType<typeof makeBoard>,
  rotation: number
): number {
  const pedals = f.placed.map((p) => (p.id === f.id ? { ...p, rotationDegrees: rotation } : p));
  const placements = calculateGreedyPlacement(pedals, f.pedalsById, board, routingConfig);
  return calculateRoutingCost(
    placements, pedals, f.pedalsById, board, undefined, false, false, routingConfig
  ).totalScore;
}

/** Assert a PERMITTED rotation beats leaving it alone - or the test is empty. */
function expectRealTemptation(
  f: ReturnType<typeof withTopJackPedal>,
  board: ReturnType<typeof makeBoard>
): void {
  const rest = scoreFixtureAt(f, board, 0);
  const best = Math.min(...ALLOWED.filter((r) => r !== 0).map((r) => scoreFixtureAt(f, board, r)));
  expect(best, 'no permitted rotation improves this board, so the case is vacuous')
    .toBeLessThan(rest - 1e-6);
}

describe('rotation search', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  it('picks the orientation with the lowest routed cost for an eligible top-jack pedal', () => {
    const board = makeBoard('wide');
    const set = withCompactTopJackPedal(makePedalSet('twelve'));
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    // Ground truth: evaluate every PERMITTED orientation directly
    const scores = new Map<number, number>();
    for (const rotation of ALLOWED) {
      scores.set(rotation, scoreAtRotation(set, board, eq.id, rotation));
    }
    const bestScore = Math.min(...scores.values());

    const result = calculateOptimalLayoutJoint(set.placedPedals, set.pedalsById, board, routingConfig);
    const chosenRotation = result.rotations?.find((r) => r.id === eq.id)?.rotationDegrees ?? 0;

    // The optimizer's choice must match the best achievable single-pedal
    // rotation (or beat it via combined order+rotation search)
    const pedalsWithChoice = set.placedPedals.map((p) => {
      const placement = result.placements.find((pl) => pl.id === p.id)!;
      const rot = result.rotations?.find((r) => r.id === p.id)?.rotationDegrees ?? p.rotationDegrees;
      return { ...p, xInches: placement.x, yInches: placement.y, rotationDegrees: rot,
        chainPosition: result.chainOrder.indexOf(p.id) + 1 };
    });
    const achieved = calculateRoutingCost(
      result.placements, pedalsWithChoice, set.pedalsById, board, undefined, false, false, routingConfig
    ).totalScore;

    expect(achieved).toBeLessThanOrEqual(bestScore + 1e-6);

    // If a non-zero rotation is strictly better, the search must have taken it
    if (bestScore < scores.get(0)! - 1e-6) {
      expect(chosenRotation).not.toBe(0);
    }
  });

  it('turns a genuinely LARGE top-jack pedal - size is a default, not a veto', () => {
    // 6.5 x 5.1in, the Strymon footprint, which IS large by isLargePedal. The
    // engine must still consider it: the size test is the DEFAULT for the
    // per-board lock, applied when a pedal is added, never a rule in here.
    // (Written first with EQ-200, which stopped being "large" when the
    // threshold moved to 4.5in - the test name had outlived its fixture.)
    const board = makeBoard('jr');
    const f = withTopJackPedal({ widthInches: 6.5, depthInches: 5.1 });
    expect(isLargePedal(f.pedalsById.topjack)).toBe(true);
    expectRealTemptation(f, board);

    const result = calculateOptimalLayoutJoint(f.placed, f.pedalsById, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === f.id)).toBeDefined();
  });

  it('refuses a pedal the owner locked, even though turning it would score better', () => {
    // Same board and the same real temptation as above, one field different.
    const board = makeBoard('jr');
    const f = withTopJackPedal({ widthInches: 6.5, depthInches: 5.1 });
    expectRealTemptation(f, board);

    const locked = f.placed.map((p) => (p.id === f.id ? { ...p, rotationLocked: true } : p));
    const result = calculateOptimalLayoutJoint(locked, f.pedalsById, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === f.id)).toBeUndefined();
  });

  it('refuses a treadle outright - no lock needed, and no unlock available', () => {
    // The pedal above with its CATEGORY changed and nothing else: same
    // enclosure, same jacks, same board, same temptation. So foot-sweptness is
    // the only thing that can explain the different outcome.
    const board = makeBoard('jr');
    const f = withTopJackPedal({ widthInches: 6.5, depthInches: 5.1 });
    expectRealTemptation(f, board);

    const treadle = { ...f.pedalsById.topjack, category: 'volume' as const };
    const treadleSet = { ...f.pedalsById, topjack: treadle };
    const unlocked = f.placed.map((p) => (p.id === f.id ? { ...p, rotationLocked: false } : p));
    const result = calculateOptimalLayoutJoint(unlocked, treadleSet, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === f.id)).toBeUndefined();
  });

  it('leaves every pedal alone when rotation is switched off', () => {
    const board = makeBoard('jr');
    const f = withTopJackPedal({ widthInches: 6.5, depthInches: 5.1 });
    expectRealTemptation(f, board);

    // The same board that DOES get turned with the toggle on
    const on = calculateOptimalLayoutJoint(f.placed, f.pedalsById, board, {
      ...routingConfig, allowRotation: true,
    });
    expect(on.rotations?.find((r) => r.id === f.id)).toBeDefined();

    const off = calculateOptimalLayoutJoint(f.placed, f.pedalsById, board, {
      ...routingConfig, allowRotation: false,
    });
    expect(off.rotations ?? []).toEqual([]);
  });

  it('is idempotent: re-optimizing keeps the chosen rotation', () => {
    const board = makeBoard('wide');
    const set = withCompactTopJackPedal(makePedalSet('twelve'));

    const first = calculateOptimalLayoutJoint(set.placedPedals, set.pedalsById, board, routingConfig);
    const rotationById = new Map((first.rotations ?? []).map((r) => [r.id, r.rotationDegrees]));
    const placementById = new Map(first.placements.map((p) => [p.id, p]));
    const applied = set.placedPedals.map((p) => ({
      ...p,
      xInches: placementById.get(p.id)?.x ?? p.xInches,
      yInches: placementById.get(p.id)?.y ?? p.yInches,
      rotationDegrees: rotationById.get(p.id) ?? p.rotationDegrees,
      chainPosition: first.chainOrder.indexOf(p.id) + 1,
    }));

    const second = calculateOptimalLayoutJoint(applied, set.pedalsById, board, routingConfig);
    // No further rotation changes on the second pass
    expect(second.rotations ?? []).toEqual([]);
  });
});
