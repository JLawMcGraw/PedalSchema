/**
 * Shared Cable Routing Strategies
 *
 * This module contains the cable routing algorithms used by both:
 * - routing-cost.ts (optimizer cost function)
 * - route-cables.ts (visual rendering, via routeAllCables)
 *
 * IMPORTANT: Any changes here affect BOTH optimization and display.
 * The optimizer must predict what will actually be rendered.
 *
 * ROUTING MODEL (stub + core):
 * Every pedal cable is routed as: jack → standoff (a short STUB exiting the
 * jack perpendicular to the pedal edge) → core path → standoff → jack.
 * The CORE path treats EVERY pedal as an obstacle - including the cable's
 * own source and destination. Only the stub segments may overlap their own
 * pedal. This is what prevents cables from being drawn straight through
 * their own chassis when a jack faces away from the destination.
 *
 * Validation policy note: candidate paths are checked with the SAME policy
 * (geometry.isPathClear with stub exemptions) that final acceptance uses
 * (validateCablePath), so a strategy accepted here can never be rejected
 * afterwards for obstacle reasons.
 */

import {
  Point,
  Box,
  BoardBounds,
  STANDOFF,
  OBSTACLE_MARGIN,
  dist,
  isPathClear,
} from '../geometry';

import { findPathAStar, getStandoffPoint } from '../pathfinding';

import type { ObstacleSet } from '../obstacles';
import { getBoxForPedal } from '../obstacles';
import { validateCablePath, type ValidationResult } from './validation';

// Re-export types
export type { Point, Box, BoardBounds };

import type { Cable } from '@/types';

/**
 * How far outside the board intermediate points may go, in pixels.
 * A jack on a pedal flush against the board edge points its stub slightly
 * off-board - physically normal for real cables.
 */
const BOARD_OVERHANG = 16;

/**
 * Check if all intermediate points of a path stay within board bounds
 * (plus a small overhang allowance). Endpoints are always allowed off-board
 * (guitar/amp connections).
 */
function isPathWithinBounds(path: Point[], boardBounds: BoardBounds | null): boolean {
  if (!boardBounds || path.length < 3) return true;

  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    if (p.x < boardBounds.minX - BOARD_OVERHANG ||
        p.x > boardBounds.maxX + BOARD_OVERHANG ||
        p.y < boardBounds.minY - BOARD_OVERHANG ||
        p.y > boardBounds.maxY + BOARD_OVERHANG) {
      return false;
    }
  }
  return true;
}

/**
 * Constrain a Y coordinate to stay within board bounds
 */
function constrainY(y: number, boardBounds: BoardBounds | null, margin: number = 20): number {
  if (!boardBounds) return y;
  return Math.max(boardBounds.minY + margin, Math.min(boardBounds.maxY - margin, y));
}

/**
 * Constrain an X coordinate to stay within board bounds
 */
function constrainX(x: number, boardBounds: BoardBounds | null, margin: number = 20): number {
  if (!boardBounds) return x;
  return Math.max(boardBounds.minX + margin, Math.min(boardBounds.maxX - margin, x));
}

/**
 * Which rung of the cascade in routeCablePath produced a path.
 *
 * The cascade is ordered cheapest-sufficient-first, so this doubles as a
 * difficulty reading: a board full of `astar` and `fallback-invalid` cables
 * is a board whose placement is fighting its routing. Recorded rather than
 * inferred because "why did this cable take that shape?" is otherwise only
 * answerable by re-tracing the whole cascade by hand.
 */
export type RoutingStrategy =
  | 'facing'           // standoffs meet - the cable is just the two stubs
  | 'direct'           // straight line between standoffs (<= 80px)
  | 'l-horizontal'     // single corner, horizontal leg first
  | 'l-vertical'       // single corner, vertical leg first
  | 'channel'          // through a gap between pedal rows
  | 'above'            // over the top of every pedal
  | 'below'            // under the bottom of every pedal
  | 'safe-lane'        // a lane just outside the obstacle rows
  | 'astar'            // grid pathfinding
  | 'fallback-invalid'; // nothing worked; renderer draws this red

/**
 * Result of cable routing with validation info
 */
export interface CableRouteResult {
  /** The calculated cable path */
  path: Point[];
  /** Whether the path is valid (doesn't intersect obstacles) */
  valid: boolean;
  /** Which strategy produced the path */
  strategy: RoutingStrategy;
  /** Detailed validation result (only populated if validation failed) */
  validation?: ValidationResult;
}

/**
 * Route a cable using the ObstacleSet interface
 *
 * This is the primary interface for cable routing. It:
 * 1. Uses ObstacleSet for consistent obstacle handling
 * 2. Validates the path with the same policy used during routing
 * 3. Returns validation status so callers can show error state
 */
export function routeCableWithObstacles(
  from: Point,
  to: Point,
  obstacles: ObstacleSet,
  fromPedalId: string | null = null,
  toPedalId: string | null = null
): CableRouteResult {
  const fromBox = fromPedalId ? getBoxForPedal(fromPedalId, obstacles) : null;
  const toBox = toPedalId ? getBoxForPedal(toPedalId, obstacles) : null;
  const fromBoxIdx = fromPedalId ? obstacles.pedalIdToBox.get(fromPedalId) ?? -1 : -1;
  const toBoxIdx = toPedalId ? obstacles.pedalIdToBox.get(toPedalId) ?? -1 : -1;

  // Route the cable
  const { path, strategy } = routeCablePath(
    from,
    to,
    obstacles.boxes,
    fromBox,
    toBox,
    fromBoxIdx,
    toBoxIdx,
    obstacles.boardBounds
  );

  const validation = validateCablePath(path, obstacles, fromPedalId, toPedalId);

  return {
    path,
    valid: validation.valid,
    strategy,
    validation: validation.valid ? undefined : validation,
  };
}

/**
 * Remove consecutive duplicate points from a path
 */
function dedupePath(path: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of path) {
    const last = result[result.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) {
      result.push(p);
    }
  }
  return result;
}

/**
 * Internal routing function (stub + core model).
 *
 * Routes the CORE between the two standoff points, treating every pedal
 * (including the cable's own endpoints) as an obstacle. The stubs
 * (jack → standoff) are prepended/appended afterwards.
 */
function routeCablePath(
  from: Point,
  to: Point,
  boxes: Box[],
  fromBox: Box | null,
  toBox: Box | null,
  fromBoxIdx: number,
  toBoxIdx: number,
  boardBounds: BoardBounds | null
): { path: Point[]; strategy: RoutingStrategy } {
  const validBoxes = boxes.filter(b => b.width > 0 && b.height > 0);

  const isOffBoardEndpoint = (p: Point): boolean => {
    if (!boardBounds) return false;
    return p.x < boardBounds.minX || p.x > boardBounds.maxX ||
           p.y < boardBounds.minY || p.y > boardBounds.maxY;
  };
  const allowOffBoard = isOffBoardEndpoint(from) || isOffBoardEndpoint(to);

  // External endpoints (guitar/amp) get a stub pointing toward the board.
  // Without it, routes are free to travel vertically ALONG the amp face
  // (all amp cables sharing the same x), and those runs are anchored at
  // jacks so lane separation can never pull them apart.
  const externalStandoff = (p: Point): Point => {
    if (!boardBounds || !isOffBoardEndpoint(p)) return p;
    if (p.x < boardBounds.minX) return { x: p.x + STANDOFF, y: p.y };
    if (p.x > boardBounds.maxX) return { x: p.x - STANDOFF, y: p.y };
    if (p.y < boardBounds.minY) return { x: p.x, y: p.y + STANDOFF };
    return { x: p.x, y: p.y - STANDOFF };
  };

  // Standoff points: 10px out from the jack, perpendicular to the pedal
  // edge (or toward the board for external endpoints).
  const fromStandoff = fromBox ? getStandoffPoint(from, fromBox, STANDOFF) : externalStandoff(from);
  const toStandoff = toBox ? getStandoffPoint(to, toBox, STANDOFF) : externalStandoff(to);

  const assemble = (core: Point[]): Point[] => dedupePath([from, ...core, to]);

  // Candidate validation runs on the ASSEMBLED path with exactly the same
  // policy as final acceptance (stub exemptions + endpoint tolerance), so
  // routing and validation can never disagree.
  // Each rung tags its own result, so the label can never describe a
  // different strategy than the one that actually produced the path.
  const candidateOk = (
    core: Point[],
    strategy: RoutingStrategy
  ): { path: Point[]; strategy: RoutingStrategy } | null => {
    const full = assemble(core);
    if (!isPathClear(full, boxes, { fromBoxIdx, toBoxIdx })) return null;
    if (!allowOffBoard && !isPathWithinBounds(full, boardBounds)) return null;
    return { path: full, strategy };
  };

  const s = fromStandoff;
  const t = toStandoff;

  // Facing jacks (e.g., adjacent pedals at minimum spacing): the standoffs
  // meet in the middle - the cable is just the two stubs.
  if (dist(s, t) < 1) {
    const facing = candidateOk([s], 'facing');
    if (facing) return facing;
  }

  // Strategy 1: Direct line between standoffs (for very close jacks)
  if (dist(s, t) <= 80) {
    const direct = candidateOk([s, t], 'direct');
    if (direct) return direct;
  }

  // Strategy 2: Simple L-paths between standoffs
  const lH = candidateOk([s, { x: t.x, y: s.y }, t], 'l-horizontal');
  if (lH) return lH;

  const lV = candidateOk([s, { x: s.x, y: t.y }, t], 'l-vertical');
  if (lV) return lV;

  if (validBoxes.length > 0) {
    // Strategy 3: Route through channel between pedal rows
    const yRanges = validBoxes.map(b => ({ top: b.y, bottom: b.y + b.height }));
    yRanges.sort((a, b) => a.top - b.top);

    for (let i = 0; i < yRanges.length - 1; i++) {
      const gap = yRanges[i + 1].top - yRanges[i].bottom;
      if (gap > OBSTACLE_MARGIN * 2) {
        const channelY = constrainY(yRanges[i].bottom + gap / 2, boardBounds);
        const channel = candidateOk([s, { x: s.x, y: channelY }, { x: t.x, y: channelY }, t], 'channel');
        if (channel) return channel;
      }
    }

    // Strategy 4: Route above all pedals (but stay within board bounds)
    const minY = Math.min(...yRanges.map(r => r.top));
    const aboveY = constrainY(Math.max(10, minY - STANDOFF * 2), boardBounds, 10);
    const above = candidateOk([s, { x: s.x, y: aboveY }, { x: t.x, y: aboveY }, t], 'above');
    if (above) return above;

    // Strategy 5: Route below all pedals (but stay within board bounds)
    const maxY = Math.max(...yRanges.map(r => r.bottom));
    const belowY = constrainY(maxY + STANDOFF * 2, boardBounds, 10);
    const below = candidateOk([s, { x: s.x, y: belowY }, { x: t.x, y: belowY }, t], 'below');
    if (below) return below;

    // Strategy 6: Safe horizontal lane just outside the obstacle rows,
    // reached vertically from each standoff (helps external connections)
    const safeAboveY = constrainY(minY - OBSTACLE_MARGIN - 10, boardBounds, 10);
    const safeBelowY = constrainY(maxY + OBSTACLE_MARGIN + 10, boardBounds, 10);
    for (const laneY of [safeAboveY, safeBelowY]) {
      const lane = candidateOk([s, { x: s.x, y: laneY }, { x: t.x, y: laneY }, t], 'safe-lane');
      if (lane) return lane;
    }
  }

  // Strategy 7: A* pathfinding between standoffs with board bounds.
  // No exclusions: standoffs sit outside every pedal's margin zone.
  const astarPath = findPathAStar(s, t, boxes, -1, -1, boardBounds ?? undefined);
  if (astarPath.length > 0) {
    const astar = candidateOk(astarPath, 'astar');
    if (astar) return astar;
  }

  // Fallback: return invalid direct path (will be marked red by renderer)
  return {
    path: dedupePath([from, fromStandoff, toStandoff, to]),
    strategy: 'fallback-invalid',
  };
}
