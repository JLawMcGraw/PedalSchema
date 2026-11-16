/**
 * Optimize does not rearrange a legal board for less than an inch of cable.
 *
 * Any strict improvement used to be enough. Measured on the owner's 22-pedal
 * board, 2026-11-16: one press moved seven pedals to take the score from
 * 459.69 to 459.20 - half an inch, for seven pedals to pick up and re-stick,
 * an undo entry, and a saved board marked unsaved.
 *
 * See MIN_WORTHWHILE_GAIN_INCHES in ../index.ts. This file was run against
 * the old threshold first; the first test fails there.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PlacedPedal, RoutingConfig } from '@/types';
import { makeBoard, makePedalSet } from '../../__tests__/support/fixtures';
import { signalChainEngine } from '../../signal-chain';
import { detectCollisions } from '../../collision';
import { calculateOptimalLayoutJoint } from '../index';

const routingConfig: RoutingConfig = {
  useLoopPedals: true, use4CableMethod: false, useEffectsLoop: false, pedalConfigs: [],
};

/**
 * Three pedals on the 22in board, laid out by the optimizer itself: one row
 * along the front, with the back of the board empty to slide into.
 */
function optimized() {
  const board = makeBoard('wide');
  const set = makePedalSet('trio');
  const pedals = signalChainEngine.calculate(set.placedPedals, set.pedalsById, {
    ampHasEffectsLoop: true, useEffectsLoop: false, use4CableMethod: false,
    modulationInLoop: false, loopType: 'series',
  }).orderedPedals;
  const layout = calculateOptimalLayoutJoint(pedals, set.pedalsById, board, routingConfig);
  const at = new Map(layout.placements.map((p) => [p.id, p]));
  const chain = new Map(layout.chainOrder.map((id, i) => [id, i + 1]));
  const placed: PlacedPedal[] = pedals.map((p) => ({
    ...p, xInches: at.get(p.id)!.x, yInches: at.get(p.id)!.y,
    chainPosition: layout.swappableGroups.length > 0 ? chain.get(p.id)! : p.chainPosition,
  }));
  return { board, pedalsById: set.pedalsById, placed, best: layout.cost!.totalScore };
}

/**
 * The middle pedal of the row pushed toward the back of the board by `inches`.
 * Its two neighbours' cables each have to jog that far to reach it; nothing
 * else changes.
 */
function withMiddlePedalPushedBack(pedals: PlacedPedal[], inches: number): PlacedPedal[] {
  const middle = [...pedals].sort((a, b) => a.chainPosition - b.chainPosition)[Math.floor(pedals.length / 2)];
  return pedals.map((p) => (p.id === middle.id ? { ...p, yInches: p.yInches - inches } : p));
}

describe('a gain too small to move pedals for', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  it('leaves a legal board alone when the best alternative saves under an inch', () => {
    const { board, pedalsById, placed, best } = optimized();
    // One pedal a fifth of an inch out of line: two cables a fifth of an inch
    // longer each, and nothing else to choose between the layouts.
    const nudged = withMiddlePedalPushedBack(placed, 0.2);
    expect(detectCollisions(nudged, pedalsById, board)).toEqual([]);

    const result = calculateOptimalLayoutJoint(nudged, pedalsById, board, routingConfig);

    // The precondition: something better exists, and it is better by less
    // than an inch. Without both halves this test proves nothing.
    const gap = result.baselineCost!.totalScore - best;
    expect(gap).toBeGreaterThan(0.01);
    expect(gap).toBeLessThan(1);

    for (const p of result.placements) {
      const original = nudged.find((q) => q.id === p.id)!;
      expect(p.x).toBe(original.xInches);
      expect(p.y).toBe(original.yInches);
    }
    expect(result.rotations).toBeUndefined();
    expect(result.cost!.totalScore).toBe(result.baselineCost!.totalScore);
  });

  it('still moves the board when there is an inch or more to gain', () => {
    const { board, pedalsById, placed, best } = optimized();
    // Far enough out of line that the pedal is off its row, which the score
    // charges for in its own right.
    const displaced = withMiddlePedalPushedBack(placed, 0.8);
    expect(detectCollisions(displaced, pedalsById, board)).toEqual([]);

    const result = calculateOptimalLayoutJoint(displaced, pedalsById, board, routingConfig);

    expect(result.baselineCost!.totalScore - best).toBeGreaterThanOrEqual(1);
    expect(result.cost!.totalScore).toBeCloseTo(best, 6);
    expect(result.placements.some((p) => {
      const original = displaced.find((q) => q.id === p.id)!;
      return Math.abs(p.y - original.yInches) > 0.1;
    })).toBe(true);
  });
});
