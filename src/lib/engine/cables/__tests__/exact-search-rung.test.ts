/**
 * The cascade's search rung can use the gaps the placer leaves.
 *
 * Every rung above it tries one fixed shape - an L, a run down a corridor
 * between rows, a run over or under everything. When none of those fits, the
 * search rung is what finds "down the gap between these two pedals", and until
 * 2026-11-16 it could not: it searched an 8px grid whose blocked cells closed
 * any gap under about 0.9in, on boards packed at 0.5in. A cable whose only
 * route was a 20px gap was sent around the outside of the board and drawn
 * dashed - "no room, run it underneath" - when there was room.
 *
 * That rung now searches the sparse grid in pathfinding/sparse-grid, which is
 * tested on its own there. This file is the cascade-level half: it was run
 * against the old rung first, and every gap below 36px fails there with
 * `expected 'perimeter' to be 'astar'`.
 */
import { describe, it, expect } from 'vitest';
import { routeCableWithObstacles } from '../routing-strategies';
import type { ObstacleSet } from '../../obstacles';
import type { Box } from '../../geometry';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

function obstacles(boxes: Box[], w = 1000, h = 600): ObstacleSet {
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();
  boxes.forEach((_, i) => {
    boxToPedalId.set(i, `p${i}`);
    pedalIdToBox.set(`p${i}`, i);
  });
  return { boxes, boxToPedalId, pedalIdToBox, boardBounds: { minX: 0, maxX: w, minY: 0, maxY: h }, scale: 40 };
}

/**
 * One row of four boxes spanning the board edge to edge. The outer pairs are
 * 10px apart - sealed - so the only way from above the row to below it, short
 * of leaving the board, is the `gap` between the middle two.
 *
 * Every fixed-shape rung fails by construction: both L-paths end on a vertical
 * leg through a box, there is one row so there is no corridor between rows, and
 * over-the-top and under-the-bottom have the same vertical-leg problem.
 */
function oneRow(gap: number) {
  const left = 440;
  const right = left + gap;
  return {
    left, right,
    set: obstacles([
      box(0, 200, 315, 200),
      box(325, 200, left - 325, 200),
      box(right, 200, 115, 200),
      box(right + 125, 200, 1000 - (right + 125), 200),
    ]),
    from: { x: 380, y: 150 },
    to: { x: right + 60, y: 450 },
  };
}

describe('the search rung threads the gap between two pedals', () => {
  // 14 is the designed row corridor, 20 the minimum side-by-side spacing.
  for (const gap of [14, 20, 28, 36]) {
    it(`${gap}px (${(gap / 40).toFixed(2)}in)`, () => {
      const f = oneRow(gap);
      const result = routeCableWithObstacles(f.from, f.to, f.set);

      expect(result.strategy).toBe('astar');
      expect(result.valid).toBe(true);

      // On the board the whole way, and through the gap.
      for (const p of result.path) {
        expect(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 600).toBe(true);
      }
      const through = result.path.some((p, i) => {
        const q = result.path[i + 1];
        return q !== undefined && Math.abs(p.x - q.x) < 0.5 &&
          p.x > f.left && p.x < f.right && Math.min(p.y, q.y) < 200 && Math.max(p.y, q.y) > 400;
      });
      expect(through).toBe(true);
    });
  }

  it('still goes around the board when the gap really is too thin', () => {
    // 12px is two margins with nothing between them. The search must say no,
    // so the cable falls to the perimeter rung and is drawn as what it is.
    const f = oneRow(12);
    const result = routeCableWithObstacles(f.from, f.to, f.set);
    expect(result.strategy).toBe('perimeter');
    expect(result.valid).toBe(true);
  });
});
