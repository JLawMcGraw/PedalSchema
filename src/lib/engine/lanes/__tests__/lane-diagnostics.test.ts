/**
 * The corridor router says WHY a cable fell back, not just that it did.
 *
 * `routeCablesWithLanes` returned `{ paths }` and nothing else, and a null in
 * that array meant one of four unrelated things: the endpoints attach to no
 * corridor, the corridors do not connect, the corridor was over capacity and
 * the cable was EVICTED, or a lane was seated and the realized geometry then
 * failed validation. Downstream they collapse further still - route-cables
 * sees only `lanePath === null` and records whichever fallback rung succeeded.
 *
 * Eviction is the one that matters. It is the `assignLanes` cliff, fixed on
 * 2026-08-02 to degrade per corridor rather than per board, and never
 * instrumented since - so nothing could count how often it fires, and a
 * regression would have looked exactly like a healthy board.
 *
 * `assignLanes` already computed the eviction set and threw it away.
 */
import { describe, it, expect } from 'vitest';
import { routeCablesWithLanes, type LaneRouteRequest } from '../index';
import { MIN_LANE_SPACING, LANE_SPACING, OBSTACLE_MARGIN, type Box } from '../../geometry';
import type { ObstacleSet } from '../../obstacles';

/** An obstacle set built by hand, so a corridor's width is exactly known. */
function obstacles(boxes: Box[], width = 800, height = 400): ObstacleSet {
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();
  boxes.forEach((_, i) => {
    boxToPedalId.set(i, `p${i}`);
    pedalIdToBox.set(`p${i}`, i);
  });
  return {
    boxes,
    boxToPedalId,
    pedalIdToBox,
    boardBounds: { minX: 0, maxX: width, minY: 0, maxY: height },
    scale: 40,
  };
}

const box = (x: number, y: number, w = 100, h = 120): Box => ({ x, y, width: w, height: h });

describe('lane router diagnostics', () => {
  it('reports one outcome per request, in request order', () => {
    const obs = obstacles([box(100, 100), box(400, 100)]);
    const requests: LaneRouteRequest[] = [
      { from: { x: 100, y: 160 }, to: { x: 400, y: 160 }, fromPedalId: 'p0', toPedalId: 'p1' },
      { from: { x: 200, y: 160 }, to: { x: 500, y: 160 }, fromPedalId: 'p0', toPedalId: 'p1' },
    ];
    const result = routeCablesWithLanes(requests, obs);

    expect(result.diagnostics.outcomes).toHaveLength(requests.length);
  });

  /**
   * The invariant that makes the diagnostic non-vacuous. Without it, outcomes
   * could drift out of step with paths and every count built on them would be
   * quietly wrong.
   */
  it('a path exists exactly when the outcome is a success', () => {
    const obs = obstacles([box(100, 100), box(400, 100), box(250, 250, 80, 80)]);
    const requests: LaneRouteRequest[] = [
      { from: { x: 100, y: 160 }, to: { x: 400, y: 160 }, fromPedalId: 'p0', toPedalId: 'p1' },
      { from: { x: 140, y: 100 }, to: { x: 290, y: 250 }, fromPedalId: 'p0', toPedalId: 'p2' },
      { from: { x: 500, y: 220 }, to: { x: 250, y: 330 }, fromPedalId: 'p1', toPedalId: 'p2' },
    ];
    const { paths, diagnostics } = routeCablesWithLanes(requests, obs);

    paths.forEach((path, i) => {
      const outcome = diagnostics.outcomes[i];
      const succeeded = outcome === 'lane-routed' || outcome === 'shortcut';
      expect(
        path !== null,
        `cable ${i}: outcome=${outcome} but path is ${path === null ? 'null' : 'set'}`
      ).toBe(succeeded);
    });
  });

  it('names the facing-jack shortcut, which never enters the corridor graph', () => {
    // Two pedals a hair apart with jacks facing each other across the gap.
    const obs = obstacles([box(100, 100, 100, 120), box(220, 100, 100, 120)]);
    const requests: LaneRouteRequest[] = [
      { from: { x: 200, y: 160 }, to: { x: 220, y: 160 }, fromPedalId: 'p0', toPedalId: 'p1' },
    ];
    const { paths, diagnostics } = routeCablesWithLanes(requests, obs);

    expect(diagnostics.outcomes[0]).toBe('shortcut');
    expect(paths[0]).not.toBeNull();
    // A shortcut is not a corridor route, so it must not register pressure.
    expect(diagnostics.evictedCount).toBe(0);
  });

  /**
   * THE CLIFF. Force one corridor far past capacity and confirm the evictions
   * are both counted and attributed to the corridor that caused them.
   */
  it('counts evictions and attributes them to the over-capacity corridor', () => {
    // ONE corridor, wide enough to seat a couple of lanes, and ten cables
    // that must all TRAVEL ALONG it - not merely hop across it.
    //
    // The previous fixture sent each cable straight across a gap of
    // MIN_LANE_SPACING * 2, which over-subscribed only because the gap was
    // then too tight for the direct route. When OBSTACLE_MARGIN dropped from
    // 8 to 6 on 2026-08-18 that same gap became crossable, every cable took
    // the facing-jack shortcut, and the test went vacuous - it asserted
    // evictions on a fixture that no longer produced any. Pressure has to come
    // from cables SHARING a corridor's length, which is what assignLanes
    // actually meters, not from the corridor being too tight to enter.
    const gap = 2 * OBSTACLE_MARGIN + 2 * LANE_SPACING; // seats ~2 lanes
    const obs = obstacles(
      [box(0, 0, 700, 150), box(0, 150 + gap, 700, 150)],
      800,
      150 + gap + 150
    );

    // Every cable runs nearly the full width of that one corridor, so they
    // all want a lane in the same place at the same time.
    const requests: LaneRouteRequest[] = Array.from({ length: 10 }, (_, i) => ({
      from: { x: 20 + i, y: 150 },
      to: { x: 680 - i, y: 150 + gap },
      fromPedalId: 'p0',
      toPedalId: 'p1',
    }));

    const { paths, diagnostics } = routeCablesWithLanes(requests, obs);

    // The precondition: this fixture must actually over-subscribe something,
    // or the test proves nothing.
    expect(
      diagnostics.evictedCount,
      'fixture did not over-subscribe any corridor - the test would be vacuous'
    ).toBeGreaterThan(0);

    // Every eviction is reported as such, and evicted cables have no path.
    const evictedIdx = diagnostics.outcomes
      .map((o, i) => (o === 'evicted' ? i : -1))
      .filter((i) => i >= 0);
    expect(evictedIdx).toHaveLength(diagnostics.evictedCount);
    for (const i of evictedIdx) expect(paths[i]).toBeNull();

    // Pressure names a corridor, and the eviction count reconciles with it.
    expect(diagnostics.pressure.length).toBeGreaterThan(0);
    for (const p of diagnostics.pressure) {
      expect(p.demanded).toBeGreaterThan(p.capacity);
      expect(p.capacity).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports no pressure and no evictions on a board with room', () => {
    const obs = obstacles([box(100, 100), box(500, 100)]);
    const requests: LaneRouteRequest[] = [
      { from: { x: 100, y: 160 }, to: { x: 500, y: 160 }, fromPedalId: 'p0', toPedalId: 'p1' },
    ];
    const { diagnostics } = routeCablesWithLanes(requests, obs);

    expect(diagnostics.evictedCount).toBe(0);
    expect(diagnostics.pressure).toEqual([]);
    expect(diagnostics.outcomes).not.toContain('evicted');
  });
});
