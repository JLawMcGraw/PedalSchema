/**
 * The optimizer must score the geometry the user is shown.
 *
 * It did not. calculateRoutingCost drove routeCableWithObstacles (per-cable
 * cascade) while the canvas drove routeCablesWithLanes (batch, corridor
 * model), so a cable the corridor model routes cleanly could fail the cascade
 * and charge routingFailures 100 inch-equivalents - steering Optimize away
 * from layouts that render perfectly well. Scored length never accounted for
 * lane jogs either, so scored length != drawn length even for cables that did
 * route.
 *
 * Finding that gap is the whole point of the change, so it is closed with a
 * test rather than left to be rediscovered.
 *
 * TWO SETUP DETAILS, or this fails for the wrong reason:
 *  - the amp must have a loop and useEffectsLoop must match, because
 *    derived.ts computes `useEffectsLoop && amp?.hasEffectsLoop` while
 *    routing-cost synthesises a pseudo-amp from useEffectsLoop alone. They
 *    agree only when the amp has a loop.
 *  - scale must be 40 on both sides (store/derived.ts INCHES_TO_PIXELS).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeBoard, makePedalSet, makeAmp, type BoardKind, type PedalSetKind } from './support/fixtures';
import { signalChainEngine } from '../signal-chain';
import { calculateOptimalLayoutJoint } from '../layout';
import { calculateCables } from '../cables';
import { routeAllCables } from '../cables/route-cables';
import type { RoutingConfig, Cable } from '@/types';

const SCALE = 40;

/** The same matrix lane-router.test.ts uses. */
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

const round2 = (n: number) => Math.round(n * 100) / 100;

describe('router parity: scored geometry == drawn geometry', () => {
  for (const [boardKind, setKind, useEffectsLoop, use4CableMethod] of cases) {
    it(`${boardKind}/${setKind} loop=${useEffectsLoop} 4cm=${use4CableMethod}`, () => {
      const board = makeBoard(boardKind);
      const set = makePedalSet(setKind);
      const amp = makeAmp(true);
      const routingConfig: RoutingConfig = {
        useLoopPedals: true, use4CableMethod, useEffectsLoop, pedalConfigs: [],
      };

      let pedals = signalChainEngine.calculate(set.placedPedals, set.pedalsById, {
        ampHasEffectsLoop: amp.hasEffectsLoop,
        useEffectsLoop, use4CableMethod,
        modulationInLoop: false, loopType: amp.loopType,
      }).orderedPedals;

      const layout = calculateOptimalLayoutJoint(pedals, set.pedalsById, board, routingConfig);

      // Apply exactly what the store applies (support/simulate.ts).
      const placementById = new Map(layout.placements.map((p) => [p.id, p]));
      const rotationById = new Map((layout.rotations ?? []).map((r) => [r.id, r.rotationDegrees]));
      pedals = pedals.map((p) => {
        const placement = placementById.get(p.id);
        const rotation = rotationById.get(p.id);
        let next = p;
        if (placement) next = { ...next, xInches: placement.x, yInches: placement.y };
        if (rotation !== undefined) next = { ...next, rotationDegrees: rotation };
        return next;
      });
      if (layout.swappableGroups.length > 0) {
        const orderIndex = new Map(layout.chainOrder.map((id, i) => [id, i + 1]));
        pedals = pedals.map((p) => ({ ...p, chainPosition: orderIndex.get(p.id) ?? p.chainPosition }));
      }

      const conns = calculateCables(
        pedals, set.pedalsById, board, amp, useEffectsLoop, routingConfig, use4CableMethod
      );
      const cables: Cable[] = conns.map((c, i) => ({
        id: `c${i}`, configurationId: 't', fromType: c.fromType, fromPedalId: c.fromPedalId,
        fromJack: c.fromJackType, toType: c.toType, toPedalId: c.toPedalId, toJack: c.toJackType,
        calculatedLengthInches: c.calculatedLengthInches, cableType: c.cableType,
        sortOrder: c.sortOrder, createdAt: '',
      }));

      const drawn = routeAllCables(cables, pedals, set.pedalsById, board, SCALE, useEffectsLoop);
      const scored = layout.cost!.cableDetails;

      // Count first. routeAllCables silently drops a cable whose endpoints do
      // not resolve; calculateRoutingCost walks the topology and cannot. A
      // mismatch here means the two sides are not even routing the same set,
      // and every path comparison below would be off by one.
      expect(scored.length).toBe(drawn.length);

      for (let i = 0; i < scored.length; i++) {
        expect(scored[i].strategy).toBe(drawn[i].strategy);
        expect(scored[i].path.map((p) => [round2(p.x), round2(p.y)]))
          .toEqual(drawn[i].path.map((p) => [round2(p.x), round2(p.y)]));
      }
    });
  }

  it('routing-cost no longer reaches for the per-cable cascade', () => {
    // Structural, in the lane-spacing-authority style: the parity above can be
    // satisfied by coincidence on these fixtures, but importing the other
    // router back into the cost function cannot be anything but a regression.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'layout', 'routing-cost.ts'), 'utf8'
    );
    expect(source).not.toMatch(/routeCableWithObstacles/);
    expect(source).toMatch(/routeCablePaths/);
  });
});
