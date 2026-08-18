/**
 * EVERY cable this app draws turns at right angles.
 *
 * A patch cable leaves a jack square-on and bends; a diagonal line across a
 * board is a picture of a cable that cannot exist. The lane router has emitted
 * square corners by construction since it landed, and `lane-router.test.ts`
 * asserts it - but the strategy cascade behind it was never held to the same
 * rule, and its `direct` rung joined two standoffs in a straight line whenever
 * they were within 80px, diagonal or not.
 *
 * That asymmetry had a second cost beyond the drawing. It made the two routers
 * incomparable: a "never worse than the cascade" guard was built on 2026-08-18
 * and reverted, because where the lane router loses on crossings the cascade's
 * cheaper alternative turned out to be diagonal, and trading a crossing for a
 * diagonal is not a trade worth making. With both routers orthogonal that guard
 * becomes a fair comparison again.
 *
 * Runs the cascade DIRECTLY (laneRouter: false) so the lane router cannot mask
 * a diagonal by serving the cable first - the whole point is the fallback.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { makeBoard, makePedalSet, makeAmp, type BoardKind, type PedalSetKind } from '../../__tests__/support/fixtures';
import { signalChainEngine } from '../../signal-chain';
import { calculateOptimalLayoutJoint } from '../../layout';
import { calculateCables } from '../index';
import { routeAllCables } from '../route-cables';
import { ORTHOGONAL_EPSILON } from '../../geometry';
import type { RoutingConfig, Cable } from '@/types';

/** The same matrix lane-router.test.ts and router-parity.test.ts sweep. */
const cases: Array<[BoardKind, PedalSetKind, boolean, boolean]> = [
  ['wide', 'trio', false, false],
  ['wide', 'seven', true, false],
  ['wide', 'seven', true, true],
  ['wide', 'twelve', true, false],
  ['wide', 'twelve', true, true],
  ['jr', 'seven', true, false],
  ['jr', 'seven', true, true],
  ['mini', 'trio', true, false],
];

describe('the strategy cascade draws square corners', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  let segmentsChecked = 0;

  for (const [boardKind, setKind, useEffectsLoop, use4CableMethod] of cases) {
    for (const modulationInLoop of [false, true]) {
      it(`${boardKind}/${setKind} loop=${useEffectsLoop} 4cm=${use4CableMethod} mod=${modulationInLoop}`, () => {
        const board = makeBoard(boardKind);
        const set = makePedalSet(setKind);
        const ctx = {
          ampHasEffectsLoop: true, useEffectsLoop, use4CableMethod,
          modulationInLoop, loopType: 'series' as const,
        };
        let pedals = signalChainEngine.calculate(set.placedPedals, set.pedalsById, ctx).orderedPedals;
        const routingConfig: RoutingConfig = {
          useLoopPedals: true, use4CableMethod, useEffectsLoop, pedalConfigs: [],
        };
        const layout = calculateOptimalLayoutJoint(pedals, set.pedalsById, board, routingConfig);
        const posById = new Map(layout.placements.map((p) => [p.id, p]));
        pedals = pedals.map((p) => {
          const pl = posById.get(p.id);
          return pl ? { ...p, xInches: pl.x, yInches: pl.y } : p;
        });

        const conns = calculateCables(
          pedals, set.pedalsById, board, makeAmp(true), useEffectsLoop, routingConfig, use4CableMethod
        );
        const cables: Cable[] = conns.map((c, i) => ({
          id: `c${i}`, configurationId: 't', fromType: c.fromType, fromPedalId: c.fromPedalId,
          fromJack: c.fromJackType, toType: c.toType, toPedalId: c.toPedalId, toJack: c.toJackType,
          calculatedLengthInches: c.calculatedLengthInches, cableType: c.cableType,
          sortOrder: c.sortOrder, createdAt: '',
        }));

        // laneRouter OFF: this is the cascade on its own, which is the thing
        // under test. With it on, a cable the corridor graph serves would
        // never reach the cascade and a diagonal there would go unseen.
        const routed = routeAllCables(
          cables, pedals, set.pedalsById, board, 40, useEffectsLoop, { laneRouter: false }
        );

        for (const rc of routed) {
          for (let i = 0; i < rc.path.length - 1; i++) {
            const a = rc.path[i];
            const b = rc.path[i + 1];
            const dx = Math.abs(b.x - a.x);
            const dy = Math.abs(b.y - a.y);
            segmentsChecked++;
            expect(
              dx < ORTHOGONAL_EPSILON || dy < ORTHOGONAL_EPSILON,
              `${rc.strategy} drew a diagonal in ${rc.cable.id}: ` +
              `(${a.x.toFixed(1)},${a.y.toFixed(1)}) -> (${b.x.toFixed(1)},${b.y.toFixed(1)})`
            ).toBe(true);
          }
        }
      });
    }
  }

  it('actually looked at a meaningful number of segments', () => {
    // Guards against the sweep silently routing nothing - the failure mode
    // that lets a green test mean nothing at all.
    expect(segmentsChecked).toBeGreaterThan(200);
  });
});
