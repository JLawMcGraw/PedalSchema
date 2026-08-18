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
 *
 * BOTH THE TABLE AND THE DEFAULT ARE ZERO, and that is the whole point: the
 * corridor model is not permitted to draw a worse board than the cascade at
 * all. `routeAllCables` routes BOTH ways and keeps the picture with fewer
 * crossings (see the guard in cables/route-cables.ts), so this is a property
 * to enforce rather than a tolerance to budget.
 *
 * It read `?? 1` until 2026-08-18 - a blanket allowance of one extra crossing
 * on every case, left behind when the per-case entries were deleted. That is
 * the thing the guard's own comment calls "a hope rather than a guarantee",
 * still encoded in the test that was supposed to be checking it. Measured when
 * it was tightened: all 8 cases pass at 0, so the allowance had been
 * protecting nothing and hiding a regression of exactly 1.
 *
 * The two entries this table used to hold are worth remembering, because both
 * are now IMPOSSIBLE rather than merely absent:
 *
 *   wide/twelve+4cm   7 against 5   when OBSTACLE_MARGIN dropped 8 -> 6 the
 *                                   lane router took cables the cascade used
 *                                   to get, and its coordinated detours crossed
 *                                   more often than their independent ones
 *   jr/seven+4cm     11 against 8   dirty modulation makes all seven pedals one
 *                                   front run on an 18in board; both routers do
 *                                   worse on a genuinely harder input
 *
 * Neither can recur as a FAILURE now: if the corridor model loses on a board,
 * the guard hands back the cascade's picture and those cables report the
 * `outrouted` outcome.
 *
 * WHAT THE TIGHTENING ACTUALLY BUYS, measured by deleting the guard and
 * re-running: both cases come back at a gap of TWO (7 against 5, 10 against
 * 8), so `?? 1` would have caught a guard removal too. What it would NOT have
 * caught is a regression of exactly one crossing - a cable the corridor model
 * starts losing quietly - and that is the class this now covers. Worth being
 * precise about: the change closes a one-crossing blind spot, it does not
 * newly detect the guard disappearing.
 *
 * Do NOT reintroduce a non-zero default to make a new board pass. A case that
 * loses is the guard failing, not the board being hard.
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
      const allowance = LANE_CROSSING_ALLOWANCE[label] ?? 0;
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
