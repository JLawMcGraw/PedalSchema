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
import { routeCablesWithLanes, type LaneRouteRequest } from '../lanes';

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
  scale: number,
  movable?: Set<number>
): void {
  const minX = -LANE_BOARD_OVERHANG;
  const maxX = board.widthInches * scale + LANE_BOARD_OVERHANG;
  const minY = -LANE_BOARD_OVERHANG;
  const maxY = board.depthInches * scale + LANE_BOARD_OVERHANG;

  interface OwnedRun extends LaneSegment { cable: number }

  const collectRuns = (excludeCable: number): OwnedRun[] => {
    const runs: OwnedRun[] = [];
    results.forEach((rc, ci) => {
      if (ci === excludeCable) return;
      for (let i = 0; i < rc.path.length - 1; i++) {
        const seg = toLaneSegment(rc.path[i], rc.path[i + 1]);
        if (seg) runs.push({ ...seg, cable: ci });
      }
    });
    return runs;
  };

  const overlapping = (runs: OwnedRun[], seg: LaneSegment): OwnedRun[] =>
    runs.filter(
      (r) =>
        r.horizontal === seg.horizontal &&
        Math.min(r.hi, seg.hi) - Math.max(r.lo, seg.lo) > MIN_PARALLEL_OVERLAP
    );

  const separationAt = (others: OwnedRun[], fixed: number): number =>
    others.reduce((sep, r) => Math.min(sep, Math.abs(r.fixed - fixed)), Infinity);

  const inBounds = (seg: LaneSegment, fixed: number): boolean =>
    seg.horizontal ? fixed >= minY && fixed <= maxY : fixed >= minX && fixed <= maxX;

  const shifted = (base: Point[], i: number, horizontal: boolean, fixed: number): Point[] => {
    const candidate = base.map((p) => ({ ...p }));
    if (horizontal) {
      candidate[i].y = fixed;
      candidate[i + 1].y = fixed;
    } else {
      candidate[i].x = fixed;
      candidate[i + 1].x = fixed;
    }
    return candidate;
  };

  /**
   * Improve one cable's lane assignment against all other cables' runs.
   * Returns true if the path changed.
   */
  const improveCable = (ci: number): boolean => {
    const rc = results[ci];
    if (!rc.valid) return false;
    if (movable && !movable.has(ci)) return false;
    const others = collectRuns(ci);
    let path = rc.path;
    let moved = false;

    // Only middle segments are lane-shiftable (never the jack stubs:
    // segments 0 and path.length-2)
    for (let i = 1; i < path.length - 2; i++) {
      const seg = toLaneSegment(path[i], path[i + 1]);
      if (!seg) continue;
      const conflicting = overlapping(others, seg);
      if (conflicting.length === 0) continue;
      const currentSep = separationAt(conflicting, seg.fixed);
      if (currentSep >= LANE_TOLERANCE) continue;

      // Preferred: whole-lane jumps to a clear lane
      let resolved = false;
      for (const delta of [1, -1, 2, -2, 3, -3].map((k) => k * LANE_SPACING)) {
        const fixed = seg.fixed + delta;
        if (!inBounds(seg, fixed)) continue;
        if (separationAt(conflicting, fixed) < LANE_TOLERANCE) continue;
        const candidate = shifted(path, i, seg.horizontal, fixed);
        if (!isPathValid(candidate, obstacles, rc.cable.fromPedalId, rc.cable.toPedalId)) continue;
        path = candidate;
        moved = true;
        resolved = true;
        break;
      }

      // Fallback for narrow corridors: fine-scan for the position that
      // MAXIMIZES separation from the other cables' runs
      if (!resolved) {
        let bestFixed: number | null = null;
        let bestSep = currentSep;
        for (let delta = -3 * LANE_SPACING; delta <= 3 * LANE_SPACING; delta += 1) {
          const fixed = seg.fixed + delta;
          if (!inBounds(seg, fixed)) continue;
          const sep = separationAt(conflicting, fixed);
          if (sep <= bestSep) continue;
          const candidate = shifted(path, i, seg.horizontal, fixed);
          if (!isPathValid(candidate, obstacles, rc.cable.fromPedalId, rc.cable.toPedalId)) continue;
          bestFixed = fixed;
          bestSep = sep;
        }
        if (bestFixed !== null) {
          path = shifted(path, i, seg.horizontal, bestFixed);
          moved = true;
        }
      }
    }

    rc.path = path;
    return moved;
  };

  // Initial pass (each cable against all others), then relaxation sweeps:
  // later cables' placements open better lanes for earlier ones, so
  // re-visiting converges tight bundles onto separated lanes.
  const MAX_SWEEPS = 3;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let changed = false;
    for (let ci = 0; ci < results.length; ci++) {
      if (improveCable(ci)) changed = true;
    }
    if (!changed) break;
  }
}

/**
 * Route every cable for the current configuration.
 */
/**
 * When true, cables route through the Manhattan corridor graph
 * (src/lib/engine/lanes) with the strategy router as per-cable fallback.
 */
export const USE_LANE_ROUTER = true;

export function routeAllCables(
  cables: Cable[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number,
  useEffectsLoop: boolean,
  options?: { laneRouter?: boolean }
): RoutedCable[] {
  const laneRouter = options?.laneRouter ?? USE_LANE_ROUTER;
  const obstacles = generateObstacles(placedPedals, pedalsById, board, scale);
  const placedById = new Map(placedPedals.map((p) => [p.id, p]));

  interface Resolved { cable: Cable; fromPos: Point; toPos: Point }
  const resolved: Resolved[] = [];
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
    resolved.push({ cable, fromPos, toPos });
  }

  // Corridor-graph routing first (when enabled); nulls fall back below
  let lanePaths: Array<Point[] | null> = resolved.map(() => null);
  if (laneRouter) {
    const requests: LaneRouteRequest[] = resolved.map((r) => ({
      from: r.fromPos,
      to: r.toPos,
      fromPedalId: r.cable.fromPedalId ?? null,
      toPedalId: r.cable.toPedalId ?? null,
    }));
    lanePaths = routeCablesWithLanes(requests, obstacles).paths;
  }

  const results: RoutedCable[] = [];
  const fallbackIndices = new Set<number>();

  resolved.forEach((r, index) => {
    const lanePath = lanePaths[index];
    if (lanePath) {
      results.push({
        cable: r.cable,
        path: lanePath,
        valid: true,
        fromPos: r.fromPos,
        toPos: r.toPos,
      });
      return;
    }

    const result = routeCableWithObstacles(
      r.fromPos,
      r.toPos,
      obstacles,
      r.cable.fromPedalId ?? null,
      r.cable.toPedalId ?? null
    );
    fallbackIndices.add(results.length);
    results.push({
      cable: r.cable,
      path: result.path,
      valid: result.valid,
      fromPos: r.fromPos,
      toPos: r.toPos,
      validation: result.validation,
    });
  });

  // Spread overlapping parallel runs into adjacent lanes. Lane-routed
  // cables have coordinated lanes already and stay fixed; only fallback
  // cables shift around them.
  separateParallelRuns(results, obstacles, board, scale, laneRouter ? fallbackIndices : undefined);

  if (DEBUG_PATHS) {
    for (const rc of results) {
      const label = `${rc.cable.fromType}${rc.cable.fromPedalId ? `:${rc.cable.fromPedalId.slice(0, 6)}` : ''} → ${rc.cable.toType}${rc.cable.toPedalId ? `:${rc.cable.toPedalId.slice(0, 6)}` : ''}`;
      console.log(`[PATH] ${label} (${rc.path.length}pts, valid:${rc.valid}): ${rc.path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ')}`);
    }
  }

  return results;
}
