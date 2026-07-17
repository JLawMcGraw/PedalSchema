/**
 * Rotation-aware placement search (roadmap Phase 4)
 *
 * The optimizer must pick the jack orientation that minimizes the routed
 * cost for pedals whose rotation changes jack FACING (top/bottom-jack
 * pedals like the EQ-200) - and stay deterministic and idempotent.
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

describe('rotation search', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  it('picks the orientation with the lowest routed cost for a top-jack pedal', () => {
    const board = makeBoard('wide');
    const set = makePedalSet('twelve'); // includes EQ-200 with top jacks
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

  it('is idempotent: re-optimizing keeps the chosen rotation', () => {
    const board = makeBoard('wide');
    const set = makePedalSet('twelve');

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
