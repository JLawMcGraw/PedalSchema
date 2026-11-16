/**
 * Pathfinding Module
 *
 * What is left here is the small shared vocabulary of the routers: where a
 * cable stands off from a jack, and where two routed cables cross. The search
 * itself lives in ./sparse-grid.
 *
 * This file used to hold a dense A* over an 8px grid, with its own direct-line
 * and L-path shortcuts and a perimeter fallback. It was removed on 2026-11-16:
 * the grid could not pass a gap narrower than about 0.9in on boards packed at
 * 0.5in, so it took 84% of Optimize's time to draw 2 cables in 1,962 - see
 * ./sparse-grid for the measurement and what replaced it.
 *
 * All geometric types, constants, and the validation policy live in
 * ../geometry. Everything geometric routing-cost needs is re-exported for
 * convenience.
 */

import { Point, Box, STANDOFF } from '../geometry';

// Re-export the geometry types and functions used by routing-cost.
export type { Point, Box } from '../geometry';
export {
  OBSTACLE_MARGIN,
  dist,
  calculatePathLength,
} from '../geometry';

/**
 * Calculate a standoff point outside the pedal box based on which edge the
 * jack is on. Fixed distance: a standoff only needs to exit the jack before
 * the path turns; large or dynamic standoffs land inside neighboring pedals
 * at minimum spacing.
 */
export function getStandoffPoint(jackPos: Point, box: Box | null, standoff: number = STANDOFF): Point {
  if (!box) return jackPos; // No box = external connection, no standoff needed

  const tolerance = 5; // How close to edge to consider "on" that edge

  const onLeft = Math.abs(jackPos.x - box.x) < tolerance;
  const onRight = Math.abs(jackPos.x - (box.x + box.width)) < tolerance;
  const onTop = Math.abs(jackPos.y - box.y) < tolerance;
  const onBottom = Math.abs(jackPos.y - (box.y + box.height)) < tolerance;

  if (onLeft) return { x: jackPos.x - standoff, y: jackPos.y };
  if (onRight) return { x: jackPos.x + standoff, y: jackPos.y };
  if (onTop) return { x: jackPos.x, y: jackPos.y - standoff };
  if (onBottom) return { x: jackPos.x, y: jackPos.y + standoff };

  // Jack is not on an edge (shouldn't happen) - project away from center of box
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = jackPos.x - cx;
  const dy = jackPos.y - cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: jackPos.x + (dx / len) * standoff, y: jackPos.y + (dy / len) * standoff };
}

/**
 * Detect cable crossings between multiple paths
 */
export function detectCableCrossings(
  paths: Array<{ id: string; points: Point[] }>
): Array<{ cable1: string; cable2: string; point: Point }> {
  const crossings: Array<{ cable1: string; cable2: string; point: Point }> = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const path1 = paths[i];
      const path2 = paths[j];

      // Check each segment of path1 against each segment of path2
      for (let s1 = 0; s1 < path1.points.length - 1; s1++) {
        for (let s2 = 0; s2 < path2.points.length - 1; s2++) {
          const intersection = getSegmentIntersectionShared(
            path1.points[s1], path1.points[s1 + 1],
            path2.points[s2], path2.points[s2 + 1]
          );
          if (intersection) {
            crossings.push({
              cable1: path1.id,
              cable2: path2.id,
              point: intersection
            });
          }
        }
      }
    }
  }

  return crossings;
}

// Local import alias to avoid name collision with the re-export above
import { getSegmentIntersection as getSegmentIntersectionShared } from '../geometry';
