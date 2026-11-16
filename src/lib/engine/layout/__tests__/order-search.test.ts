/**
 * The chain-order search, on boards with more orders than it can list.
 *
 * Optimize may reorder pedals within a "swappable group" (neighbours of the
 * same category). Two or three to a group is the usual board and every order
 * gets tried. These are the other boards - a group of six, or four groups at
 * once - where the orders run to hundreds and the search has to choose which
 * to look at.
 *
 * It used to look at "the first 48", generated lexicographically, and that
 * went wrong in three ways that this file pins one each:
 *
 * 1. A SECOND CLICK FOUND A BETTER BOARD. The first 48 orders of a six-pedal
 *    group all start with the same pedal; after Optimize moved the board, the
 *    first 48 from the NEW order were a different corner of the space, so
 *    pressing the button again improved it (181.29 -> 175.99, measured
 *    2026-11-16; 2 of 216 boards). config-matrix asserts that optimizing twice
 *    is a no-op and never saw this, because none of its pedal sets has a group
 *    that large.
 *
 * 2. THE ANSWER COULD BE IMPROVED BY REARRANGING ONE GROUP. On that board the
 *    result ranked 145th of 720, and with several groups only the first one or
 *    two were ever permuted - the rest never moved.
 *
 * 3. A QUARTER OF THE WORK WAS REPEATS. 1,210 of 4,773 candidates scored
 *    across the corpus were an (order, rotations) pair already scored in the
 *    same run - a full placement and two routing passes each, and each one
 *    spent from the evaluation budget.
 *
 * The search now walks group by group - every arrangement of one group with
 * the others held still, until no group can be improved - and scores each
 * candidate once. All three blocks below were run against the old search
 * first.
 *
 * The boards are kept verbatim from the seeded sweep that found them.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Board, ChainContext, Pedal, PedalJack, PlacedPedal, RoutingConfig } from '@/types';

/** Every candidate the optimizer scores, as the (order, rotations) pair that identifies it. */
const scoredCandidates: string[] = [];

vi.mock('../routing-cost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routing-cost')>();
  return {
    ...actual,
    calculateRoutingCost: (...args: Parameters<typeof actual.calculateRoutingCost>) => {
      const placed = args[1];
      const order = [...placed].sort((a, b) => a.chainPosition - b.chainPosition).map((p) => p.id).join('>');
      const rotations = [...placed].sort((a, b) => a.id.localeCompare(b.id)).map((p) => p.rotationDegrees).join(',');
      scoredCandidates.push(`${order}#${rotations}`);
      return actual.calculateRoutingCost(...args);
    },
  };
});

import { signalChainEngine } from '../../signal-chain';
import { calculateOptimalLayoutJoint, calculateGreedyPlacementWithDiagnostics } from '../index';
import { calculateRoutingCost } from '../routing-cost';
import { placementViolations } from '../../__tests__/support/invariants';

const NOW = '2024-01-01T00:00:00Z';

type Spec = [id: string, category: Pedal['category'], width: number, depth: number, jacks: 'side' | 'top'];

interface Fixture {
  name: string;
  /** Sizes of the swappable groups once the chain is normalized - what makes the board hard. */
  groups: number[];
  useEffectsLoop: boolean;
  modulationInLoop: boolean;
  specs: Spec[];
}

const FIXTURES: Fixture[] = [
  {
    name: 'one group of six',
    groups: [6],
    useEffectsLoop: true,
    modulationInLoop: true,
    specs: [
      ['p0-filter', 'filter', 3.98, 5.43, 'top'], ['p1-overdrive', 'overdrive', 3.5, 4.5, 'side'],
      ['p2-compressor', 'compressor', 2.87, 5.08, 'side'], ['p3-filter', 'filter', 2.87, 5.08, 'side'],
      ['p4-delay', 'delay', 2.87, 5.08, 'side'], ['p5-filter', 'filter', 2.6, 4.8, 'side'],
      ['p6-reverb', 'reverb', 2.4, 4.4, 'top'], ['p7-fuzz', 'fuzz', 2.87, 5.08, 'side'],
      ['p8-filter', 'filter', 2.4, 4.4, 'top'], ['p9-filter', 'filter', 2.87, 5.1, 'side'],
      ['p10-modulation', 'modulation', 2.4, 4.4, 'top'], ['p11-eq', 'eq', 3.98, 5.43, 'top'],
      ['p12-filter', 'filter', 2.87, 5.08, 'side'],
    ],
  },
  {
    name: 'four groups: 3, 3, 2 and 3',
    groups: [3, 3, 2, 3],
    useEffectsLoop: true,
    modulationInLoop: true,
    specs: [
      ['p0-tuner', 'tuner', 4.7, 3.7, 'top'], ['p1-delay', 'delay', 2.87, 5.08, 'side'],
      ['p2-delay', 'delay', 2.87, 5.1, 'side'], ['p3-looper', 'looper', 2.87, 5.1, 'side'],
      ['p4-reverb', 'reverb', 3.98, 5.43, 'top'], ['p5-eq', 'eq', 2.87, 5.08, 'side'],
      ['p6-modulation', 'modulation', 2.87, 5.08, 'side'], ['p7-reverb', 'reverb', 3.98, 5.43, 'top'],
      ['p8-reverb', 'reverb', 2.4, 4.4, 'top'], ['p9-eq', 'eq', 2.87, 5.08, 'side'],
      ['p10-eq', 'eq', 2.87, 5.08, 'side'], ['p11-modulation', 'modulation', 2.6, 4.8, 'side'],
      ['p12-modulation', 'modulation', 3.5, 4.5, 'side'],
    ],
  },
  {
    // The board a swaps-only walk got stuck on, at 235.15 against the 81.82
    // the old prefix had found: the good order is two swaps inside the group
    // of four away, and the first of them alone makes things worse.
    name: 'six groups: 2, 4, 2, 2, 2 and 2',
    groups: [2, 4, 2, 2, 2, 2],
    useEffectsLoop: false,
    modulationInLoop: false,
    specs: [
      ['p0-overdrive', 'overdrive', 2.87, 5.08, 'side'], ['p1-delay', 'delay', 3.98, 5.43, 'top'],
      ['p2-overdrive', 'overdrive', 2.87, 5.08, 'side'], ['p3-filter', 'filter', 2.4, 4.4, 'top'],
      ['p4-delay', 'delay', 2.87, 5.1, 'side'], ['p5-filter', 'filter', 2.6, 4.8, 'side'],
      ['p6-modulation', 'modulation', 2.87, 5.08, 'side'], ['p7-distortion', 'distortion', 3.5, 4.5, 'side'],
      ['p8-compressor', 'compressor', 2.4, 4.4, 'top'], ['p9-fuzz', 'fuzz', 2.87, 5.08, 'side'],
      ['p10-fuzz', 'fuzz', 2.87, 5.08, 'side'], ['p11-modulation', 'modulation', 2.87, 5.08, 'side'],
      ['p12-overdrive', 'overdrive', 2.6, 4.8, 'side'], ['p13-distortion', 'distortion', 2.6, 4.8, 'side'],
      ['p14-overdrive', 'overdrive', 2.87, 5.08, 'side'],
    ],
  },
];

/** Pedaltrain Classic Pro - every fixture is on one. */
const board: Board = {
  id: 'board-classic-pro', name: 'Pedaltrain Classic Pro', manufacturer: null,
  widthInches: 32, depthInches: 16, railWidthInches: 2, clearanceUnderInches: null,
  isSystem: true, createdBy: null, createdAt: NOW, updatedAt: NOW, imageUrl: null,
  rails: [0, 3.75, 7.5, 11.25].map((y, i) => ({
    id: `rail-${i}`, boardId: 'board-classic-pro', positionFromBackInches: y, sortOrder: i + 1,
  })),
};

interface Built {
  pedalsById: Record<string, Pedal>;
  /** Normalized chain, every pedal still at the origin - what Optimize is handed. */
  pedals: PlacedPedal[];
  routingConfig: RoutingConfig;
  useEffectsLoop: boolean;
}

function build(fixture: Fixture): Built {
  const pedalsById: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  fixture.specs.forEach(([id, category, widthInches, depthInches, layout], index) => {
    const jack = (jackType: 'input' | 'output', side: PedalJack['side'], positionPercent: number): PedalJack => ({
      id: `${id}-${jackType}`, pedalId: id, jackType, side, positionPercent, label: jackType.toUpperCase(),
    });
    pedalsById[id] = {
      id, name: id, manufacturer: 'Test', category,
      widthInches, depthInches, heightInches: 2.3,
      voltage: 9, currentMa: 50, polarity: 'center_negative',
      defaultChainPosition: null, preferredLocation: 'front_of_amp',
      supports4Cable: false, needsBufferBefore: false, needsDirectPickup: false,
      isSystem: true, createdBy: null, createdAt: NOW, updatedAt: NOW, imageUrl: null, notes: null,
      jacks: layout === 'top'
        ? [jack('input', 'top', 75), jack('output', 'top', 25)]
        : [jack('input', 'right', 50), jack('output', 'left', 50)],
    } as Pedal;
    placed.push({
      id: `placed-${id}`, configurationId: 'order-search', pedalId: id,
      xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: index + 1,
      location: 'front_of_amp', locationOverride: false, isActive: true, useLoop: false, createdAt: NOW,
    });
  });

  const context: ChainContext = {
    ampHasEffectsLoop: true, useEffectsLoop: fixture.useEffectsLoop, use4CableMethod: false,
    modulationInLoop: fixture.modulationInLoop, loopType: 'series',
  };
  return {
    pedalsById,
    pedals: signalChainEngine.calculate(placed, pedalsById, context).orderedPedals,
    routingConfig: {
      useLoopPedals: true, use4CableMethod: false, useEffectsLoop: fixture.useEffectsLoop, pedalConfigs: [],
    },
    useEffectsLoop: fixture.useEffectsLoop,
  };
}

type Layout = ReturnType<typeof calculateOptimalLayoutJoint>;

/** Apply a result the way the store does. */
function apply(pedals: PlacedPedal[], layout: Layout): PlacedPedal[] {
  const position = new Map(layout.placements.map((p) => [p.id, p]));
  const rotation = new Map((layout.rotations ?? []).map((r) => [r.id, r.rotationDegrees]));
  const chain = new Map(layout.chainOrder.map((id, i) => [id, i + 1]));
  return pedals.map((p) => ({
    ...p,
    xInches: position.get(p.id)?.x ?? p.xInches,
    yInches: position.get(p.id)?.y ?? p.yInches,
    rotationDegrees: rotation.get(p.id) ?? p.rotationDegrees,
    chainPosition: layout.swappableGroups.length > 0 ? chain.get(p.id) ?? p.chainPosition : p.chainPosition,
  }));
}

const optimize = (built: Built, pedals: PlacedPedal[] = built.pedals): Layout =>
  calculateOptimalLayoutJoint(pedals, built.pedalsById, board, built.routingConfig);

const snapshot = (pedals: PlacedPedal[]) =>
  [...pedals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id} (${p.xInches.toFixed(3)},${p.yInches.toFixed(3)}) rot=${p.rotationDegrees} chain=${p.chainPosition}`);

beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { vi.restoreAllMocks(); });

describe('the fixtures are the hard case', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: more orders than can be listed`, () => {
      const layout = optimize(build(fixture));
      expect(layout.swappableGroups.map((g) => g.pedalIds.length)).toEqual(fixture.groups);
      const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
      const orders = fixture.groups.reduce((product, size) => product * factorial(size), 1);
      // 48 is where the search stops listing every order and starts walking.
      expect(orders).toBeGreaterThan(48);
    });
  }
});

describe('a second Optimize changes nothing', () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const built = build(fixture);
      const once = apply(built.pedals, optimize(built));
      const again = optimize(built, once);
      const twice = apply(once, again);

      expect(snapshot(twice)).toEqual(snapshot(once));
      expect(again.cost!.totalScore).toBeCloseTo(again.baselineCost!.totalScore, 6);
    });
  }
});

describe('no group can be rearranged for the better', () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const built = build(fixture);
      const layout = optimize(built);
      const result = apply(built.pedals, layout);
      const best = layout.cost!.totalScore;

      // Score an order the way the optimizer does, but from outside it: place
      // greedily, refuse a colliding placement, route and cost what is left.
      const score = (order: PlacedPedal[]): number => {
        const reordered = order.map((p, i) => ({ ...p, chainPosition: i + 1 }));
        const { placements } = calculateGreedyPlacementWithDiagnostics(
          reordered, built.pedalsById, board, built.routingConfig
        );
        const at = new Map(placements.map((p) => [p.id, p]));
        const moved = reordered.map((p) => ({ ...p, xInches: at.get(p.id)!.x, yInches: at.get(p.id)!.y }));
        if (placementViolations(moved, built.pedalsById, board).length > 0) return Infinity;
        return calculateRoutingCost(
          placements, reordered, built.pedalsById, board, undefined,
          built.useEffectsLoop, false, built.routingConfig
        ).totalScore;
      };

      const chain = [...result].sort((a, b) => a.chainPosition - b.chainPosition);
      let checked = 0;
      for (const group of layout.swappableGroups) {
        const slots = chain.map((p, i) => (group.pedalIds.includes(p.id) ? i : -1)).filter((i) => i >= 0);
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) {
            const swapped = [...chain];
            [swapped[slots[i]], swapped[slots[j]]] = [swapped[slots[j]], swapped[slots[i]]];
            expect(
              score(swapped),
              `swapping ${chain[slots[i]].id} with ${chain[slots[j]].id} beats the returned ${best.toFixed(2)}`
            ).toBeGreaterThanOrEqual(best - 1e-6);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('no candidate is scored twice', () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const built = build(fixture);
      scoredCandidates.length = 0;
      optimize(built);

      // The first call scores the board as the user left it - the baseline -
      // which is a different thing from a candidate even where the order matches.
      const candidates = scoredCandidates.slice(1);
      expect(candidates.length).toBeGreaterThan(10);
      expect(candidates.length - new Set(candidates).size).toBe(0);
    });
  }
});
