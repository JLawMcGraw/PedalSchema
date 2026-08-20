/**
 * A pedal off the board is a collision with the board.
 *
 * `detectCollisions` took a `Board` for its whole life and never read it, so
 * it reported pedal-on-pedal overlap and nothing else. The store's `collisions`
 * is the ONLY collision question the UI asks - the canvas outline, the
 * properties panel and the toolbar's FIT field all read it - so a pedal
 * hanging off the edge was invisible everywhere, while the layout engine's own
 * `hasPlacementCollision` had checked bounds all along.
 *
 * Reachable through the UI by rotating: placement and drag both clamp, but
 * `rotatePedal` swapped the footprint without one.
 */
import { describe, expect, it } from 'vitest';
import { detectCollisions } from '../index';
import type { Board, Pedal, PlacedPedal } from '@/types';

const BOARD = {
  id: 'b', name: 'B', widthInches: 32, depthInches: 16, railWidthInches: 0.6,
} as Board;

const PEDAL = {
  id: 'p', name: 'P', manufacturer: 'T', category: 'overdrive',
  widthInches: 2.87, depthInches: 5.08, heightInches: 2, jacks: [],
} as unknown as Pedal;

const at = (id: string, x: number, y: number, rotation = 0): PlacedPedal =>
  ({
    id, pedalId: 'p', pedal: PEDAL, xInches: x, yInches: y,
    rotationDegrees: rotation, chainPosition: 1,
  }) as unknown as PlacedPedal;

const byId = { p: PEDAL };

describe('off-board detection', () => {
  it('reports a pedal that is nowhere near the board', () => {
    const found = detectCollisions([at('a', 60, 40)], byId, BOARD);
    expect(found).toEqual([{ pedalIds: ['a'], severity: 'off-board' }]);
  });

  /*
   * The case that is actually reachable, and the one the clamp now prevents:
   * 29.13 + 2.87 = 32.00, flush to the right edge. Rotated, the footprint
   * becomes 5.08 wide and ends at 34.21 - 2.21in past the edge.
   */
  it('reports a pedal rotated off the edge, using its ROTATED footprint', () => {
    expect(detectCollisions([at('a', 29.13, 0, 0)], byId, BOARD)).toEqual([]);
    expect(detectCollisions([at('a', 29.13, 0, 90)], byId, BOARD)).toEqual([
      { pedalIds: ['a'], severity: 'off-board' },
    ]);
  });

  it('does not cry wolf about a pedal flush to an edge', () => {
    // Exactly flush on all four sides in turn. A tolerance that is too tight
    // would make every tidily-placed board report a fault.
    expect(detectCollisions([at('a', 0, 0)], byId, BOARD)).toEqual([]);
    expect(detectCollisions([at('a', 29.13, 10.92)], byId, BOARD)).toEqual([]);
  });

  it('catches a negative coordinate, not just an overhang', () => {
    expect(detectCollisions([at('a', -1, 0)], byId, BOARD)).toEqual([
      { pedalIds: ['a'], severity: 'off-board' },
    ]);
  });

  it('reports off-board AND overlap when both are true', () => {
    // Two pedals stacked on each other, both hanging off the right edge.
    const found = detectCollisions([at('a', 30, 0), at('b', 30, 0)], byId, BOARD);
    expect(found.filter((c) => c.severity === 'off-board')).toHaveLength(2);
    expect(found.some((c) => c.severity === 'overlap')).toBe(true);
  });

  it('says nothing about a board with everything on it', () => {
    expect(detectCollisions([at('a', 0, 0), at('b', 10, 0)], byId, BOARD)).toEqual([]);
  });
});
