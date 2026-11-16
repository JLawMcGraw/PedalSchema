/**
 * The placer leaves the console alone.
 *
 * Two things it used to do to it, both from inside what is otherwise a pure
 * function that now runs in a Web Worker:
 *
 * 1. WARN ON EVERY DEGRADED CANDIDATE. `[GREEDY] Order relaxed...` and
 *    `[GREEDY] Fallback placement...` were unconditional. Greedy placement
 *    runs once per candidate inside the optimizer's search - up to 200 times a
 *    click - and on a crowded board most candidates degrade, so one press of
 *    Optimize could write hundreds of warnings about arrangements nobody was
 *    shown. The fact is not lost: it is returned as `degraded`, and reaches
 *    the user as `placementDegraded` in the summary.
 *
 * 2. REASSIGN `console.warn`. To keep a dry run quiet it swapped the global
 *    for a no-op and put it back in a `finally`.
 *
 * Both are now behind the debug flag and a local switch. This file was run
 * against the old placer first; both tests fail there - the first with
 * `expected "warn" to not be called at all, but actually been called 1160
 * times`, for one Optimize, and the second counting 2 assignments (the swap
 * and the restore), which is also what shows the fixture reaches the dry run.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Board, Pedal, PlacedPedal } from '@/types';
import { calculateOptimalLayoutJoint, calculateGreedyPlacementWithDiagnostics } from '../index';

function pedal(id: string, widthInches: number, depthInches: number, category = 'overdrive'): Pedal {
  return {
    id, name: id, manufacturer: 'T', category,
    widthInches, depthInches, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

const board = (widthInches: number, depthInches: number): Board =>
  ({ id: 'b', name: 'B', widthInches, depthInches, railWidthInches: 0.6, isSystem: true } as Board);

function build(sizes: Array<[width: number, depth: number]>) {
  const byId: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  sizes.forEach(([width, depth], i) => {
    const id = `p${i}`;
    byId[id] = pedal(id, width, depth);
    placed.push({
      id, pedalId: id, pedal: byId[id], xInches: 0, yInches: 0, rotationDegrees: 0,
      chainPosition: i + 1, location: 'front_of_amp', isActive: true,
    } as unknown as PlacedPedal);
  });
  return { byId, placed };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the placer and the console', () => {
  it('writes nothing while the optimizer searches a board too crowded to place cleanly', () => {
    // Eight compacts on a 12 x 6in board: one row, room for three. Every
    // candidate degrades, and the search tries a good many of them.
    const { byId, placed } = build(Array.from({ length: 8 }, () => [2.9, 5.1] as [number, number]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = calculateOptimalLayoutJoint(placed, byId, board(12, 6));

    // The precondition: this really is the degrading case.
    expect(result.noLegalCandidate || result.placementDegraded).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never replaces console.warn, even for a dry run', () => {
    // A Classic Pro with nineteen compacts and one pedal too deep for any row,
    // late in the chain: the plain order degrades, so the placer retries with
    // the deep pedal claiming its column first - the path with the dry run.
    const sizes: Array<[number, number]> = Array.from({ length: 20 }, () => [2.87, 5.08]);
    sizes[15] = [2.87, 7.56];
    const { byId, placed } = build(sizes);

    const original = console.warn;
    let assignments = 0;
    Object.defineProperty(console, 'warn', {
      configurable: true,
      get: () => original,
      set: () => { assignments++; },
    });
    try {
      calculateGreedyPlacementWithDiagnostics(placed, byId, board(32, 16));
    } finally {
      Object.defineProperty(console, 'warn', { configurable: true, writable: true, value: original });
    }

    expect(assignments).toBe(0);
  });
});
