/**
 * "Could not fit these pedals on this board" is honest and useless.
 *
 * Phase 6 established the binding constraint is usually CORRIDORS, not area:
 * three rows of ~5.1in pedals on a 16in board leave 0.2in between rows against
 * a ~0.24in patch cable. deriveRows computed that number to place the bands
 * and then discarded it, so nothing downstream could say which constraint bit.
 *
 * The lead is deliberately unchanged - optimize-e2e asserts /could not fit/i -
 * so these tests check what was ADDED, not that the message was replaced.
 */
import { describe, expect, it } from 'vitest';
import { calculateOptimalLayoutJoint } from '../index';
import { summarizeOptimization } from '../routing-cost';
import { deriveRowLayout } from '../rows';
import type { Board, Pedal, PlacedPedal } from '@/types';

function pedal(id: string, depth: number): Pedal {
  return {
    id, name: id, manufacturer: 'T', category: 'overdrive',
    widthInches: 2.9, depthInches: depth, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

const boardOf = (w: number, d: number): Board =>
  ({ id: 'b', name: 'B', widthInches: w, depthInches: d, railWidthInches: 0.6, isSystem: true } as Board);

function place(depths: number[]): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const byId: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  depths.forEach((depth, i) => {
    const id = `p${i}`;
    byId[id] = pedal(id, depth);
    placed.push({
      id, pedalId: id, xInches: 0, yInches: 0, rotationDegrees: 0,
      chainPosition: i + 1, location: 'front_of_amp', isActive: true, pedal: byId[id],
    } as unknown as PlacedPedal);
  });
  return { placed, byId };
}

describe('row arithmetic survives to the surface', () => {
  it('deriveRowLayout reports the corridor it chose', () => {
    const { placed, byId } = place([5.1, 5.1, 5.1, 5.1, 5.1, 5.1]);
    const { rows, fit } = deriveRowLayout(placed, byId, boardOf(24, 16));

    expect(fit.rowCount).toBe(rows.length);
    expect(fit.boardDepthInches).toBe(16);
    expect(fit.deepestPedalInches).toBeCloseTo(5.1, 2);
    // The bands cannot claim more depth than the board has.
    expect(fit.usedInches).toBeLessThanOrEqual(16 + 1e-6);
    expect(fit.corridorInches).toBeGreaterThanOrEqual(0);
  });

  it('a pedal deeper than the board is named as such', () => {
    const { placed, byId } = place([9.5]);
    const fit = deriveRowLayout(placed, byId, boardOf(24, 6)).fit;
    const cost = calculateOptimalLayoutJoint(placed, byId, boardOf(24, 6));

    const summary = summarizeOptimization(
      cost.baselineCost!, cost.cost!, true, fit, false
    );

    expect(summary.headline).toMatch(/could not fit/i);
    expect(summary.headline).toMatch(/9\.5in/);
    expect(summary.headline).toMatch(/6in/);
  });

  it('the generic advice is replaced by real numbers, not appended to', () => {
    const { placed, byId } = place([5.1, 5.1, 5.1]);
    const fit = deriveRowLayout(placed, byId, boardOf(24, 16)).fit;
    const cost = calculateOptimalLayoutJoint(placed, byId, boardOf(24, 16));

    const withFit = summarizeOptimization(cost.baselineCost!, cost.cost!, true, fit, false);
    const withoutFit = summarizeOptimization(cost.baselineCost!, cost.cost!, true);

    expect(withoutFit.headline).toMatch(/Try a larger board or removing a pedal/);
    // Same lead, different tail: the arithmetic, not the platitude.
    expect(withFit.headline).toMatch(/could not fit/i);
    expect(withFit.headline).toMatch(/\d+(\.\d+)?in/);
    expect(withFit.headline).not.toBe(withoutFit.headline);
  });

  it('carries placementDegraded onto the summary', () => {
    const { placed, byId } = place([5.1, 5.1]);
    const cost = calculateOptimalLayoutJoint(placed, byId, boardOf(24, 16));

    expect(
      summarizeOptimization(cost.baselineCost!, cost.cost!, false, undefined, true).placementDegraded
    ).toBe(true);
    expect(
      summarizeOptimization(cost.baselineCost!, cost.cost!, false).placementDegraded
    ).toBe(false);
  });
});
