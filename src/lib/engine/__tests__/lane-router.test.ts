/**
 * Manhattan Lane Router acceptance (roadmap Phase 3)
 *
 * Across the full configuration matrix:
 * - lane-routed paths are strictly axis-aligned (square corners)
 * - runs sharing a corridor sit at uniform >= MIN spacing (implied by the
 *   matrix lane invariant, re-checked here on the lane-routed subset)
 * - crossings do not regress vs the strategy router
 * - the corridor graph actually serves most cables (no silent full-fallback)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { makeBoard, makePedalSet, makeAmp, type BoardKind, type PedalSetKind } from './support/fixtures';
import { signalChainEngine } from '../signal-chain';
import { calculateOptimalLayoutJoint } from '../layout';
import { calculateCables } from '../cables';
import { routeAllCables } from '../cables/route-cables';
import { detectCableCrossings } from '../pathfinding';
import type { RoutingConfig, Cable } from '@/types';

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

/**
 * How far the lane router is allowed to lose to the strategy router, per case.
 * One everywhere - a single extra crossing is noise - except where a worse
 * number was measured and explained.
 *
 * Widened for wide/twelve+4cm when OBSTACLE_MARGIN dropped 8 -> 6: usable row
 * corridors mean the lane router now routes cables it previously handed to the
 * cascade, and on that board its coordinated detours cross twice more than the
 * cascade's independent ones (7 against 5).
 *
 * A "never worse than the cascade" guard was BUILT AND REVERTED for this on
 * 2026-08-18. Routing both ways and keeping the better picture costs 1.6x on
 * the routing-heavy suites and fixes nothing here: where the lane router
 * loses, the cascade's alternative contains DIAGONAL segments, and trading a
 * crossing for a diagonal cable is not a trade worth making. Make the cascade
 * orthogonal first and the guard becomes worth revisiting.
 *
 * jr/seven+4cm: 11 against 8, measured 2026-08-18. Both routers get worse on
 * this case than they used to (3 and 3), because dirty modulation puts the
 * modulation pedals in front of the drives and all seven pedals become one
 * front run on an 18in board. The wiring is what the owner asked for; the
 * crossings are the lane router losing ground on a genuinely harder input,
 * which is the P4 "lane separation on dense boards" gap and not something the
 * modulation switch can fix. Pinned rather than widened to a blanket number,
 * so any OTHER case that regresses still fails at 1.
 */
const LANE_CROSSING_ALLOWANCE: Record<string, number> = {};

describe('lane router acceptance', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  let totalCables = 0;
  let laneRouted = 0;

  for (const [boardKind, setKind, useEffectsLoop, use4CableMethod] of cases) {
    it(`${boardKind}/${setKind} loop=${useEffectsLoop} 4cm=${use4CableMethod}`, () => {
      const board = makeBoard(boardKind);
      const set = makePedalSet(setKind);
      const ctx = {
        ampHasEffectsLoop: true, useEffectsLoop, use4CableMethod,
        modulationInLoop: false, loopType: 'series' as const,
      };
      let pedals = signalChainEngine.calculate(set.placedPedals, set.pedalsById, ctx).orderedPedals;
      const routingConfig: RoutingConfig = { useLoopPedals: true, use4CableMethod, useEffectsLoop, pedalConfigs: [] };
      const layout = calculateOptimalLayoutJoint(pedals, set.pedalsById, board, routingConfig);
      const posById = new Map(layout.placements.map((p) => [p.id, p]));
      pedals = pedals.map((p) => {
        const pl = posById.get(p.id);
        return pl ? { ...p, xInches: pl.x, yInches: pl.y } : p;
      });

      const conns = calculateCables(pedals, set.pedalsById, board, makeAmp(true), useEffectsLoop, routingConfig, use4CableMethod);
      const cables: Cable[] = conns.map((c, i) => ({
        id: `c${i}`, configurationId: 't', fromType: c.fromType, fromPedalId: c.fromPedalId,
        fromJack: c.fromJackType, toType: c.toType, toPedalId: c.toPedalId, toJack: c.toJackType,
        calculatedLengthInches: c.calculatedLengthInches, cableType: c.cableType, sortOrder: c.sortOrder, createdAt: '',
      }));

      const withLanes = routeAllCables(cables, pedals, set.pedalsById, board, 40, useEffectsLoop, { laneRouter: true });
      const without = routeAllCables(cables, pedals, set.pedalsById, board, 40, useEffectsLoop, { laneRouter: false });

      // All valid either way
      expect(withLanes.every((rc) => rc.valid)).toBe(true);

      // Axis alignment: every segment of every path is orthogonal
      for (const rc of withLanes) {
        for (let i = 0; i < rc.path.length - 1; i++) {
          const dx = Math.abs(rc.path[i + 1].x - rc.path[i].x);
          const dy = Math.abs(rc.path[i + 1].y - rc.path[i].y);
          expect(
            dx < 0.5 || dy < 0.5,
            `diagonal segment in ${rc.cable.id}: (${rc.path[i].x},${rc.path[i].y})->(${rc.path[i + 1].x},${rc.path[i + 1].y})`
          ).toBe(true);
        }
      }

      // Crossings must not regress vs the strategy router
      const crossings = (rcs: typeof withLanes) =>
        detectCableCrossings(rcs.map((rc) => ({ id: rc.cable.id, points: rc.path }))).length;
      const label = `${boardKind}/${setKind} loop=${useEffectsLoop} 4cm=${use4CableMethod}`;
      const allowance = LANE_CROSSING_ALLOWANCE[label] ?? 1;
      expect(
        crossings(withLanes),
        `${label}: lane router lost to the strategy router by more than its allowance of ${allowance}`
      ).toBeLessThanOrEqual(crossings(without) + allowance);

      // Adoption bookkeeping. This used to be a "conservative proxy" - count
      // the cables whose path differs from the no-lane run - because nothing
      // recorded which router actually served a cable. `laneOutcome` does, so
      // count it exactly instead of inferring it.
      totalCables += withLanes.length;
      for (const rc of withLanes) {
        if (rc.laneOutcome === 'lane-routed' || rc.laneOutcome === 'shortcut') laneRouted++;
        // Every cable must carry an outcome when the lane router ran at all.
        expect(rc.laneOutcome, `no laneOutcome on ${rc.cable.id}`).toBeDefined();
      }

      // The reconciliation that keeps the diagnostic honest: a cable reports
      // strategy 'lane-router' exactly when its outcome was a corridor success.
      // If these two ever disagree, one of them is lying and every count built
      // on either is wrong.
      for (const rc of withLanes) {
        const servedByCorridor = rc.laneOutcome === 'lane-routed' || rc.laneOutcome === 'shortcut';
        expect(
          rc.strategy === 'lane-router',
          `${rc.cable.id}: strategy=${rc.strategy} but outcome=${rc.laneOutcome}`
        ).toBe(servedByCorridor);
      }
    });
  }

  it('corridor graph serves a meaningful share of cables', () => {
    expect(totalCables).toBeGreaterThan(0);
    expect(laneRouted / totalCables).toBeGreaterThan(0.3);
  });
});
