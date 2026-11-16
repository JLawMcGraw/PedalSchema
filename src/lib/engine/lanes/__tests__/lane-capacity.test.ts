/**
 * A corridor is full where cables are SIDE BY SIDE, not where they are many.
 *
 * A corridor's capacity is how many cables fit across it. `assignLanes` used
 * to compare that against how many cables used the corridor anywhere along its
 * length - so the corridor between two rows, which runs the whole width of the
 * board and at the designed 14px seats exactly one lane, carried one cable in
 * total. Two cables hopping rows at opposite ends of a 32in board, 600px
 * apart, and one was evicted for want of a lane the other was nowhere near.
 *
 * Measured on 2026-11-16 over 216 optimized boards: 49 cables evicted from 14
 * over-capacity corridors before, 16 from 7 after.
 *
 * What did NOT change, and is pinned at the bottom of this file: a corridor
 * with room still gives every cable its own lane, even cables that never meet.
 * Sharing wherever it is possible was built first and measured worse - the
 * lane router's own crossings rose from 307 to 410 - because which side of its
 * neighbours a run sits on is what keeps its legs from crossing them. A lane
 * is shared only when the alternative is an eviction.
 *
 * The first three tests were run against the old assignment first; all three
 * fail there.
 */
import { describe, it, expect } from 'vitest';
import { routeCablesWithLanes, type LaneRouteRequest } from '../index';
import { LANE_SPACING, OBSTACLE_MARGIN, type Box, type Point } from '../../geometry';
import type { ObstacleSet } from '../../obstacles';

const COLUMNS = 8;
const PEDAL_W = 115;
const PEDAL_H = 200;
const PITCH = 155; // 40px between neighbours: a side gap with room for several lanes
const LEFT = 20;
const TOP = 8;

/**
 * Two rows of eight pedals, `rowGap` px apart. Box i is the top row's column
 * i; box 8 + i is the bottom row's.
 */
function twoRows(rowGap: number): { set: ObstacleSet; corridorY: [number, number] } {
  const boxes: Box[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      boxes.push({
        x: LEFT + col * PITCH,
        y: row === 0 ? TOP : TOP + PEDAL_H + rowGap,
        width: PEDAL_W,
        height: PEDAL_H,
      });
    }
  }
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();
  boxes.forEach((_, i) => {
    boxToPedalId.set(i, `p${i}`);
    pedalIdToBox.set(`p${i}`, i);
  });
  return {
    set: {
      boxes, boxToPedalId, pedalIdToBox, scale: 40,
      boardBounds: { minX: 0, maxX: 1280, minY: 0, maxY: TOP + 2 * PEDAL_H + rowGap + TOP },
    },
    corridorY: [TOP + PEDAL_H + OBSTACLE_MARGIN, TOP + PEDAL_H + rowGap - OBSTACLE_MARGIN],
  };
}

/**
 * A cable from the LEFT jack of the top-row pedal in `fromCol` to the RIGHT
 * jack of the bottom-row pedal two columns to its left. It has to drop into
 * the corridor between the rows and run about one pedal pitch along it.
 */
function hop(set: ObstacleSet, fromCol: number): LaneRouteRequest {
  const from = set.boxes[fromCol];
  const to = set.boxes[COLUMNS + fromCol - 2];
  return {
    from: { x: from.x, y: from.y + from.height / 2 },
    to: { x: to.x + to.width, y: to.y + to.height / 2 },
    fromPedalId: `p${fromCol}`,
    toPedalId: `p${COLUMNS + fromCol - 2}`,
  };
}

/** The stretch of a path that runs along the corridor between the rows. */
function runBetweenRows(path: Point[], corridorY: [number, number]): { y: number; lo: number; hi: number } | null {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 20;
    if (horizontal && a.y >= corridorY[0] - 0.5 && a.y <= corridorY[1] + 0.5) {
      return { y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) };
    }
  }
  return null;
}

describe('a one-lane corridor carries cables that never meet', () => {
  // 14px is the designed ROW_GAP at 40px/in: two margins and 2px to spare.
  const { set, corridorY } = twoRows(14);

  it('seats two cables at opposite ends of the board', () => {
    const { paths, diagnostics } = routeCablesWithLanes([hop(set, 2), hop(set, 7)], set);

    expect(diagnostics.outcomes).toEqual(['lane-routed', 'lane-routed']);
    expect(diagnostics.evictedCount).toBe(0);
    expect(diagnostics.pressure).toEqual([]);

    // Both really are in the one lane, and really do not meet.
    const left = runBetweenRows(paths[0]!, corridorY)!;
    const right = runBetweenRows(paths[1]!, corridorY)!;
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right.y).toBeCloseTo(left.y, 6);
    expect(right.lo - left.hi).toBeGreaterThan(400);
  });

  it('seats one in every stretch of the corridor at once', () => {
    // Three hops whose runs lie end to end with a pedal's width between them.
    const { diagnostics } = routeCablesWithLanes([hop(set, 2), hop(set, 4), hop(set, 6)], set);
    expect(diagnostics.outcomes).toEqual(['lane-routed', 'lane-routed', 'lane-routed']);
    expect(diagnostics.evictedCount).toBe(0);
  });

  it('still evicts where two cables want the SAME stretch, and counts that stretch', () => {
    // Columns 2 and 3 hop over neighbouring gaps: their runs meet end to end.
    // Column 7's is far away and wants nothing they want.
    const { diagnostics } = routeCablesWithLanes([hop(set, 2), hop(set, 3), hop(set, 7)], set);

    expect(diagnostics.outcomes[2]).toBe('lane-routed');
    expect(diagnostics.outcomes.filter((o) => o === 'evicted')).toHaveLength(1);
    expect(diagnostics.evictedCount).toBe(1);

    // Pressure is the pile-up, not the head count: two cables wanted one
    // stretch of a one-lane corridor. It used to say three were demanded.
    expect(diagnostics.pressure).toHaveLength(1);
    expect(diagnostics.pressure[0]).toMatchObject({ capacity: 1, demanded: 2, evicted: 1 });
  });
});

describe('a corridor with room still gives every cable its own lane', () => {
  // 60px between the rows: 48px usable, room for five lanes.
  const { set, corridorY } = twoRows(60);

  it('even for two cables that never meet', () => {
    const { paths, diagnostics } = routeCablesWithLanes([hop(set, 2), hop(set, 7)], set);
    expect(diagnostics.outcomes).toEqual(['lane-routed', 'lane-routed']);

    const left = runBetweenRows(paths[0]!, corridorY)!;
    const right = runBetweenRows(paths[1]!, corridorY)!;
    expect(Math.abs(right.y - left.y)).toBeCloseTo(LANE_SPACING, 6);
  });
});
