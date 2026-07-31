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

/**
 * Variable row heights (regression: DD-7 right of PH-3 on the 20-pedal board).
 *
 * The real Pedaltrain Classic Pro config: fourteen 5.08in pedals, four 5.10in,
 * one 5.43in (EQ-200) and one 7.56in (PW-3), on a 32x16in board. With uniform
 * rows sized at the typical 5.10in depth, three rows plus 0.35in corridors fill
 * the board exactly and the 5.43in pedal fits NO row: it straddled two bands,
 * so it could only sit in the one column with nothing above it. That pinned the
 * start of its packed run to x=10.75, only four of the remaining eight pedals
 * fit to its left, and the tail wrapped back to the right-hand side of the row -
 * the chain read ... -> 0.6 -> 22.0 -> 18.6, backwards in signal terms.
 *
 * Rows must therefore be able to have DIFFERENT heights: 5.43 + 5.10 + 5.10 =
 * 15.63in leaves 0.185in per corridor, which houses every pedal.
 */
describe('variable row heights (regression: deeper pedal had no row band)', () => {
  const CLASSIC_PRO: Board = {
    ...makeBoard(),
    id: 'board-pro',
    name: 'Pedaltrain Classic Pro',
    widthInches: 32,
    depthInches: 16,
    rails: [0, 3.75, 7.5, 11.25].map((positionFromBackInches, i) => ({
      id: `r${i}`,
      boardId: 'board-pro',
      positionFromBackInches,
      sortOrder: i + 1,
    })),
  };

  /** The real board's depth mix, in chain order (deep pedal 13th, as it was) */
  const DEPTHS = [
    7.56, 5.08, 5.10, 5.08, 5.08, 5.08, 5.10, 5.08, 5.08, 5.08,
    5.08, 5.10, 5.43, 5.08, 5.08, 5.08, 5.10, 5.08, 5.08, 5.08,
  ];
  const WIDTHS = DEPTHS.map((d) => (d === 7.56 ? 3.15 : d === 5.43 ? 3.98 : 2.87));

  function place() {
    const pedalsById: Record<string, Pedal> = {};
    const placed: PlacedPedal[] = [];
    DEPTHS.forEach((depth, i) => {
      const pedal = { ...makePedal(`pedal-${i + 1}`), depthInches: depth, widthInches: WIDTHS[i] };
      pedalsById[pedal.id] = pedal;
      placed.push(makePlaced(`c${i + 1}`, pedal.id, i + 1));
    });
    const placements = calculateGreedyPlacement(placed, pedalsById, CLASSIC_PRO);
    return placements.map((pl) => {
      const index = Number(pl.id.slice(1)) - 1; // c7 -> chain position 7
      return { ...pl, index, width: WIDTHS[index], depth: DEPTHS[index] };
    });
  }

  it('sizes every row band for its own deepest occupant', () => {
    // The invariant the uniform-row model could not satisfy. Note this is a
    // claim about the BANDS, not about which x happens to be free: the old
    // layout also put the 5.43in pedal at y=0, but the next row started 5.45in
    // back, so it only fit where nothing sat above it.
    const boxes = place().filter((b) => b.depth < 7); // 7.56in straddles by design
    const rowYs = [...new Set(boxes.map((b) => Number(b.y.toFixed(2))))].sort((a, b) => a - b);

    for (const [i, y] of rowYs.entries()) {
      const deepestHere = Math.max(...boxes.filter((b) => Math.abs(b.y - y) < 0.01).map((b) => b.depth));
      const nextRowY = rowYs[i + 1];
      // The frontmost row is bounded by the board edge, not by another row
      const limit = nextRowY ?? CLASSIC_PRO.depthInches + 0.15;
      expect(limit - y).toBeGreaterThanOrEqual(deepestHere + 0.15 - 1e-6);
    }

    // ...and the deep pedal really is housed in one, not straddling two
    const deep = place().find((b) => b.depth === 5.43)!;
    expect(rowYs).toContain(Number(deep.y.toFixed(2)));
  });

  it('keeps every row in signal order, with no wrap back to the right', () => {
    const boxes = place();
    // The 7.56in pedal is deeper than any band can be and legitimately
    // straddles two - it is excluded from the row-order check.
    const rows = new Map<string, typeof boxes>();
    for (const b of boxes.filter((b) => b.depth < 7)) {
      const key = b.y.toFixed(2);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(b);
    }

    expect(rows.size).toBe(3);
    for (const [, row] of rows) {
      const inChainOrder = [...row].sort((a, b) => a.index - b.index);
      for (let i = 0; i < inChainOrder.length - 1; i++) {
        // Later in the chain means further LEFT: x strictly decreasing
        expect(inChainOrder[i + 1].x).toBeLessThan(inChainOrder[i].x);
      }
    }
  });

  it('places all 20 without overlapping or leaving the board', () => {
    const boxes = place();
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(-1e-6);
      expect(b.y).toBeGreaterThanOrEqual(-1e-6);
      expect(b.x + b.width).toBeLessThanOrEqual(CLASSIC_PRO.widthInches + 1e-6);
      expect(b.y + b.depth).toBeLessThanOrEqual(CLASSIC_PRO.depthInches + 1e-6);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
    }
  });
});
