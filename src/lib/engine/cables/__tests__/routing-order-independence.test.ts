/**
 * A BOARD DRAWS ONE WAY, whatever order its pedals happen to sit in an array.
 *
 * `placedPedals` is a list, and nothing about a board is ordered by it: signal
 * order is `chainPosition`, position is x/y. The router takes the list anyway,
 * turns it into obstacle boxes in list order, and any tie it breaks by "which
 * came first" becomes a fact about the drawing that the board itself does not
 * contain.
 *
 * That happened in the cascade's `channel` rung, which paired CONSECUTIVE
 * boxes after sorting them by top edge. Two pedals side by side at different
 * depths tie on that sort, so which gap it found depended on list order - see
 * freeBandsBetween in routing-strategies.ts for the arithmetic.
 *
 * It reached the user because three things hold the list in different orders:
 *
 *   the optimizer   scores every candidate in CHAIN order
 *   the store       keeps its own order and only rewrites `chainPosition`
 *   a reload        comes back ORDER BY chain_position
 *
 * So Optimize could report a score for a picture the canvas did not draw, and
 * the cables then jumped on the next normalizeChain or reload with nothing
 * moved. Measured on 2026-11-16 across 216 boards: 30 drew differently under a
 * permutation of the list (6 of them in the config-matrix corpus this file
 * reuses), and on 3 the optimizer's reported score was not the applied
 * board's. The store-level half of this is in
 * store/__tests__/optimize-draws-what-it-scored.test.ts.
 *
 * This file does not care WHICH tie-break is the culprit. It permutes the list
 * and compares the pictures, so the next order-sensitive sort fails here too.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pedal, PedalJack, PlacedPedal, RoutingConfig } from '@/types';
import {
  makeAmp, makeBoard, makePedalSet, type BoardKind, type PedalSetKind,
} from '../../__tests__/support/fixtures';
import { simulateConfiguration, type ScenarioFlags } from '../../__tests__/support/simulate';
import { deriveBoardState } from '@/store/derived';
import { generateObstacles } from '../../obstacles';
import { routeCableWithObstacles } from '../routing-strategies';
import type { RoutedCable } from '../route-cables';

/** Everything about a drawn board that the user can see, keyed by cable rather than by index. */
function picture(routed: RoutedCable[]): string[] {
  return routed
    .map((r) =>
      `${r.cable.fromType}:${r.cable.fromPedalId ?? '-'}:${r.cable.fromJack ?? '-'} > ` +
      `${r.cable.toType}:${r.cable.toPedalId ?? '-'}:${r.cable.toJack ?? '-'} ` +
      `[${r.strategy}${r.valid ? '' : ' INVALID'}] ` +
      r.path.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
    )
    .sort();
}

/** Deterministic permutations: reversed, rotated, and a few seeded shuffles. */
function permutations<T>(items: T[]): Array<{ name: string; order: T[] }> {
  const out = [
    { name: 'reversed', order: [...items].reverse() },
    { name: 'rotated', order: [...items.slice(1), ...items.slice(0, 1)] },
  ];
  for (const seed of [1, 2, 3, 4]) {
    let state = seed * 2654435761;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    out.push({ name: `shuffle ${seed}`, order });
  }
  return out;
}

const off: ScenarioFlags = {
  useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false,
  ns2UseLoop: false, withLockedPedals: false,
};

/**
 * The first three drew differently by list order before the fix - they are
 * what makes this more than a test that has always passed. The rest are the
 * ordinary spread, so a new order-sensitive path has somewhere to show up.
 */
const cases: Array<[BoardKind, PedalSetKind, Partial<ScenarioFlags>]> = [
  ['wide', 'twelve', { ns2UseLoop: true }],
  ['wide', 'twelve', { useEffectsLoop: true, modulationInLoop: true, ns2UseLoop: true }],
  ['wide', 'twelve', { useEffectsLoop: true, use4CableMethod: true, modulationInLoop: true }],
  ['wide', 'twelve', { useEffectsLoop: true }],
  ['wide', 'seven', { useEffectsLoop: true }],
  ['wide', 'trio', {}],
  ['jr', 'seven', { useEffectsLoop: true, use4CableMethod: true }],
  ['mini', 'trio', { useEffectsLoop: true }],
];

describe('routing does not depend on the order of the pedal array', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  for (const [boardKind, setKind, partial] of cases) {
    const flags = { ...off, ...partial };
    const label = Object.entries(partial).filter(([, v]) => v).map(([k]) => k).join('+') || 'plain';

    it(`${boardKind}/${setKind}: ${label}`, () => {
      const board = makeBoard(boardKind);
      const amp = makeAmp(true);
      const set = makePedalSet(setKind);
      const placedPedals = flags.ns2UseLoop
        ? set.placedPedals.map((p) => (set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p))
        : set.placedPedals;

      const { pedals } = simulateConfiguration({
        label, board, amp, pedalsById: set.pedalsById, placedPedals, flags,
      });

      const routingConfig: RoutingConfig = {
        useLoopPedals: true,
        use4CableMethod: flags.use4CableMethod,
        useEffectsLoop: flags.useEffectsLoop,
        pedalConfigs: [],
      };
      const draw = (list: PlacedPedal[]) =>
        picture(deriveBoardState({
          id: 'order-independence', board, amp,
          useEffectsLoop: flags.useEffectsLoop,
          use4CableMethod: flags.use4CableMethod,
          modulationInLoop: flags.modulationInLoop,
          placedPedals: list, pedalsById: set.pedalsById, routingConfig,
        }).routedCables);

      const reference = draw(pedals);
      expect(reference.length).toBeGreaterThan(0);

      for (const { name, order } of permutations(pedals)) {
        expect(draw(order), `pedal array ${name}`).toEqual(reference);
      }
    });
  }
});

/**
 * The defect itself, at the size it can be read at: three pedals, one cable.
 *
 *     A  x 0..100    y 0..200          B  x 150..250  y 0..217
 *     ----------------- corridor 217..230 -----------------
 *     C  x 0..250    y 230..430
 *
 * The cable runs from the amp side to the guitar side and both L-paths cross a
 * pedal, so the corridor is the answer. It was found with the pedals listed
 * A,B,C and missed with them listed B,A,C, where the same cable went over the
 * top of the board through A* instead - 19.9in against 14.3in.
 */
describe('the channel rung finds the corridor between rows of uneven depth', () => {
  const NOW = '2024-01-01T00:00:00Z';
  const SCALE = 40;

  const pedal = (id: string, widthInches: number, depthInches: number): Pedal => {
    const jacks: PedalJack[] = [
      { id: `${id}-in`, pedalId: id, jackType: 'input', side: 'right', positionPercent: 50, label: 'INPUT' },
      { id: `${id}-out`, pedalId: id, jackType: 'output', side: 'left', positionPercent: 50, label: 'OUTPUT' },
    ];
    return {
      id, name: id, manufacturer: 'Test', category: 'overdrive',
      widthInches, depthInches, heightInches: 2.3,
      voltage: 9, currentMa: 50, polarity: 'center_negative',
      defaultChainPosition: null, preferredLocation: 'front_of_amp',
      supports4Cable: false, needsBufferBefore: false, needsDirectPickup: false,
      isSystem: true, createdBy: null, createdAt: NOW, updatedAt: NOW,
      imageUrl: null, notes: null, jacks,
    } as Pedal;
  };

  const placed = (id: string, xInches: number, yInches: number, chainPosition: number): PlacedPedal => ({
    id: `placed-${id}`, configurationId: 'c', pedalId: id,
    xInches, yInches, rotationDegrees: 0, chainPosition,
    location: 'front_of_amp', locationOverride: false, isActive: true, useLoop: false, createdAt: NOW,
  });

  const pedalsById: Record<string, Pedal> = {
    A: pedal('A', 2.5, 5.0),
    B: pedal('B', 2.5, 5.425), // deeper than A, same row: the tie on `top`
    C: pedal('C', 6.25, 5.0),
  };
  const A = placed('A', 0, 0, 1);
  const B = placed('B', 3.75, 0, 2);
  const C = placed('C', 0, 5.75, 3);
  const board = { ...makeBoard('mini'), widthInches: 6.25, depthInches: 10.75, rails: [] };

  const route = (list: PlacedPedal[]) =>
    routeCableWithObstacles(
      { x: -60, y: 100 }, { x: 310, y: 300 },
      generateObstacles(list, pedalsById, board, SCALE)
    );

  it('routes through it with the shallower pedal listed first', () => {
    const result = route([A, B, C]);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('channel');
  });

  it('routes through it with the deeper pedal listed first', () => {
    const result = route([B, A, C]);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('channel');
  });

  it('draws the same path for every order of the three', () => {
    const reference = route([A, B, C]).path;
    for (const list of [[A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A]]) {
      expect(route(list).path).toEqual(reference);
    }
    // The run sits in the 13px corridor, clear of both rows by more than the margin.
    const ys = reference.map((p) => p.y);
    expect(ys).toContain(223.5);
  });
});
