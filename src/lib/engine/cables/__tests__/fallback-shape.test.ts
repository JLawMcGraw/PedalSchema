/**
 * The last resort must still look like a cable.
 *
 * When every strategy fails, the router returned the two standoffs joined
 * directly - a DIAGONAL, cutting across the board through whatever lay between.
 * That is a drawing of a cable that could not exist: patch cables leave a jack
 * square-on and turn at right angles, and every other path this module produces
 * is Manhattan.
 *
 * A sealed jack is a real situation, not a bug to be routed around. Measured on
 * the `test` board: the NS-2's left output at (744,269) has its standoff sealed
 * on all four sides - the row-1/row-2 gap is 7.6px where a path needs 16, and
 * the PW-3 straddler merges rows 2 and 3 so there is no lane between them
 * either. No corridor, no perimeter ring and no A* route exists at 8px
 * clearance. In the room you would simply press the cable in; the pedals have
 * chamfers and the cable bends.
 *
 * So the last resort routes THROUGH pedals - deliberately - and says so by
 * staying `fallback-invalid` and drawing red. What changes is that it is now a
 * cable shape rather than a diagonal, and it takes the L that crosses the
 * fewest pedal bodies.
 */
import { describe, it, expect } from 'vitest';
import { routeCableWithObstacles } from '../routing-strategies';
import { findPathViolations } from '../../geometry';
import type { ObstacleSet } from '../../obstacles';
import type { Box } from '../../geometry';

function obstacles(boxes: Box[], w = 1280, h = 640): ObstacleSet {
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();
  boxes.forEach((_, i) => {
    boxToPedalId.set(i, `p${i}`);
    pedalIdToBox.set(`p${i}`, i);
  });
  return { boxes, boxToPedalId, pedalIdToBox, boardBounds: { minX: 0, maxX: w, minY: 0, maxY: h }, scale: 40 };
}
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/**
 * A jack sealed on all four sides, reproducing the `test` board's geometry:
 * rows packed closer than twice OBSTACLE_MARGIN, so no lane exists anywhere.
 */
function sealedBoard() {
  const boxes: Box[] = [];
  // Row 1 and row 2 only 8px apart - a path needs 16
  for (let i = 0; i < 8; i++) boxes.push(box(i * 150, 0, 140, 217));
  for (let i = 0; i < 8; i++) boxes.push(box(i * 150, 225, 140, 204));
  // Row 3 hard against row 2
  for (let i = 0; i < 8; i++) boxes.push(box(i * 150, 436, 140, 204));
  return obstacles(boxes);
}

describe('the last resort is a cable, not a diagonal', () => {
  const SRC = { x: 750, y: 300 }; // left edge of a middle-row pedal, sealed in
  const DST = { x: 1220, y: 0 };

  it('gives up honestly - still fallback-invalid, still drawn red', () => {
    const obs = sealedBoard();
    const result = routeCableWithObstacles(SRC, DST, obs, 'p13', 'p7');

    // The precondition. If some strategy solves this the test proves nothing.
    expect(
      result.strategy,
      'fixture is no longer sealed - the last-resort path is not being exercised'
    ).toBe('fallback-invalid');
    expect(result.valid).toBe(false);
  });

  it('emits an orthogonal path - every segment axis-aligned', () => {
    const obs = sealedBoard();
    const { path } = routeCableWithObstacles(SRC, DST, obs, 'p13', 'p7');

    expect(path.length).toBeGreaterThan(1);
    for (let i = 0; i < path.length - 1; i++) {
      const dx = Math.abs(path[i + 1].x - path[i].x);
      const dy = Math.abs(path[i + 1].y - path[i].y);
      expect(
        dx < 0.5 || dy < 0.5,
        `diagonal segment (${path[i].x},${path[i].y})->(${path[i + 1].x},${path[i + 1].y})`
      ).toBe(true);
    }
  });

  it('takes the L that crosses the fewest pedal bodies', () => {
    const obs = sealedBoard();
    const { path } = routeCableWithObstacles(SRC, DST, obs, 'p13', 'p7');

    const ends = { fromBoxIdx: obs.pedalIdToBox.get('p13')!, toBoxIdx: obs.pedalIdToBox.get('p7')! };
    const chosen = findPathViolations(path, obs.boxes, ends).length;

    // Build the other L by hand from the same standoffs and compare.
    const s = path[1];
    const t = path[path.length - 2];
    const otherL = [path[0], s, { x: s.x, y: t.y }, t, path[path.length - 1]];
    const alternative = findPathViolations(otherL, obs.boxes, ends).length;

    expect(
      chosen,
      `chose an L crossing ${chosen} bodies when the other crosses ${alternative}`
    ).toBeLessThanOrEqual(alternative);
  });
});
