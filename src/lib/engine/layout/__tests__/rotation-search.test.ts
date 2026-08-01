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
import type { RoutingConfig } from '@/types';

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

describe('rotation search', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  it('picks the orientation with the lowest routed cost for an eligible top-jack pedal', () => {
    const board = makeBoard('wide');
    const set = withCompactTopJackPedal(makePedalSet('twelve'));
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    // Ground truth: evaluate all four orientations directly
    const scores = new Map<number, number>();
    for (const rotation of [0, 90, 180, 270]) {
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

  it('turns a LARGE top-jack pedal - size does not veto, the search decides fit', () => {
    // EQ-200 at its real 3.98 x 5.43in. The old width veto refused this, which
    // meant refusing the whole catalogue: every top-jack pedal is wide, because
    // that is why it has room for jacks on top. Whether it still fits turned is
    // answered by hasPlacementCollision, not by a threshold.
    const board = makeBoard('wide');
    const set = makePedalSet('twelve');
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    // The temptation has to be real or this test proves nothing
    const scores = [0, 90, 180, 270].map((r) => scoreAtRotation(set, board, eq.id, r));
    expect(Math.min(...scores)).toBeLessThan(scores[0] - 1e-6);

    const result = calculateOptimalLayoutJoint(set.placedPedals, set.pedalsById, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === eq.id)).toBeDefined();
  });

  it('refuses a pedal the owner locked, even though turning it would score better', () => {
    // Same board and same temptation as the test above, one field different.
    const board = makeBoard('wide');
    const set = makePedalSet('twelve');
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    const scores = [0, 90, 180, 270].map((r) => scoreAtRotation(set, board, eq.id, r));
    expect(Math.min(...scores)).toBeLessThan(scores[0] - 1e-6);

    const locked = set.placedPedals.map((p) =>
      p.id === eq.id ? { ...p, rotationLocked: true } : p);
    const result = calculateOptimalLayoutJoint(locked, set.pedalsById, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === eq.id)).toBeUndefined();
  });

  it('refuses a treadle outright - no lock needed, and no unlock available', () => {
    // A treadle cannot be rocked on its side. That is not a preference, so it
    // is not stored as one: rotationLocked false must NOT make it eligible.
    //
    // The pedal here is the EQ-200 of the test above with its CATEGORY changed
    // and nothing else - same enclosure, same jacks, same board - so the only
    // thing that can explain a different outcome is foot-sweptness. (A deeper,
    // treadle-shaped enclosure would have confounded it: at 7.56in deep no
    // rotation improved the score at all, and the refusal would have been
    // vacuous. Verified, not assumed.)
    const board = makeBoard('wide');
    const set = makePedalSet('twelve');
    const treadle = { ...set.pedalsById.eq, category: 'volume' as const };
    const treadleSet = { ...set, pedalsById: { ...set.pedalsById, eq: treadle } };
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    // The temptation must be real, or the refusal below proves nothing
    const scores = [0, 90, 180, 270].map((r) => scoreAtRotation(treadleSet, board, eq.id, r));
    expect(Math.min(...scores)).toBeLessThan(scores[0] - 1e-6);

    const unlocked = set.placedPedals.map((p) =>
      p.id === eq.id ? { ...p, rotationLocked: false } : p);
    const result = calculateOptimalLayoutJoint(unlocked, treadleSet.pedalsById, board, routingConfig);
    expect(result.rotations?.find((r) => r.id === eq.id)).toBeUndefined();
  });

  it('leaves every pedal alone when rotation is switched off', () => {
    const board = makeBoard('wide');
    const set = withCompactTopJackPedal(makePedalSet('twelve'));
    const eq = set.placedPedals.find((p) => p.pedalId === 'eq')!;

    // Same board that DOES get rotated when the toggle is on
    const on = calculateOptimalLayoutJoint(set.placedPedals, set.pedalsById, board, {
      ...routingConfig, allowRotation: true,
    });
    expect(on.rotations?.find((r) => r.id === eq.id)).toBeDefined();

    const off = calculateOptimalLayoutJoint(set.placedPedals, set.pedalsById, board, {
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
