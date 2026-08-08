/**
 * A perimeter route must be allowed to leave the board by an edge that is not
 * the nearest one.
 *
 * `routeAroundBoard` is the last rung of the cascade and exists for exactly one
 * situation: a board so full that no on-board route survives (phase 6). It
 * picked the endpoint's NEAREST edge and ran straight out through it. On a full
 * board that straight shot is the one thing you cannot count on - the board is
 * full, so something is usually in the way - and when it was blocked the
 * strategy returned null and the cable fell through to `fallback-invalid`,
 * drawn as a red diagonal across the board.
 *
 * Measured on the `test` board, 2026-08-08. The cable from chain 12's left
 * output to the EQ-200's rear input:
 *
 *   fromStandoff (734,269)  distances to [left,top,right,bottom] = [734,269,546,371]
 *   nearest edge = top, so it exits straight up from (734,269) to (734,-24)
 *   DC-2W occupies x[716,832] y[0,204] - the exit segment goes through it
 *   both ring directions share that stub, so both are rejected -> null
 *
 * The strategy built to rescue a full board could not rescue one.
 */
import { describe, it, expect } from 'vitest';
import { routeCableWithObstacles } from '../routing-strategies';
import type { ObstacleSet } from '../../obstacles';
import type { Box } from '../../geometry';

function obstacles(boxes: Box[], w = 1280, h = 640): ObstacleSet {
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
    boardBounds: { minX: 0, maxX: w, minY: 0, maxY: h },
    scale: 40,
  };
}

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

describe('perimeter routing leaves by whichever edge is clear', () => {
  /**
   * The real geometry, reduced to the parts that matter: a source pocketed
   * under a back-row pedal, so its nearest-edge exit (straight up) is blocked,
   * with the rest of the board packed solid enough that no on-board route
   * exists either.
   */
  // The source is pocketed: its nearest edge (top, 269px) is blocked by
  // `blocker`, its left by `midWide`, and its right by its OWN body - a cable
  // leaving a left-edge jack cannot set off rightwards through the pedal it
  // just left. Only the downward exit is clear, and the front row is parted to
  // leave it so. That is the shape the `test` board actually had.
  const BOXES = {
    blocker: box(716, 0, 116, 204),      // directly above the source
    backLeft: box(560, 0, 116, 204),
    backRight: box(880, 0, 116, 204),
    midWide: box(450, 225, 270, 204),    // source sits just right of this
    source: box(744, 225, 116, 204),     // jack on its LEFT edge
    frontLeft: box(300, 436, 200, 204),  // front row, parted around x=734
    frontRight: box(900, 436, 300, 204),
    target: box(1144, 0, 136, 204),      // jack on its REAR edge
  };
  const SRC = { x: 744, y: 269 };
  const DST = { x: 1220, y: 0 };
  const order = (extra: Partial<Record<keyof typeof BOXES, boolean>> = {}) => {
    const keys = (Object.keys(BOXES) as Array<keyof typeof BOXES>).filter((k) => extra[k] !== false);
    return { boxes: keys.map((k) => BOXES[k]), srcId: `p${keys.indexOf('source')}`, dstId: `p${keys.indexOf('target')}` };
  };

  it('finds a route when the nearest edge is blocked but another is clear', () => {
    const { boxes, srcId, dstId } = order();
    const result = routeCableWithObstacles(SRC, DST, obstacles(boxes), srcId, dstId);

    expect(
      result.strategy,
      `expected a real route, got ${result.strategy} with path ${JSON.stringify(result.path)}`
    ).not.toBe('fallback-invalid');
    expect(result.valid).toBe(true);
    // Specifically the rung under test. If some on-board strategy starts
    // solving this, the case has stopped exercising routeAroundBoard and the
    // fixture needs tightening rather than the assertion loosening.
    expect(
      result.strategy,
      `fixture no longer reaches the perimeter rung: ${JSON.stringify(result.path)}`
    ).toBe('perimeter');
  });

  /**
   * Assert the temptation is real: with the blocking pedal removed, the OLD
   * nearest-edge exit is clear and the cable routes without any of this. If
   * this ever fails, the case above has stopped testing what it claims to.
   */
  it('the blocking pedal is what makes the case hard', () => {
    const { boxes, srcId, dstId } = order({ blocker: false });
    const result = routeCableWithObstacles(SRC, DST, obstacles(boxes), srcId, dstId);
    expect(result.strategy).not.toBe('fallback-invalid');
    expect(result.valid).toBe(true);
  });

  /**
   * A perimeter route is a real cable lying beside the board, so it must not
   * cut back across the board's interior on its way round.
   */
  it('a perimeter route stays off the board between its endpoints', () => {
    const { boxes, srcId, dstId } = order();
    const obs = obstacles(boxes);
    const result = routeCableWithObstacles(SRC, DST, obs, srcId, dstId);
    if (result.strategy !== 'perimeter') return; // another strategy solved it; nothing to assert

    const { minX, maxX, minY, maxY } = obs.boardBounds;
    // Interior waypoints (excluding the two endpoint stubs at each end) should
    // be outside the board, or on its edge - never buried in the middle.
    const interior = result.path.slice(2, -2);
    for (const p of interior) {
      const inside = p.x > minX + 1 && p.x < maxX - 1 && p.y > minY + 1 && p.y < maxY - 1;
      expect(inside, `perimeter waypoint (${p.x},${p.y}) is inside the board`).toBe(false);
    }
  });
});
