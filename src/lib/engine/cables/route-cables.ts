/**
 * Central Cable Routing
 *
 * Routes ALL cables for a configuration in one pass:
 * - Builds the obstacle set once
 * - Resolves every endpoint through the shared endpoints module
 * - Routes each cable through the shared strategy pipeline
 * - Separates parallel cable runs into distinct lanes so overlapping
 *   cables remain individually traceable
 *
 * The canvas memoizes one call to routeAllCables per state change instead of
 * re-routing every cable on every render. The result is plain data, so the
 * renderer component can stay purely presentational.
 */

import type { Board, Cable, Pedal, PlacedPedal } from '@/types';
import type { Point } from '../geometry';
import { generateObstacles, type ObstacleSet } from '../obstacles';
import { routeCableWithObstacles } from './routing-strategies';
import { getExternalEndpointPx, getPedalJackPx, type ExternalEndpointType } from './endpoints';
import { isPathValid, type ValidationResult } from './validation';

export interface RoutedCable {
  cable: Cable;
  /** Routed polyline in pixels */
  path: Point[];
  /** Whether the path clears all obstacles */
  valid: boolean;
  /** Resolved endpoint positions in pixels */
  fromPos: Point;
  toPos: Point;
  /** Populated only when invalid */
  validation?: ValidationResult;
}

const DEBUG_PATHS = typeof window !== 'undefined' && window.location?.search?.includes('debug=cables');

/**
 * Resolve a cable endpoint (external or pedal jack) to pixel coordinates.
 * Returns null when the referenced pedal no longer exists.
 */
function resolveEndpoint(
  type: string,
  pedalId: string | null,
  jackType: string | null,
  placedById: Map<string, PlacedPedal>,
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number,
  useEffectsLoop: boolean
): Point | null {
  if (type !== 'pedal') {
    return getExternalEndpointPx(type as ExternalEndpointType, board, scale, useEffectsLoop);
  }

  if (!pedalId) return null;
  const placed = placedById.get(pedalId);
  if (!placed) return null;

  const pedal = pedalsById[placed.pedalId] || placed.pedal;
  if (!pedal) return null;

  return getPedalJackPx(placed, pedal, jackType || 'input', scale);
}

// ---------------------------------------------------------------------------
// Lane separation
//
// Different cables often route through the same corridor (channel midpoints,
// above/below lanes), landing on EXACTLY the same line - visually
// indistinguishable. This pass nudges later cables' overlapping runs onto
// adjacent lanes, re-validating every shift against the shared policy.
// ---------------------------------------------------------------------------

/**
 * Distance between adjacent cable lanes, in pixels.
 * A rendered cable is ~8px wide (3px stroke inside a 5px shadow), so lanes
 * must be wider than that to read as separate lines.
 */
const LANE_SPACING = 12;
/** Runs closer than this (perpendicular) count as overlapping */
const LANE_TOLERANCE = 10;
/** Minimum shared run length that counts as an overlap */
const MIN_PARALLEL_OVERLAP = 12;
/**
 * How far outside the board a shifted run may go. Generous enough to cover
 * the amp/guitar area (endpoints sit 60px off-board) so their approach runs
 * can be laned apart too.
 */
const LANE_BOARD_OVERHANG = 70;

interface LaneSegment {
  horizontal: boolean;
  /** The shared coordinate (y for horizontal runs, x for vertical) */
  fixed: number;
  lo: number;
  hi: number;
}

function toLaneSegment(a: Point, b: Point): LaneSegment | null {
  if (Math.abs(a.y - b.y) < 0.5) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi - lo >= MIN_PARALLEL_OVERLAP ? { horizontal: true, fixed: a.y, lo, hi } : null;
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi - lo >= MIN_PARALLEL_OVERLAP ? { horizontal: false, fixed: a.x, lo, hi } : null;
  }
  return null; // diagonal (rare) - not lane-managed
}

function separateParallelRuns(
  results: RoutedCable[],
  obstacles: ObstacleSet,
  board: Board,
  scale: number
): void {
  const registered: LaneSegment[] = [];
  const minX = -LANE_BOARD_OVERHANG;
  const maxX = board.widthInches * scale + LANE_BOARD_OVERHANG;
  const minY = -LANE_BOARD_OVERHANG;
  const maxY = board.depthInches * scale + LANE_BOARD_OVERHANG;

  const conflictsAt = (seg: LaneSegment, fixed: number): boolean =>
    registered.some(
      (r) =>
        r.horizontal === seg.horizontal &&
        Math.abs(r.fixed - fixed) < LANE_TOLERANCE &&
        Math.min(r.hi, seg.hi) - Math.max(r.lo, seg.lo) > MIN_PARALLEL_OVERLAP
    );

  for (const rc of results) {
    if (rc.valid) {
      let path = rc.path;

      // Only middle segments are lane-shiftable (never the jack stubs:
      // segments 0 and path.length-2)
      for (let i = 1; i < path.length - 2; i++) {
        const seg = toLaneSegment(path[i], path[i + 1]);
        if (!seg || !conflictsAt(seg, seg.fixed)) continue;

        for (const delta of [1, -1, 2, -2, 3, -3].map((k) => k * LANE_SPACING)) {
          const fixed = seg.fixed + delta;
          if (conflictsAt(seg, fixed)) continue;

          // Only the PERPENDICULAR coordinate moves; bound just that axis
          // (the run may legitimately extend off-board toward guitar/amp)
          if (seg.horizontal ? (fixed < minY || fixed > maxY) : (fixed < minX || fixed > maxX)) continue;

          const candidate = path.map((p) => ({ ...p }));
          if (seg.horizontal) {
            candidate[i].y = fixed;
            candidate[i + 1].y = fixed;
          } else {
            candidate[i].x = fixed;
            candidate[i + 1].x = fixed;
          }

          if (!isPathValid(candidate, obstacles, rc.cable.fromPedalId, rc.cable.toPedalId)) continue;

          path = candidate;
          break;
        }
      }

      rc.path = path;
    }

    // Register ALL of this cable's runs (shifted or not) so later cables
    // avoid them - including endpoint segments, which are unshiftable
    // themselves (anchored at a jack or the amp) but are still physical
    // cable runs others must dodge. Short stubs fall below
    // MIN_PARALLEL_OVERLAP and register nothing.
    for (let i = 0; i < rc.path.length - 1; i++) {
      const seg = toLaneSegment(rc.path[i], rc.path[i + 1]);
      if (seg) registered.push(seg);
    }
  }
}

/**
 * Route every cable for the current configuration.
 */
export function routeAllCables(
  cables: Cable[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number,
  useEffectsLoop: boolean
): RoutedCable[] {
  const obstacles = generateObstacles(placedPedals, pedalsById, board, scale);
  const placedById = new Map(placedPedals.map((p) => [p.id, p]));

  const results: RoutedCable[] = [];

  for (const cable of cables) {
    const fromPos = resolveEndpoint(
      cable.fromType, cable.fromPedalId, cable.fromJack,
      placedById, pedalsById, board, scale, useEffectsLoop
    );
    const toPos = resolveEndpoint(
      cable.toType, cable.toPedalId, cable.toJack,
      placedById, pedalsById, board, scale, useEffectsLoop
    );
    if (!fromPos || !toPos) continue;

    const result = routeCableWithObstacles(
      fromPos,
      toPos,
      obstacles,
      cable.fromPedalId ?? null,
      cable.toPedalId ?? null
    );

    results.push({
      cable,
      path: result.path,
      valid: result.valid,
      fromPos,
      toPos,
      validation: result.validation,
    });
  }

  // Spread overlapping parallel runs into adjacent lanes
  separateParallelRuns(results, obstacles, board, scale);

  if (DEBUG_PATHS) {
    for (const rc of results) {
      const label = `${rc.cable.fromType}${rc.cable.fromPedalId ? `:${rc.cable.fromPedalId.slice(0, 6)}` : ''} → ${rc.cable.toType}${rc.cable.toPedalId ? `:${rc.cable.toPedalId.slice(0, 6)}` : ''}`;
      console.log(`[PATH] ${label} (${rc.path.length}pts, valid:${rc.valid}): ${rc.path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ')}`);
    }
  }

  return results;
}
