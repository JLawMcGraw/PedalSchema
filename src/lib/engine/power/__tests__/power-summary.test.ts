/**
 * The power summary, and above all the tri-state.
 *
 * `Pedal.currentMa` is nullable. The failure this guards against is a `?? 0`
 * in the total, which silently converts "we never recorded this pedal's draw"
 * into "this pedal is free" - and so reports a supply that cannot run the board
 * as one that can. It is the only bug here that would be believed.
 */
import { describe, it, expect } from 'vitest';
import {
  derivePowerSummary, describePowerSummary, TYPICAL_OUTPUT_MA,
} from '../index';
import type { Pedal, PlacedPedal } from '@/types';

const n = 0;
function pedal(over: Partial<Pedal>): Pedal {
  return {
    id: `pedal-${n}`, name: `P${n}`, manufacturer: 'T', category: 'overdrive',
    widthInches: 2.87, depthInches: 5.08, heightInches: 2.37,
    voltage: 9, currentMa: 50, polarity: 'center_negative', jacks: [],
    ...over,
  } as Pedal;
}

function board(pedals: Pedal[]): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const byId: Record<string, Pedal> = {};
  const placed = pedals.map((p, i) => {
    byId[p.id] = p;
    return {
      id: `placed-${i}`, pedalId: p.id, pedal: p,
      xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: i + 1,
      isActive: true, useLoop: false,
    } as PlacedPedal;
  });
  return { placed, byId };
}

describe('power summary', () => {
  it('adds up the pedals it knows about', () => {
    const { placed, byId } = board([
      pedal({ id: 'a', name: 'A', currentMa: 25 }),
      pedal({ id: 'b', name: 'B', currentMa: 75 }),
    ]);
    const s = derivePowerSummary(placed, byId);
    expect(s.knownTotalMa).toBe(100);
    expect(s.unknown).toEqual([]);
    expect(s.pedalCount).toBe(2);
  });

  describe('an unrecorded draw is not a draw of zero', () => {
    it('keeps the unknown OUT of the total and names it', () => {
      const { placed, byId } = board([
        pedal({ id: 'a', name: 'Known', currentMa: 300 }),
        pedal({ id: 'b', name: 'IR-200', currentMa: null as unknown as number }),
      ]);
      const s = derivePowerSummary(placed, byId);

      // 300, not 300-treated-as-complete and not 300 + 0 passed off as a fact
      expect(s.knownTotalMa).toBe(300);
      expect(s.unknown).toEqual([{ placedPedalId: 'placed-1', name: 'IR-200' }]);
      expect(s.pedalCount).toBe(2);
    });

    it('says so in words, because a bare number would be believed', () => {
      const { placed, byId } = board([
        pedal({ id: 'a', currentMa: 986 }),
        pedal({ id: 'b', name: 'IR-200', currentMa: null as unknown as number }),
      ]);
      const text = describePowerSummary(derivePowerSummary(placed, byId));
      expect(text).toContain('At least 986mA');
      expect(text).toContain('1 pedal has no recorded draw');
      // The failure mode in one assertion: it must never present a floor as a total
      expect(text).not.toMatch(/^986mA across/);
    });

    it('handles undefined the same as null', () => {
      // The column is nullable in the database and optional in the type; both
      // reach this code, and `== null` is what covers the pair.
      const { placed, byId } = board([
        pedal({ id: 'a', currentMa: 40 }),
        pedal({ id: 'b', currentMa: undefined as unknown as number }),
      ]);
      const s = derivePowerSummary(placed, byId);
      expect(s.knownTotalMa).toBe(40);
      expect(s.unknown).toHaveLength(1);
    });

    it('does not claim a total when nothing is known', () => {
      const { placed, byId } = board([
        pedal({ id: 'a', currentMa: null as unknown as number }),
        pedal({ id: 'b', currentMa: null as unknown as number }),
      ]);
      const s = derivePowerSummary(placed, byId);
      expect(s.knownTotalMa).toBe(0);
      expect(describePowerSummary(s)).toBe('Draw unknown for all 2 pedals.');
    });
  });

  it('counts a bypassed pedal - it is still plugged in', () => {
    // isActive is a signal-path state, not a power state. Excluding switched-off
    // pedals would under-report the board someone is about to build.
    const { placed, byId } = board([
      pedal({ id: 'a', currentMa: 100 }),
      pedal({ id: 'b', currentMa: 200 }),
    ]);
    placed[1].isActive = false;
    expect(derivePowerSummary(placed, byId).knownTotalMa).toBe(300);
  });

  it('flags the pedals a typical output cannot carry', () => {
    // The real case: two Strymons at 300mA on a board of BOSS compacts. The
    // total does not express this - each needs an output to itself.
    const { placed, byId } = board([
      pedal({ id: 'a', name: 'DS-1', currentMa: 25 }),
      pedal({ id: 'b', name: 'BigSky', currentMa: 300 }),
      pedal({ id: 'c', name: 'Flint', currentMa: 300 }),
      pedal({ id: 'd', name: 'Borderline', currentMa: TYPICAL_OUTPUT_MA }),
    ]);
    const s = derivePowerSummary(placed, byId);
    expect(s.highDraw.map((h) => h.name)).toEqual(['BigSky', 'Flint']);
    // Exactly at the rating is not over it
    expect(s.highDraw.some((h) => h.name === 'Borderline')).toBe(false);
  });

  it('splits by voltage - an 18V pedal cannot share a 9V output', () => {
    const { placed, byId } = board([
      pedal({ id: 'a', voltage: 9, currentMa: 50 }),
      pedal({ id: 'b', voltage: 18, currentMa: 30 }),
      pedal({ id: 'c', voltage: 18, currentMa: null as unknown as number }),
    ]);
    const s = derivePowerSummary(placed, byId);
    expect(s.byVoltage).toEqual([
      { voltage: 9, knownTotalMa: 50, pedalCount: 1, unknownCount: 0 },
      { voltage: 18, knownTotalMa: 30, pedalCount: 2, unknownCount: 1 },
    ]);
  });

  it('is empty for an empty board', () => {
    const s = derivePowerSummary([], {});
    expect(s.knownTotalMa).toBe(0);
    expect(s.pedalCount).toBe(0);
    expect(describePowerSummary(s)).toBe('No pedals on the board.');
  });
});
