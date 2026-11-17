/**
 * A lane sits where its cable is going, not on the corridor's centre line.
 *
 * Lanes used to be laid out around the centre of the corridor, whatever the
 * cables in it wanted. A corridor is often far wider than a cable needs - the
 * strip above the back row runs from 40px off the board down to the pedals -
 * so its centre can be a long way from both ends of the cable using it. The
 * cable then leaves its jack, travels to the centre line, runs along it, and
 * travels back: length for nothing, and on the three-pedal fixture a 127px
 * run down the face of the amp.
 *
 * A cable's length does not depend on where it crosses a corridor as long as
 * that is between its two ends, so each lane now takes the line in that span
 * nearest the centre, and lanes sharing a corridor keep their spacing and
 * their order around those preferences.
 *
 * Measured on 2026-11-16 over 216 boards: the lane router's own drawings went
 * from 14,468in to 11,061in, and with the two-router guard choosing between
 * pictures the total score improved 5% (12,034.6 to 11,418.6) while the
 * cables needing a complex route fell from 132 to 89. On the owner's
 * nine-pedal board Optimize now lands on 58.1in where it had drawn 65.1in.
 *
 * Every test here was run against the centred layout first.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { routeCablesWithLanes, type LaneRouteRequest } from '../index';
import { LANE_SPACING, OBSTACLE_MARGIN, STANDOFF, type Box, type Point } from '../../geometry';
import type { ObstacleSet } from '../../obstacles';
import { makeAmp, makeBoard, makePedalSet, SCALE } from '../../__tests__/support/fixtures';
import { simulateConfiguration } from '../../__tests__/support/simulate';
import { generateObstacles } from '../../obstacles';
import { routeBothWays } from '../../cables/route-cables';

function obstacles(boxes: Box[], width = 800, height = 400): ObstacleSet {
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();
  boxes.forEach((_, i) => {
    boxToPedalId.set(i, `p${i}`);
    pedalIdToBox.set(`p${i}`, i);
  });
  return { boxes, boxToPedalId, pedalIdToBox, boardBounds: { minX: 0, maxX: width, minY: 0, maxY: height }, scale: 40 };
}

/** The long horizontal runs of a path: [y, fromX, toX]. */
const horizontalRuns = (path: Point[]): Array<{ y: number; lo: number; hi: number }> =>
  path.slice(1).flatMap((b, i) => {
    const a = path[i];
    return Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 40
      ? [{ y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }]
      : [];
  });

const length = (path: Point[]): number =>
  path.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);

describe('a cable alone in a wide corridor', () => {
  // One row of pedals across the middle. Above it the corridor runs from 40px
  // off the board to the pedals: y -40 .. 144, centre line y = 52.
  const row = [{ x: 100, y: 150, width: 600, height: 100 }];
  const set = obstacles(row);

  it('crosses it between its two ends, not on the centre line', () => {
    // Amp side to guitar side, both ends near the pedals: y = 120 and y = 130.
    const request: LaneRouteRequest = { from: { x: -60, y: 120 }, to: { x: 860, y: 130 }, fromPedalId: null, toPedalId: null };
    const { paths, diagnostics } = routeCablesWithLanes([request], set);

    expect(diagnostics.outcomes[0]).toBe('lane-routed');
    const runs = horizontalRuns(paths[0]!);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.y).toBeGreaterThanOrEqual(120);
      expect(run.y).toBeLessThanOrEqual(130);
    }
    // And so it is as short as an orthogonal cable between those points can be.
    expect(length(paths[0]!)).toBeCloseTo(920 + 10, 6);
  });

  it('still takes the centre line when that is between its ends', () => {
    const request: LaneRouteRequest = { from: { x: -60, y: 10 }, to: { x: 860, y: 100 }, fromPedalId: null, toPedalId: null };
    const { paths } = routeCablesWithLanes([request], set);
    const runs = horizontalRuns(paths[0]!);
    expect(runs.some((run) => Math.abs(run.y - 52) < 0.5)).toBe(true);
  });
});

describe('cables sharing a corridor', () => {
  const row = [{ x: 100, y: 150, width: 600, height: 100 }];
  const set = obstacles(row);

  it('keep a full lane apart, in order, around the line they all want', () => {
    // Three cables that would all take y = 120 if they had the corridor alone.
    const requests: LaneRouteRequest[] = [0, 1, 2].map((i) => ({
      from: { x: -60, y: 118 + i }, to: { x: 860, y: 120 + i }, fromPedalId: null, toPedalId: null,
    }));
    const { paths, diagnostics } = routeCablesWithLanes(requests, set);
    expect(diagnostics.outcomes).toEqual(['lane-routed', 'lane-routed', 'lane-routed']);

    // Each cable's long run across the board - its lane in the shared corridor.
    const ys = paths.map((p) => horizontalRuns(p!).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0].y);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeCloseTo(LANE_SPACING, 6);
    expect(sorted[2] - sorted[1]).toBeCloseTo(LANE_SPACING, 6);
    // All inside the corridor, clear of the pedals below by more than the margin.
    for (const y of ys) {
      expect(y).toBeGreaterThan(-40);
      expect(y).toBeLessThan(150 - OBSTACLE_MARGIN);
    }
  });
});

describe('a lane at the edge of a corridor', () => {
  it('sits just inside it, where the path is still legal', () => {
    // Both ends BELOW the corridor's range on the across axis would pull the
    // lane onto the corridor's edge - which is exactly one margin from the
    // pedals, and a run on the margin counts as touching.
    const boxes = [
      { x: 100, y: 20, width: 250, height: 120 },
      { x: 450, y: 20, width: 250, height: 120 },
      { x: 100, y: 200, width: 600, height: 120 },
    ];
    const set = obstacles(boxes);
    // Left jack of the right-hand top pedal, down to the bottom pedal's top edge.
    const request: LaneRouteRequest = {
      from: { x: 450, y: 80 }, to: { x: 300, y: 200 }, fromPedalId: 'p1', toPedalId: 'p2',
    };
    const { paths, diagnostics } = routeCablesWithLanes([request], set);
    expect(diagnostics.outcomes[0]).toBe('lane-routed');
    expect(paths[0]).not.toBeNull();
  });
});

describe('three pedals in a row, drawn by the lane router alone', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  it('no longer runs the amp cable down the face of the amp', () => {
    const board = makeBoard('wide');
    const set = makePedalSet('trio');
    const flags = { useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false, ns2UseLoop: false, withLockedPedals: false };
    const { pedals, derived } = simulateConfiguration({
      label: 'trio', board, amp: makeAmp(true), pedalsById: set.pedalsById, placedPedals: set.placedPedals, flags,
    });
    const { lanes } = routeBothWays(
      derived.routedCables.map((r) => ({
        from: r.fromPos, to: r.toPos,
        fromPedalId: r.cable.fromPedalId ?? null, toPedalId: r.cable.toPedalId ?? null,
      })),
      generateObstacles(pedals, set.pedalsById, board, SCALE)
    );
    const ampIndex = derived.routedCables.findIndex((r) => r.cable.toType === 'amp_input');
    const amp = lanes[ampIndex].path;
    const jack = amp[amp.length - 1];

    // No vertical run in the amp's own jack column longer than a plug.
    for (let i = 0; i < amp.length - 1; i++) {
      const a = amp[i];
      const b = amp[i + 1];
      const inJackColumn = Math.abs(a.x - jack.x) < 0.5 && Math.abs(b.x - jack.x) < 0.5;
      if (inJackColumn) expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(STANDOFF + 0.5);
    }
    // It was 11.4in; a plain L is 5.1in.
    expect(length(amp) / SCALE).toBeLessThan(8);
  });
});
