/**
 * What counts as "complex routing" - and why it stopped being `path.length > 3`.
 *
 * `routing-cost.ts` charges COMPLEX_ROUTING_PENALTY_INCHES per cable that
 * "needs complex routing (channel/perimeter/A*) instead of simple L-path". It
 * implemented that as `path.length > 3`, which was the same statement until
 * P1.5 unified the routers. It is not the same statement now: the corridor
 * router's whole output is "tidy looms with square corners by construction",
 * and a corridor entry, a run and an exit is four points before anything has
 * gone wrong.
 *
 * Measured on both saved boards, 2026-08-08, before this change:
 *
 *     lane-router      CHARGED (>3pts)   15      <- the healthy outcome
 *     lane-router      free    (<=3pts)  12
 *     l-horizontal     CHARGED (>3pts)    4      <- literally the simple L-path
 *     l-vertical       CHARGED (>3pts)    1      <-   the comment says it is not about
 *     fallback-invalid CHARGED (>3pts)    1
 *
 * 21 of 33 cables charged, 15 of them the router's best result, and 100 of J$
 * Home's 167.52 total score. The router already reports what it did; the cost
 * function just was not asking.
 */
import { describe, it, expect } from 'vitest';
import { ROUTING_STRATEGIES, isComplexRoute, type RoutingStrategy } from '../routing-strategies';

describe('routing complexity classification', () => {
  /**
   * The guard that keeps this honest as the cascade grows. ROUTING_STRATEGIES
   * derives its own union "so adding a strategy can no longer leave a test list
   * stale" - the same reasoning applies to classifying them.
   */
  it('classifies every strategy in the cascade, plus the lane router', () => {
    for (const s of ROUTING_STRATEGIES) {
      expect(() => isComplexRoute(s), `unclassified strategy: ${s}`).not.toThrow();
      expect(typeof isComplexRoute(s), `non-boolean for ${s}`).toBe('boolean');
    }
    expect(typeof isComplexRoute('lane-router')).toBe('boolean');
  });

  it('does not charge the corridor router - it is the outcome we want', () => {
    expect(isComplexRoute('lane-router')).toBe(false);
  });

  it('does not charge a simple L-path, which is what the penalty excludes by name', () => {
    expect(isComplexRoute('l-horizontal')).toBe(false);
    expect(isComplexRoute('l-vertical')).toBe(false);
  });

  it('does not charge the trivial routes', () => {
    expect(isComplexRoute('facing')).toBe(false);
    expect(isComplexRoute('direct')).toBe(false);
  });

  it('charges the strategies the penalty names', () => {
    expect(isComplexRoute('channel')).toBe(true);
    expect(isComplexRoute('perimeter')).toBe(true);
    expect(isComplexRoute('astar')).toBe(true);
  });

  it('charges the desperate middle rungs of the cascade', () => {
    expect(isComplexRoute('above')).toBe(true);
    expect(isComplexRoute('below')).toBe(true);
    expect(isComplexRoute('safe-lane')).toBe(true);
  });

  /**
   * A cable that could not be routed at all is already charged
   * CABLE_COLLISION_PENALTY_INCHES * 2 by `routingFailures`. Charging it here
   * too would make one defect cost two dimensions and make the score
   * explanation double-count it.
   */
  it('leaves an unroutable cable to routingFailures rather than double-charging', () => {
    expect(isComplexRoute('fallback-invalid')).toBe(false);
  });

  /**
   * A new strategy added to the cascade should default to CHARGED. New rungs
   * get added at the desperate end - that is why they are needed - so the safe
   * default is to treat an unrecognised one as complex rather than free.
   */
  it('treats an unrecognised strategy as complex, not as free', () => {
    expect(isComplexRoute('some-future-rung' as RoutingStrategy)).toBe(true);
  });
});
