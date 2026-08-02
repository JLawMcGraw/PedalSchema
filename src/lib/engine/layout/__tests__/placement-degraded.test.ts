/**
 * A degraded placement says so.
 *
 * `placementDegraded` has existed inside calculateGreedyPlacement since the
 * retry loop was written, and never left the function. So a layout salvaged by
 * "put it anywhere on the board" was indistinguishable, to every caller, from
 * one that honoured the row and clearance rules. findValidPositionInZone makes
 * that worse: two of its returns do no validity check at all - the narrow-zone
 * bail and the terminal "truly full board" clamp - and its return type is
 * non-nullable, so callers have no failure branch either.
 *
 * The fix is to report honestly, not to fail differently. Returning null was
 * tried before and turns a wrong answer into no answer.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateGreedyPlacement,
  calculateGreedyPlacementWithDiagnostics,
  calculateOptimalLayoutJoint,
} from '../index';
import type { Board, Pedal, PlacedPedal } from '@/types';

function pedal(id: string, w = 2.9, d = 5.1): Pedal {
  return {
    id, name: id, manufacturer: 'T', category: 'overdrive',
    widthInches: w, depthInches: d, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

function boardOf(w: number, d: number): Board {
  return {
    id: 'b', name: 'B', widthInches: w, depthInches: d,
    railWidthInches: 0.6, isSystem: true,
  } as Board;
}

function place(n: number): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const byId: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    byId[id] = pedal(id);
    placed.push({
      id, pedalId: id, xInches: 0, yInches: 0, rotationDegrees: 0,
      chainPosition: i + 1, location: 'front_of_amp', isActive: true,
      pedal: byId[id],
    } as unknown as PlacedPedal);
  }
  return { placed, byId };
}

describe('placement degradation is reported', () => {
  it('a roomy board places cleanly and says so', () => {
    const { placed, byId } = place(3);
    const result = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(32, 16));

    expect(result.placements).toHaveLength(3);
    expect(result.degraded).toBe(false);
  });

  it('a board that cannot hold the pedals reports degraded', () => {
    // Far more pedal than board: the placer must fall back rather than
    // honour its rows.
    const { placed, byId } = place(14);
    const result = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(12, 6));

    expect(result.placements).toHaveLength(14);
    expect(
      result.degraded,
      'the placer cannot have honoured its rules on a board this size'
    ).toBe(true);
  });

  it('the plain call still returns bare placements', () => {
    // 15 existing call sites depend on this shape.
    const { placed, byId } = place(3);
    const plain = calculateGreedyPlacement(placed, byId, boardOf(32, 16));
    const rich = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(32, 16));

    expect(Array.isArray(plain)).toBe(true);
    expect(plain).toEqual(rich.placements);
  });

  it('the optimizer surfaces the winning layout\'s flag, not any candidate\'s', () => {
    const { placed, byId } = place(3);
    const clean = calculateOptimalLayoutJoint(placed, byId, boardOf(32, 16));
    expect(clean.placementDegraded).toBe(false);

    const cramped = place(8);
    const result = calculateOptimalLayoutJoint(cramped.placed, cramped.byId, boardOf(12, 6));
    // Either nothing legal was found, or something was found by giving up on
    // the rules. Both are honest; being silent about both was not.
    expect(result.noLegalCandidate || result.placementDegraded).toBe(true);
  });
});
