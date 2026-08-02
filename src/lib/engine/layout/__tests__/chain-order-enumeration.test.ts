import { describe, expect, it } from 'vitest';
import { calculateOptimalLayoutJoint } from '../index';
import type { Board, Pedal, PlacedPedal } from '@/types';

function pedal(id: string): Pedal {
  return {
    id, name: id, manufacturer: 'T', category: 'overdrive',
    widthInches: 2.9, depthInches: 5.1, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

function place(n: number): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const byId: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    byId[id] = pedal(id);
    placed.push({
      id, pedalId: id, xInches: 0, yInches: 0, rotationDegrees: 0,
      chainPosition: i + 1, location: 'front_of_amp', isActive: true, pedal: byId[id],
    } as unknown as PlacedPedal);
  }
  return { placed, byId };
}

const board = (w: number, d: number): Board =>
  ({ id: 'b', name: 'B', widthInches: w, depthInches: d, railWidthInches: 0.6, isSystem: true } as Board);

describe('chain order enumeration is bounded', () => {
  /**
   * enumerateChainOrders built EVERY permutation of a swappable group and let
   * the cap discard the rest. One group of 12 pedals is 12! = 479,001,600
   * arrays to keep 48, and the process ran out of heap - which, in the Web
   * Worker the optimizer runs in, means no reply, no catchable error, and an
   * Optimize button that spins forever.
   *
   * Measured before the fix: 31ms at 6 pedals, 63ms at 8, 1.9s at 10, dead at
   * 12. The wall is steep enough that a timeout is a real assertion here.
   */
  it('a large swappable group does not blow the heap', () => {
    const { placed, byId } = place(12);
    const started = Date.now();

    const result = calculateOptimalLayoutJoint(placed, byId, board(12, 6));

    expect(result.placements).toHaveLength(12);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30000);
});
