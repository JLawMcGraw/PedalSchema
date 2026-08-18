/**
 * A degraded placement says so.
 *
 * `placementDegraded` has existed inside calculateGreedyPlacement since the
 * retry loop was written, and never left the function. So a layout salvaged by
 * "put it anywhere on the board" was indistinguishable, to every caller, from
 * one that honoured the row and clearance rules. findValidPositionInZone makes
 * that worse: two of its returns do no validity check at all - the narrow-zone
 * bail and the terminal "truly full board" clamp - and its return type is
 * non-nullable, so callers have no failure branch either.
 *
 * The fix is to report honestly, not to fail differently. Returning null was
 * tried before and turns a wrong answer into no answer.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateGreedyPlacement,
  calculateGreedyPlacementWithDiagnostics,
  calculateOptimalLayoutJoint,
} from '../index';
import { detectCollisions } from '../../collision';
import type { Board, Pedal, PlacedPedal } from '@/types';

function pedal(id: string, w = 2.9, d = 5.1): Pedal {
  return {
    id, name: id, manufacturer: 'T', category: 'overdrive',
    widthInches: w, depthInches: d, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

function boardOf(w: number, d: number): Board {
  return {
    id: 'b', name: 'B', widthInches: w, depthInches: d,
    railWidthInches: 0.6, isSystem: true,
  } as Board;
}

function place(n: number): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const byId: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    byId[id] = pedal(id);
    placed.push({
      id, pedalId: id, xInches: 0, yInches: 0, rotationDegrees: 0,
      chainPosition: i + 1, location: 'front_of_amp', isActive: true,
      pedal: byId[id],
    } as unknown as PlacedPedal);
  }
  return { placed, byId };
}

/**
 * Do any two placed pedals share space? Uses the engine's own collision
 * detector rather than a local box test, so "overlap" means here exactly what
 * it means to the guard being asserted.
 */
function hasOverlap(
  placements: Array<{ id: string; x: number; y: number }>,
  placed: PlacedPedal[],
  byId: Record<string, Pedal>
): boolean {
  const moved = placed.map((p) => {
    const at = placements.find((q) => q.id === p.id);
    return at ? { ...p, xInches: at.x, yInches: at.y } : p;
  });
  return detectCollisions(moved, byId, boardOf(1000, 1000)).length > 0;
}

describe('placement degradation is reported', () => {
  it('a roomy board places cleanly and says so', () => {
    const { placed, byId } = place(3);
    const result = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(32, 16));

    expect(result.placements).toHaveLength(3);
    expect(result.degraded).toBe(false);
  });

  it('a board that cannot hold the pedals reports degraded', () => {
    // Far more pedal than board: the placer must fall back rather than
    // honour its rows.
    const { placed, byId } = place(14);
    const result = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(12, 6));

    expect(result.placements).toHaveLength(14);
    expect(
      result.degraded,
      'the placer cannot have honoured its rules on a board this size'
    ).toBe(true);
  });

  it('the plain call still returns bare placements', () => {
    // 15 existing call sites depend on this shape.
    const { placed, byId } = place(3);
    const plain = calculateGreedyPlacement(placed, byId, boardOf(32, 16));
    const rich = calculateGreedyPlacementWithDiagnostics(placed, byId, boardOf(32, 16));

    expect(Array.isArray(plain)).toBe(true);
    expect(plain).toEqual(rich.placements);
  });

  it('the optimizer surfaces the winning layout\'s flag, not any candidate\'s', () => {
    const { placed, byId } = place(3);
    const clean = calculateOptimalLayoutJoint(placed, byId, boardOf(32, 16));
    expect(clean.placementDegraded).toBe(false);

    const cramped = place(8);
    const result = calculateOptimalLayoutJoint(cramped.placed, cramped.byId, boardOf(12, 6));
    // Either nothing legal was found, or something was found by giving up on
    // the rules. Both are honest; being silent about both was not.
    expect(result.noLegalCandidate || result.placementDegraded).toBe(true);
  });
});

describe('an overlapping layout is never preferred to a legal one', () => {
  /*
   * The muddy half of calculateGreedyPlacement's contract: on a board that is
   * genuinely too full it CLAMPS a pedal on-board rather than dropping it, so
   * it can hand back placements that overlap. That was the deliberate choice -
   * returning null was tried and turns a wrong answer into no answer - and it
   * is safe only because calculateOptimalLayoutJoint scores any colliding
   * candidate Infinity and keeps the user's board instead.
   *
   * "Safe only because of a guard" is worth an assertion rather than a
   * comment. The guard's own comment records the measurement that motivated
   * it - a legal 8-pedal layout at 2478.5 replaced by an overlapping one at
   * 1301.6, because the routing cost has no overlap term and stacked pedals
   * have wonderfully short cables - which is exactly why the cheaper-looking
   * wrong answer would win if this stopped holding.
   */
  it('the greedy placer really does overlap on a board this size', () => {
    // The precondition. If the placer ever stops overlapping here, the test
    // below proves nothing and should be given a tighter board.
    const { placed, byId } = place(14);
    const placements = calculateGreedyPlacement(placed, byId, boardOf(12, 6));
    expect(
      hasOverlap(placements, placed, byId),
      'fixture is not tight enough to make the placer overlap - the guard test would be vacuous'
    ).toBe(true);
  });

  it('the optimizer keeps the user\'s board rather than a different broken one', () => {
    // NOT "the result never overlaps" - that was asserted first and it fails,
    // correctly. On a board this size nothing legal exists, so the baseline
    // overlaps too, and the documented rule is that when BOTH candidates are
    // illegal the user's board wins. An app that cannot fit your pedals should
    // leave them where you put them and say so, not shuffle them into a
    // different impossible arrangement.
    const { placed, byId } = place(14);
    const result = calculateOptimalLayoutJoint(placed, byId, boardOf(12, 6));

    const before = placed.map((p) => `${p.id}@${p.xInches},${p.yInches}`).join(' ');
    const after = result.placements
      .map((q) => `${q.id}@${q.x},${q.y}`)
      .sort((a, b) => a.localeCompare(b))
      .join(' ');
    const beforeSorted = before.split(' ').sort((a, b) => a.localeCompare(b)).join(' ');
    expect(after).toBe(beforeSorted);
  });

  it('a legal baseline is never traded for a colliding layout', () => {
    // The guard that matters in practice: the routing cost has no overlap
    // term, so a pile of stacked pedals scores wonderfully short cables. The
    // measurement on the guard itself records a legal 8-pedal layout at 2478.5
    // being replaced by an overlapping one at 1301.6 before it existed.
    const { placed, byId } = place(6);
    const board = boardOf(32, 16);
    const legal = calculateOptimalLayoutJoint(placed, byId, board);
    expect(
      hasOverlap(legal.placements, placed, byId),
      'this board has room, so the optimizer must produce a legal layout'
    ).toBe(false);
  });
});
