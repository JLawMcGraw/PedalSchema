/**
 * One derivation of cable length - see ../derive-cables.ts for why there had
 * to be exactly one.
 *
 * `listed-length-covers-route.test.ts` states the property the user cares about
 * (the cable you buy reaches). This file pins the pieces that property is made
 * of, and the two equalities that stop the numbers drifting apart again:
 *
 *   the CABLE readout  ==  the sum of the drawn paths
 *   the CABLE readout  ==  what the layout cost function calls cable length
 *
 * The second is the one that matters after pressing Optimize. Its summary says
 * "12in less cable length" in the cost function's units; if the readout is a
 * different quantity, the two can disagree about a board on the same screen.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { RoutingConfig } from '@/types';
import {
  makeAmp, makeBoard, makePedalSet, SCALE, type BoardKind, type PedalSetKind,
} from '../../__tests__/support/fixtures';
import { simulateConfiguration, type ScenarioFlags } from '../../__tests__/support/simulate';
import { calculateRoutingCost } from '../../layout/routing-cost';
import { calculatePathLength } from '../../geometry';
import { deriveBoardState } from '@/store/derived';
import { deriveCables, purchaseLengthInches, routedLengthInches } from '../derive-cables';
import { roundToStandardLength } from '../index';

/** A straight horizontal run of the given length, at the canvas scale. */
const run = (inches: number) => [{ x: 0, y: 0 }, { x: inches * SCALE, y: 0 }];

describe('purchaseLengthInches', () => {
  it('lists the shortest standard length that covers the route', () => {
    expect(purchaseLengthInches({ path: run(0.5), valid: true }, 6)).toBe(6);
    expect(purchaseLengthInches({ path: run(7), valid: true }, 6)).toBe(12);
    expect(purchaseLengthInches({ path: run(13), valid: true }, 6)).toBe(18);
  });

  it('follows the ROUTE, not the estimate, in both directions', () => {
    // The measured worst case: a cable sent around the outside of the board,
    // 55.4in drawn, estimated (and listed) at 12in.
    expect(purchaseLengthInches({ path: run(55.4), valid: true }, 12)).toBe(72);
    // And the other way: jacks facing each other across a half-inch gap,
    // which no estimate should be able to inflate.
    expect(purchaseLengthInches({ path: run(0.5), valid: true }, 24)).toBe(6);
  });

  it('measures every leg of a route with corners', () => {
    const elbow = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 40, y: 120 }];
    expect(routedLengthInches({ path: elbow })).toBeCloseTo((200 + 120 + 160) / SCALE, 9);
    expect(purchaseLengthInches({ path: elbow, valid: true }, 6)).toBe(12);
  });

  it('does not sell the next size up for floating-point dust', () => {
    // Three legs that sum to exactly 6in in pixels but not in floating point.
    const sixInches = [{ x: 0, y: 0 }, { x: 80.1, y: 0 }, { x: 80.1, y: 79.8 }, { x: 160.2, y: 79.8 }];
    expect(routedLengthInches({ path: sixInches })).toBeCloseTo(6, 9);
    expect(purchaseLengthInches({ path: sixInches, valid: true }, 6)).toBe(6);
    expect(roundToStandardLength(120 + 1e-9)).toBe(120);
    expect(roundToStandardLength(120.5)).toBe(132);
  });

  it('keeps the estimate for a cable that could not be routed', () => {
    // The red through-the-pedals L is a picture of a problem, not a route.
    expect(purchaseLengthInches({ path: run(40), valid: false }, 18)).toBe(18);
  });
});

const off: ScenarioFlags = {
  useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false,
  ns2UseLoop: false, withLockedPedals: false,
};

const cases: Array<[BoardKind, PedalSetKind, Partial<ScenarioFlags>]> = [
  ['wide', 'trio', {}],
  ['wide', 'seven', { useEffectsLoop: true }],
  ['wide', 'seven', { useEffectsLoop: true, use4CableMethod: true }],
  ['wide', 'twelve', { useEffectsLoop: true, modulationInLoop: true }],
  ['jr', 'seven', { ns2UseLoop: true }],
  ['mini', 'trio', { useEffectsLoop: true }],
];

describe('deriveCables', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  for (const [boardKind, setKind, partial] of cases) {
    const flags = { ...off, ...partial };
    const label = Object.entries(partial).filter(([, v]) => v).map(([k]) => k).join('+') || 'plain';

    describe(`${boardKind}/${setKind}: ${label}`, () => {
      const board = makeBoard(boardKind);
      const amp = makeAmp(true);
      const set = makePedalSet(setKind);
      const placedPedals = flags.ns2UseLoop
        ? set.placedPedals.map((p) => (set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p))
        : set.placedPedals;
      const routingConfig: RoutingConfig = {
        useLoopPedals: true,
        use4CableMethod: flags.use4CableMethod,
        useEffectsLoop: flags.useEffectsLoop,
        pedalConfigs: [],
      };
      // normalize -> optimize, exactly as the app does, then derive the cables.
      const optimized = () =>
        simulateConfiguration({ label, board, amp, pedalsById: set.pedalsById, placedPedals, flags }).pedals;
      const derive = () => {
        const pedals = optimized();
        return {
          pedals,
          result: deriveCables({
            configurationId: 'derive-cables', placedPedals: pedals, pedalsById: set.pedalsById,
            board, amp, useEffectsLoop: flags.useEffectsLoop,
            use4CableMethod: flags.use4CableMethod, routingConfig,
          }),
        };
      };

      it('totals the drawn paths, exactly', () => {
        const { result } = derive();
        const summed = result.routedCables.reduce((sum, r) => sum + calculatePathLength(r.path) / SCALE, 0);
        expect(result.drawnLengthInches).toBeCloseTo(summed, 9);
        expect(result.drawnLengthInches).toBeGreaterThan(0);
      });

      it('totals to the cable length the layout cost function scores', () => {
        const { pedals, result } = derive();
        const cost = calculateRoutingCost(
          pedals.map((p) => ({ id: p.id, x: p.xInches, y: p.yInches })),
          pedals, set.pedalsById, board, undefined,
          flags.useEffectsLoop, flags.use4CableMethod, routingConfig
        );
        expect(result.drawnLengthInches).toBeCloseTo(cost.totalLengthInches, 6);
      });

      it('hands the list and the canvas the same cable objects', () => {
        const { result } = derive();
        expect(result.routedCables.length).toBe(result.cables.length);
        for (const routed of result.routedCables) {
          expect(routed.cable).toBe(result.cables.find((c) => c.id === routed.cable.id));
        }
      });

      it('is what the editor state exposes as the CABLE readout', () => {
        const { pedals, result } = derive();
        const derived = deriveBoardState({
          id: 'derive-cables', board, amp,
          useEffectsLoop: flags.useEffectsLoop, use4CableMethod: flags.use4CableMethod,
          modulationInLoop: flags.modulationInLoop,
          placedPedals: pedals, pedalsById: set.pedalsById, routingConfig,
        });
        expect(derived.cableLengthInches).toBeCloseTo(result.drawnLengthInches, 9);
        expect(derived.cables.map((c) => c.calculatedLengthInches))
          .toEqual(result.cables.map((c) => c.calculatedLengthInches));
      });
    });
  }
});
