/**
 * Derived Board State Tests
 *
 * Verifies that deriveBoardState computes cables/routes/collisions/warnings
 * from source state, and that its memoization returns identity-stable
 * results (the property the UI relies on to avoid re-render storms).
 */

import { describe, it, expect } from 'vitest';
import type { Board, Pedal, PlacedPedal } from '@/types';
import { deriveBoardState, type SourceSlice } from '../derived';

const NOW = '2024-01-01T00:00:00Z';

function makeBoard(): Board {
  return {
    id: 'board-1',
    name: 'Test Board',
    manufacturer: null,
    widthInches: 22,
    depthInches: 12.5,
    railWidthInches: 2,
    clearanceUnderInches: null,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    rails: [
      { id: 'rail-front', boardId: 'board-1', positionFromBackInches: 8, sortOrder: 0 },
      { id: 'rail-back', boardId: 'board-1', positionFromBackInches: 2, sortOrder: 1 },
    ],
  };
}

function makePedal(id: string, category: Pedal['category']): Pedal {
  return {
    id,
    name: `Pedal ${id}`,
    manufacturer: 'Test',
    category,
    widthInches: 2.87,
    depthInches: 5.12,
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

function makePlaced(id: string, pedalId: string, x: number, y: number, chainPosition: number): PlacedPedal {
  return {
    id,
    configurationId: 'config-1',
    pedalId,
    xInches: x,
    yInches: y,
    rotationDegrees: 0,
    chainPosition,
    location: 'front_of_amp',
    isActive: true,
    useLoop: false,
    createdAt: NOW,
  };
}

function makeSlice(placed: PlacedPedal[], pedalsById: Record<string, Pedal>): SourceSlice {
  return {
    id: 'config-1',
    board: makeBoard(),
    amp: null,
    useEffectsLoop: false,
    use4CableMethod: false,
    modulationInLoop: false,
    placedPedals: placed,
    pedalsById,
    routingConfig: { useLoopPedals: true, use4CableMethod: false, pedalConfigs: [] },
  };
}

function twoPedalSlice(): SourceSlice {
  const od = makePedal('pedal-od', 'overdrive');
  const delay = makePedal('pedal-delay', 'delay');
  const pedalsById = { [od.id]: od, [delay.id]: delay };
  const placed = [
    makePlaced('p1', od.id, 18, 7.38, 1),
    makePlaced('p2', delay.id, 14, 7.38, 2),
  ];
  return makeSlice(placed, pedalsById);
}

describe('deriveBoardState content', () => {
  it('derives cable topology, routed paths, and no collisions for a spaced layout', () => {
    const derived = deriveBoardState(twoPedalSlice());

    // Guitar → p1 → p2 → Amp = 3 cables
    expect(derived.cables.length).toBe(3);
    expect(derived.routedCables.length).toBe(derived.cables.length);
    // Every routed cable has a drawable path
    for (const rc of derived.routedCables) {
      expect(rc.path.length).toBeGreaterThanOrEqual(2);
    }
    expect(derived.collisions).toEqual([]);
  });

  it('detects collisions for overlapping pedals', () => {
    const slice = twoPedalSlice();
    // Overlap the two pedals
    slice.placedPedals = [
      { ...slice.placedPedals[0], xInches: 10, yInches: 5 },
      { ...slice.placedPedals[1], xInches: 10.5, yInches: 5 },
    ];

    const derived = deriveBoardState(slice);
    expect(derived.collisions.length).toBeGreaterThan(0);
  });

  it('returns empty state when there is no board or no pedals', () => {
    const slice = twoPedalSlice();
    slice.placedPedals = [];
    const derived = deriveBoardState(slice);
    expect(derived.cables).toEqual([]);
    expect(derived.routedCables).toEqual([]);
  });
});

describe('deriveBoardState memoization', () => {
  it('returns the identical result object for identical input references', () => {
    const slice = twoPedalSlice();
    const first = deriveBoardState(slice);
    const second = deriveBoardState({ ...slice }); // same field references, new wrapper
    expect(second).toBe(first);
    expect(second.cables).toBe(first.cables);
    expect(second.routedCables).toBe(first.routedCables);
  });

  it('recomputes when a source slice reference changes', () => {
    const slice = twoPedalSlice();
    const first = deriveBoardState(slice);

    const moved = {
      ...slice,
      placedPedals: slice.placedPedals.map((p) =>
        p.id === 'p2' ? { ...p, xInches: 10 } : p
      ),
    };
    const second = deriveBoardState(moved);

    expect(second).not.toBe(first);
    expect(second.cables.length).toBe(first.cables.length);
  });
});
