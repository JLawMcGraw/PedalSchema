/**
 * OPTIMIZE REPORTS THE BOARD THE CANVAS DRAWS.
 *
 * The optimizer scores each candidate with the pedals listed in CHAIN order.
 * The store then applies the winner by rewriting `chainPosition` on pedals it
 * keeps in its OWN order - it does not re-sort the list. So whenever Optimize
 * reorders the chain, the canvas routes a differently-ordered list than the
 * one that was scored, and if the router is sensitive to list order the two
 * pictures differ.
 *
 * They did. On this board, measured on 2026-11-16 through this same store:
 *
 *     Optimize summary             after = 40.73
 *     drawn right after Optimize   73.2in, 2 crossings   (wrap cable sent around the board)
 *     drawn after normalizeChain   30.7in, 0 crossings   (no pedal moved)
 *
 * normalizeChain re-sorts the list into chain order, which is the order the
 * optimizer scored - so the cables jumped to the reported picture on an action
 * that changes nothing about the board. A save and reload did the same, since
 * the load query orders by chain_position.
 *
 * The cause was one tie-break in the cascade's `channel` rung (see
 * freeBandsBetween in engine/cables/routing-strategies.ts, and
 * routing-order-independence.test.ts for the router-level half). This file
 * pins the SYMPTOM, because the symptom is what a second order-sensitive sort
 * anywhere in the pipeline would bring back.
 *
 * The real optimizer runs here: there is no Worker in node, so runOptimize
 * falls back to calling the engine inline.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Board, Pedal, PedalJack, PlacedPedal } from '@/types';
import { makeAmp } from '@/lib/engine/__tests__/support/fixtures';
import { calculateRoutingCost } from '@/lib/engine/layout/routing-cost';
import { calculatePathLength } from '@/lib/engine/geometry';
import { useConfigurationStore } from '../configuration-store';
import { deriveBoardState, INCHES_TO_PIXELS } from '../derived';

const NOW = '2024-01-01T00:00:00Z';

/**
 * Thirteen pedals on a Pedaltrain Classic Pro. Found by a seeded sweep, kept
 * verbatim: what makes it bite is a row holding pedals of DIFFERENT depths
 * (4.4 to 5.43in) once Optimize has turned one of the top-jack EQs, plus
 * swappable groups, so the chain order - and with it the list order the
 * optimizer scores in - changes.
 */
const SPECS: Array<[id: string, category: Pedal['category'], width: number, depth: number, jacks: 'side' | 'top']> = [
  ['p0-distortion', 'distortion', 3.5, 4.5, 'side'],
  ['p1-eq', 'eq', 2.87, 5.08, 'side'],
  ['p2-modulation', 'modulation', 2.87, 5.08, 'side'],
  ['p3-eq', 'eq', 3.98, 5.43, 'top'],
  ['p4-tuner', 'tuner', 3.5, 4.5, 'side'],
  ['p5-distortion', 'distortion', 2.6, 4.8, 'side'],
  ['p6-filter', 'filter', 2.87, 5.08, 'side'],
  ['p7-overdrive', 'overdrive', 2.87, 5.08, 'side'],
  ['p8-modulation', 'modulation', 2.87, 5.08, 'side'],
  ['p9-eq', 'eq', 2.4, 4.4, 'top'],
  ['p10-modulation', 'modulation', 2.6, 4.8, 'side'],
  ['p11-overdrive', 'overdrive', 2.87, 5.1, 'side'],
  ['p12-compressor', 'compressor', 2.87, 5.08, 'side'],
];

function buildBoard(): Board {
  return {
    id: 'board-classic-pro', name: 'Pedaltrain Classic Pro', manufacturer: null,
    widthInches: 32, depthInches: 16, railWidthInches: 2, clearanceUnderInches: null,
    isSystem: true, createdBy: null, createdAt: NOW, updatedAt: NOW, imageUrl: null,
    rails: [0, 3.75, 7.5, 11.25].map((y, i) => ({
      id: `rail-${i}`, boardId: 'board-classic-pro', positionFromBackInches: y, sortOrder: i + 1,
    })),
  };
}

function buildPedals(): { pedalsById: Record<string, Pedal>; placedPedals: PlacedPedal[] } {
  const pedalsById: Record<string, Pedal> = {};
  const placedPedals: PlacedPedal[] = [];
  SPECS.forEach(([id, category, widthInches, depthInches, jackLayout], index) => {
    const jack = (jackType: 'input' | 'output', side: PedalJack['side'], positionPercent: number): PedalJack => ({
      id: `${id}-${jackType}`, pedalId: id, jackType, side, positionPercent, label: jackType.toUpperCase(),
    });
    pedalsById[id] = {
      id, name: id, manufacturer: 'Test', category,
      widthInches, depthInches, heightInches: 2.3,
      voltage: 9, currentMa: 50, polarity: 'center_negative',
      defaultChainPosition: null, preferredLocation: 'front_of_amp',
      supports4Cable: false, needsBufferBefore: false, needsDirectPickup: false,
      isSystem: true, createdBy: null, createdAt: NOW, updatedAt: NOW,
      imageUrl: null, notes: null,
      jacks: jackLayout === 'top'
        ? [jack('input', 'top', 75), jack('output', 'top', 25)]
        : [jack('input', 'right', 50), jack('output', 'left', 50)],
    } as Pedal;
    placedPedals.push({
      id: `placed-${id}`, configurationId: 'config-draws-what-it-scored', pedalId: id,
      xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: index + 1,
      location: 'front_of_amp', locationOverride: false, isActive: true, useLoop: false, createdAt: NOW,
    });
  });
  return { pedalsById, placedPedals };
}

const store = () => useConfigurationStore.getState();

/** What the canvas would draw for the store as it stands. */
function drawn() {
  const derived = deriveBoardState(store());
  return {
    paths: derived.routedCables
      .map((r) =>
        `${r.cable.fromType}:${r.cable.fromPedalId ?? '-'} > ${r.cable.toType}:${r.cable.toPedalId ?? '-'} ` +
        `[${r.strategy}] ` + r.path.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
      )
      .sort(),
    lengthInches: derived.routedCables.reduce((sum, r) => sum + calculatePathLength(r.path), 0) / INCHES_TO_PIXELS,
    crossings: derived.crossings,
  };
}

/** Everything about the board that is not the order of the list. */
function boardState() {
  return store().placedPedals
    .map((p) => [p.id, p.xInches, p.yInches, p.rotationDegrees, p.chainPosition, p.location])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

describe('Optimize reports the board the canvas draws', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pedalsById, placedPedals } = buildPedals();
    store().initConfiguration({
      id: 'config-draws-what-it-scored', name: 'Draws what it scored',
      board: buildBoard(), amp: makeAmp(true), placedPedals, pedalsById,
    });
    store().normalizeChain();
    await store().optimizeLayout();
  });
  afterAll(() => { vi.restoreAllMocks(); });

  it('is exercising the case that matters: Optimize reordered the chain', () => {
    // If this stops holding the two tests below go quiet without going wrong -
    // the list would already be in chain order and there would be nothing for
    // an order-sensitive router to disagree about.
    const list = store().placedPedals;
    const inChainOrder = list.every((p, i) => i === 0 || list[i - 1].chainPosition < p.chainPosition);
    expect(inChainOrder).toBe(false);
  });

  it('scores the applied board at exactly what the summary reported', () => {
    const { placedPedals, pedalsById, board, routingConfig, useEffectsLoop, use4CableMethod } = store();
    const rescored = calculateRoutingCost(
      placedPedals.map((p) => ({ id: p.id, x: p.xInches, y: p.yInches })),
      placedPedals, pedalsById, board!, undefined,
      useEffectsLoop, use4CableMethod, { ...routingConfig, useEffectsLoop, use4CableMethod }
    );
    const reported = store().lastOptimization;
    expect(reported).not.toBeNull();
    expect(rescored.totalScore).toBeCloseTo(reported!.after, 6);
  });

  it('draws the same cables after an action that moves nothing', () => {
    const before = drawn();
    const stateBefore = boardState();

    // Re-sorts the list into chain order and changes nothing else - the same
    // thing a save and reload does.
    store().normalizeChain();

    expect(boardState()).toEqual(stateBefore);
    const after = drawn();
    expect(after.crossings).toBe(before.crossings);
    expect(after.lengthInches).toBeCloseTo(before.lengthInches, 6);
    expect(after.paths).toEqual(before.paths);
  });
});
