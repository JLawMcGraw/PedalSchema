/**
 * Rotating a pedal must not push it off the board.
 *
 * A quarter turn SWAPS the footprint, so a 2.87x5.08in pedal flush to the
 * right edge becomes 5.08 wide and hangs 2.21in past it. Placement and drag
 * have always clamped; this did not, which made rotation the one route a user
 * had to put a pedal off the board through the UI.
 *
 * Paired with the off-board half of `detectCollisions`: the clamp stops the
 * state arising, and the detector still catches what a clamp cannot fix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigurationStore } from '../configuration-store';
import { detectCollisions } from '@/lib/engine/collision';
import { makeBoard } from '@/lib/engine/__tests__/support/fixtures';
import type { Board, Pedal, PlacedPedal } from '@/types';

const store = () => useConfigurationStore.getState();

const compact = (id: string, w = 2.87, d = 5.08): Pedal =>
  ({
    id, name: id, manufacturer: 'BOSS', category: 'overdrive',
    widthInches: w, depthInches: d, heightInches: 2.6, jacks: [],
  }) as unknown as Pedal;

function init(board: Board, pedal: Pedal, x: number, y: number) {
  store().initConfiguration({
    id: 'config-rotate-clamp',
    name: 'Rotate Clamp',
    board,
    amp: null,
    placedPedals: [{
      id: 'a', configurationId: 'config-rotate-clamp', pedalId: pedal.id, pedal,
      xInches: x, yInches: y, rotationDegrees: 0, chainPosition: 1,
      location: 'front_of_amp', isActive: true, useLoop: false, createdAt: '',
    } as unknown as PlacedPedal],
    pedalsById: { [pedal.id]: pedal },
  });
}

const placed = () => store().placedPedals[0];

describe('rotate keeps the pedal on the board', () => {
  beforeEach(() => {
    const board = makeBoard('wide'); // 22 x 12.5
    // Flush to the right edge: 22 - 2.87 = 19.13.
    init(board, compact('p'), 19.13, 0);
  });

  it('pulls a right-edge pedal back when its footprint widens', () => {
    expect(placed().xInches).toBeCloseTo(19.13, 4);
    store().rotatePedal('a');

    // Rotated it is 5.08 wide, so the furthest it can sit is 22 - 5.08.
    expect(placed().rotationDegrees).toBe(90);
    expect(placed().xInches).toBeCloseTo(22 - 5.08, 4);
    expect(detectCollisions(store().placedPedals, store().pedalsById, store().board!)).toEqual([]);
  });

  it('leaves a pedal with room where it is', () => {
    init(makeBoard('wide'), compact('p'), 4, 2);
    store().rotatePedal('a');
    expect(placed().xInches).toBeCloseTo(4, 4);
    expect(placed().yInches).toBeCloseTo(2, 4);
  });

  it('clamps the bottom edge too, not just the right', () => {
    // 12.5 - 2.87 = 9.63 is flush at the bottom when rotated 90 makes the
    // pedal 2.87 DEEP; start it flush upright at 12.5 - 5.08.
    init(makeBoard('wide'), compact('p'), 0, 12.5 - 5.08);
    store().rotatePedal('a');
    expect(placed().yInches).toBeLessThanOrEqual(12.5 - 2.87 + 1e-6);
    expect(detectCollisions(store().placedPedals, store().pedalsById, store().board!)).toEqual([]);
  });

  it('undo puts the pedal back where it was', () => {
    // The clamp MOVES the pedal, which is only acceptable because it is
    // reversible - rotatePedal records history before it acts.
    store().rotatePedal('a');
    expect(placed().xInches).not.toBeCloseTo(19.13, 4);
    store().undo();
    expect(placed().xInches).toBeCloseTo(19.13, 4);
    expect(placed().rotationDegrees).toBe(0);
  });

  /*
   * The case the clamp CANNOT fix, and why both halves of this fix exist.
   * A pedal whose rotated footprint is wider than the board pins to 0 and
   * still overhangs - so the detector has to report it.
   */
  it('reports off-board when the pedal is simply too big to fit turned', () => {
    const board = { ...makeBoard('mini'), widthInches: 4, depthInches: 12 } as Board;
    init(board, compact('huge', 2.5, 9), 0, 0);
    store().rotatePedal('a');

    expect(placed().xInches).toBe(0); // pinned, not negative
    const found = detectCollisions(store().placedPedals, store().pedalsById, board);
    expect(found).toEqual([{ pedalIds: ['a'], severity: 'off-board' }]);
  });
});
