/**
 * End-to-end: run the real optimizer on a real board and check that the
 * reported explanation matches the scores it actually chose with.
 */
import { describe, expect, it } from 'vitest';
import { calculateOptimalLayoutJoint } from '../index';
import { summarizeOptimization } from '../routing-cost';
import type { Board, Pedal, PlacedPedal } from '@/types';

const board: Board = {
  id: 'b1', name: 'Test', widthInches: 24, depthInches: 12,
  railWidthInches: 0.6, isSystem: true,
} as Board;

function pedal(id: string, category: string): Pedal {
  return {
    id, name: id, manufacturer: 'T', category,
    widthInches: 2.9, depthInches: 5.1, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

/** Pedals deliberately scattered so optimizing has something to fix */
function scattered(): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const specs = [
    ['tuner', 'tuner', 18, 6], ['od', 'overdrive', 3, 1],
    ['dist', 'distortion', 15, 0.5], ['delay', 'delay', 1, 6],
    ['verb', 'reverb', 9, 3],
  ] as const;
  const byId: Record<string, Pedal> = {};
  const placed = specs.map(([id, cat, x, y], i) => {
    byId[id] = pedal(id, cat);
    return {
      id, pedalId: id, pedal: byId[id], xInches: x, yInches: y,
      rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
    } as unknown as PlacedPedal;
  });
  return { placed, byId };
}

describe('optimize end-to-end', () => {
  it('returns both costs, and the reported total is the sum of its dimensions', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);

    expect(result.baselineCost).toBeDefined();
    expect(result.cost).toBeDefined();

    for (const c of [result.baselineCost!, result.cost!]) {
      const sum = c.dimensions.reduce((s, d) => s + d.value, 0);
      expect(c.totalScore).toBeCloseTo(sum, 6);
      expect(c.dimensions.length).toBeGreaterThan(0);
    }
  });

  it('baseline scores the board as the user left it, not a re-placed one', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);

    // The baseline's cable length must reflect the scattered input. If it had
    // been computed from a greedy re-placement it would match the optimized
    // length, and the whole before/after comparison would be meaningless.
    expect(result.baselineCost!.totalLengthInches).not.toBeCloseTo(
      result.cost!.totalLengthInches, 3
    );
  });

  it('every routed cable records which strategy produced it', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);
    const details = result.cost!.cableDetails;

    expect(details.length).toBeGreaterThan(0);
    const known = new Set([
      'facing', 'direct', 'l-horizontal', 'l-vertical', 'channel',
      'above', 'below', 'safe-lane', 'astar', 'fallback-invalid',
    ]);
    for (const d of details) expect(known).toContain(d.strategy);
  });

  it('the summary describes the same numbers the optimizer compared', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);
    const s = summarizeOptimization(result.baselineCost!, result.cost!);

    expect(s.before).toBe(result.baselineCost!.totalScore);
    expect(s.after).toBe(result.cost!.totalScore);
    expect(s.delta).toBeCloseTo(result.cost!.totalScore - result.baselineCost!.totalScore, 6);
    // Each reported change must equal the actual per-dimension difference
    for (const c of s.changes) {
      const b = result.baselineCost!.dimensions.find((d) => d.key === c.key)!;
      const a = result.cost!.dimensions.find((d) => d.key === c.key)!;
      expect(c.delta).toBeCloseTo(a.value - b.value, 6);
    }
    expect(s.headline.length).toBeGreaterThan(0);
  });

  it('re-optimizing an already-optimized board reports no change', () => {
    const { placed, byId } = scattered();
    const first = calculateOptimalLayoutJoint(placed, byId, board);

    // Feed the optimized positions back in
    const settled = placed.map((p) => {
      const pl = first.placements.find((q) => q.id === p.id)!;
      return { ...p, xInches: pl.x, yInches: pl.y };
    });
    const second = calculateOptimalLayoutJoint(settled, byId, board);
    const s = summarizeOptimization(second.baselineCost!, second.cost!);

    expect(s.delta).toBeCloseTo(0, 6);
    expect(s.headline).toMatch(/already optimal/i);
  });
});
