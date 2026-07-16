/**
 * Greedy Placement Tests
 *
 * Verifies the row-overflow behavior that placed chain-end pedals in the
 * wrong order (BF-3 left of RC-1 on the user's board): when a chain wraps
 * to a new row, the remaining pedals must pack against the amp-side (left)
 * edge in chain order, so the LAST pedal lands closest to the amp.
 */

import { describe, it, expect } from 'vitest';
import type { Board, Pedal, PlacedPedal } from '@/types';
import { calculateGreedyPlacement } from '../index';
import { COLLISION_SPACING } from '../../collision';

const NOW = '2024-01-01T00:00:00Z';

// The user's real board: Pedaltrain Classic Jr, 18" x 12.5"
function makeBoard(): Board {
  return {
    id: 'board-jr',
    name: 'Pedaltrain Classic Jr',
    manufacturer: 'Pedaltrain',
    widthInches: 18,
    depthInches: 12.5,
    railWidthInches: 2,
    clearanceUnderInches: null,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    rails: [
      { id: 'r1', boardId: 'board-jr', positionFromBackInches: 0, sortOrder: 1 },
      { id: 'r2', boardId: 'board-jr', positionFromBackInches: 3.1, sortOrder: 2 },
      { id: 'r3', boardId: 'board-jr', positionFromBackInches: 6.2, sortOrder: 3 },
      { id: 'r4', boardId: 'board-jr', positionFromBackInches: 9.3, sortOrder: 4 },
    ],
  };
}

function makePedal(id: string): Pedal {
  return {
    id,
    name: `Pedal ${id}`,
    manufacturer: 'Test',
    category: 'overdrive',
    widthInches: 2.87,
    depthInches: 5.08,
    heightInches: 2.37,
    voltage: 9,
    currentMa: 50,
    polarity: 'center_negative',
    defaultChainPosition: null,
    preferredLocation: 'front_of_amp',
    supports4Cable: false,
    needsBufferBefore: false,
    needsDirectPickup: false,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    notes: null,
    jacks: [],
  } as Pedal;
}

function makePlaced(id: string, pedalId: string, chainPosition: number): PlacedPedal {
  return {
    id,
    configurationId: 'config-1',
    pedalId,
    xInches: 0,
    yInches: 0,
    rotationDegrees: 0,
    chainPosition,
    location: 'front_of_amp',
    isActive: true,
    useLoop: false,
    createdAt: NOW,
  };
}

describe('greedy placement row overflow (regression: BF-3 / RC-1 inversion)', () => {
  it('packs overflow pedals against the amp side in chain order', () => {
    // 7 pedals like the user's board: 5 fit the first row, 2 overflow
    const pedalsById: Record<string, Pedal> = {};
    const placed: PlacedPedal[] = [];
    for (let i = 1; i <= 7; i++) {
      const pedal = makePedal(`pedal-${i}`);
      pedalsById[pedal.id] = pedal;
      placed.push(makePlaced(`c${i}`, pedal.id, i));
    }

    const board = makeBoard();
    const placements = calculateGreedyPlacement(placed, pedalsById, board);
    const byId = new Map(placements.map((p) => [p.id, p]));

    const c5 = byId.get('c5')!;
    const c6 = byId.get('c6')!;
    const c7 = byId.get('c7')!;

    // Chain 6 and 7 overflow to a different row than chain 5
    expect(Math.abs(c6.y - c5.y)).toBeGreaterThan(1);
    expect(c7.y).toBeCloseTo(c6.y, 1);

    // Within the overflow row, chain order is preserved right-to-left:
    // chain 7 (last, closest to amp) is LEFT of chain 6
    expect(c7.x).toBeLessThan(c6.x);

    // And the chain end packs against the amp-side edge
    expect(c7.x).toBeLessThanOrEqual(0.01);
    expect(c6.x).toBeCloseTo(2.87 + COLLISION_SPACING, 1);

    // First row keeps strict right-to-left order
    const rowOne = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => byId.get(id)!);
    for (let i = 0; i < rowOne.length - 1; i++) {
      expect(rowOne[i].x).toBeGreaterThan(rowOne[i + 1].x);
    }
  });
});

describe('effects loop zone placement (regression: loop pedals placed backwards)', () => {
  it('packs the loop chain right-to-left against the amp side', () => {
    // 5 front pedals + 2 loop pedals (like BF-3 chain 6, RC-1 chain 7)
    const pedalsById: Record<string, Pedal> = {};
    const placed: PlacedPedal[] = [];
    for (let i = 1; i <= 7; i++) {
      const pedal = makePedal(`pedal-${i}`);
      pedalsById[pedal.id] = pedal;
      const p = makePlaced(`c${i}`, pedal.id, i);
      if (i >= 6) {
        p.location = 'effects_loop';
        p.locationOverride = true;
      }
      placed.push(p);
    }

    const board = makeBoard();
    const placements = calculateGreedyPlacement(placed, pedalsById, board, {
      useLoopPedals: true,
      use4CableMethod: false,
      useEffectsLoop: true,
      pedalConfigs: [],
    });
    const byId = new Map(placements.map((p) => [p.id, p]));

    const c6 = byId.get('c6')!; // first loop pedal (from amp send)
    const c7 = byId.get('c7')!; // last loop pedal (into amp return)

    // Loop chain flows right-to-left: chain 7 (into amp return) is LEFT of
    // chain 6, packed against the amp-side edge
    expect(c7.x).toBeLessThan(c6.x);
    expect(c7.x).toBeLessThanOrEqual(0.01);
    expect(c6.x).toBeCloseTo(2.87 + COLLISION_SPACING, 1);
  });
});

describe('loop pedal gets the amp-side corner of the jack-nearest row', () => {
  it('places the loop pedal top-left with the front overflow beside it (user board)', () => {
    // The user's exact FX-loop scenario: 6 front pedals + RC-1 alone in the
    // loop. RC-1 must take the TOP-LEFT corner (nearest SND/RTN); the front
    // chain's overflow pedal (BF-3) slides in to its right.
    const pedalsById: Record<string, Pedal> = {};
    const placed: PlacedPedal[] = [];
    for (let i = 1; i <= 7; i++) {
      const pedal = makePedal(`pedal-${i}`);
      pedalsById[pedal.id] = pedal;
      const p = makePlaced(`c${i}`, pedal.id, i);
      if (i === 7) {
        p.location = 'effects_loop';
        p.locationOverride = true;
      }
      placed.push(p);
    }

    const board = makeBoard();
    const placements = calculateGreedyPlacement(placed, pedalsById, board, {
      useLoopPedals: true,
      use4CableMethod: false,
      useEffectsLoop: true,
      pedalConfigs: [],
    });
    const byId = new Map(placements.map((p) => [p.id, p]));

    const loopPedal = byId.get('c7')!;   // RC-1
    const overflow = byId.get('c6')!;    // BF-3 (6th front pedal, overflows)
    const front1 = byId.get('c1')!;

    // Loop pedal: amp-side corner of the TOP row (nearest SND/RTN jacks)
    expect(loopPedal.x).toBeLessThanOrEqual(0.01);
    expect(loopPedal.y).toBeLessThan(front1.y); // top row, front chain on bottom

    // Front overflow shares the top row, to the RIGHT of the loop pedal
    expect(Math.abs(overflow.y - loopPedal.y)).toBeLessThan(1);
    expect(overflow.x).toBeGreaterThan(loopPedal.x + 2.87);
  });
});
