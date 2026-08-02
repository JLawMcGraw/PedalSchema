/**
 * The facing-jack shortcut must earn its `valid: true`.
 *
 * routeCablesWithLanes returns a path for two standoffs that are collinear and
 * within 2*STANDOFF+1 of each other, WITHOUT consulting the corridor graph.
 * Callers (route-cables.ts) stamp every non-null lane path `valid: true`
 * unconditionally, so an unchecked shortcut path is an unearned guarantee -
 * and once the layout cost function shares this router it becomes a scoring
 * error, not just a rendering one.
 *
 * Neither saved board exercises the blocked case (the step-2 fingerprint diff
 * was empty), so without this test the guard would be indistinguishable from
 * dead code.
 *
 * NOTE the fixture needs real pedal boxes. getStandoffPoint returns the jack
 * position unchanged when the box is null (pathfinding/index.ts:46), so a
 * request with null pedal ids gets un-offset standoffs and never enters the
 * shortcut window at all - a version of this test written that way passed
 * with the guard deliberately disabled.
 */
import { describe, it, expect } from 'vitest';
import { routeCablesWithLanes, type LaneRouteRequest } from '../lanes';
import type { ObstacleSet } from '../obstacles';
import { STANDOFF, OBSTACLE_MARGIN } from '../geometry';
import { getStandoffPoint } from '../pathfinding';

// Two pedals facing each other across a 30px gap, jacks centred on the facing
// edges. Standoffs land 10px inside that gap from each side: (400,210) and
// (400,220).
const BOX_A = { x: 300, y: 100, width: 200, height: 100 }; // bottom edge y=200
const BOX_B = { x: 300, y: 230, width: 200, height: 100 }; // top edge    y=230

const JACK_A = { x: 400, y: 200 };
const JACK_B = { x: 400, y: 230 };

function obstacleSet(extraBoxes: Array<{ x: number; y: number; width: number; height: number }> = []): ObstacleSet {
  return {
    boxes: [BOX_A, BOX_B, ...extraBoxes],
    boxToPedalId: new Map([[0, 'a'], [1, 'b']]),
    pedalIdToBox: new Map([['a', 0], ['b', 1]]),
    boardBounds: { minX: 0, maxX: 800, minY: 0, maxY: 500 },
    scale: 40,
  };
}

const facing: LaneRouteRequest = {
  from: JACK_A,
  to: JACK_B,
  fromPedalId: 'a',
  toPedalId: 'b',
};

describe('facing-jack shortcut', () => {
  it('the fixture really is inside the shortcut window', () => {
    // Guards the other two: if STANDOFF or the gap changes so that the
    // shortcut no longer fires, both would pass vacuously.
    const fromStub = getStandoffPoint(JACK_A, BOX_A, STANDOFF);
    const toStub = getStandoffPoint(JACK_B, BOX_B, STANDOFF);

    expect(fromStub).toEqual({ x: 400, y: 210 });
    expect(toStub).toEqual({ x: 400, y: 220 });
    expect(Math.abs(fromStub.x - toStub.x)).toBeLessThan(1);
    expect(Math.abs(fromStub.y - toStub.y)).toBeLessThanOrEqual(2 * STANDOFF + 1);
  });

  it('takes the shortcut when nothing is in the way', () => {
    const { paths } = routeCablesWithLanes([facing], obstacleSet());

    expect(paths[0]).not.toBeNull();
    // Straight down one x: the shortcut, not a corridor detour.
    expect(new Set(paths[0]!.map((p) => p.x))).toEqual(new Set([400]));
    expect(paths[0]!.map((p) => p.y)).toEqual([200, 210, 220, 230]);
  });

  it('refuses the shortcut when a box sits between the two standoffs', () => {
    // Squarely inside the 210..220 stub gap, and clear of OBSTACLE_MARGIN
    // slop against either pedal.
    const blocker = { x: 390, y: 213, width: 20, height: 4 };
    expect(blocker.y).toBeGreaterThan(200 + OBSTACLE_MARGIN - 1);

    const { paths } = routeCablesWithLanes([facing], obstacleSet([blocker]));
    const path = paths[0];

    // null is a correct answer: the caller falls back to the strategy cascade,
    // which validates honestly. What must NOT happen is the straight line
    // being returned - the caller would stamp it valid.
    if (path) {
      const crossesBlocker = path.some(
        (p) => p.x >= blocker.x && p.x <= blocker.x + blocker.width
          && p.y >= blocker.y && p.y <= blocker.y + blocker.height
      );
      expect(crossesBlocker).toBe(false);
      // The shortcut's exact signature - four points straight down x=400 -
      // must not be what came back.
      const isShortcutPath = path.length === 4
        && path.every((p) => p.x === 400)
        && path[1].y === 210 && path[2].y === 220;
      expect(isShortcutPath).toBe(false);
    }
  });
});
