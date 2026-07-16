/**
 * A* Pathfinding Module
 *
 * Provides grid-based A* pathfinding for cable routing with obstacle avoidance.
 *
 * All geometric types, constants, and the validation policy live in
 * ../geometry — this module only owns the grid search and path
 * simplification. Everything geometric is re-exported for convenience.
 */

import {
  Point,
  Box,
  OBSTACLE_MARGIN,
  GRID_CELL_SIZE,
  isPathClear,
  lineIntersectsBox,
} from '../geometry';

// Re-export the shared geometry API so existing importers keep working
export type { Point, Box, BoardBounds } from '../geometry';
export {
  OBSTACLE_MARGIN,
  ENDPOINT_TOLERANCE,
  STANDOFF,
  GRID_CELL_SIZE,
  dist,
  calculatePathLength,
  lineIntersectsBox,
  segmentsIntersect,
  getSegmentIntersection,
  isPathClear,
  findPathViolations,
} from '../geometry';

import type { BoardBounds } from '../geometry';
import { STANDOFF } from '../geometry';

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

// ============================================================================
// GRID-BASED A* PATHFINDING
// ============================================================================

interface GridCell {
  x: number;
  y: number;
}

interface AStarNode {
  cell: GridCell;
  g: number; // Cost from start
  h: number; // Heuristic cost to end
  f: number; // Total cost (g + h)
  parent: AStarNode | null;
}

// Convert pixel coordinates to grid cell
function pixelToGrid(px: number, py: number): GridCell {
  return {
    x: Math.floor(px / GRID_CELL_SIZE),
    y: Math.floor(py / GRID_CELL_SIZE)
  };
}

// Convert grid cell to pixel coordinates (center of cell)
function gridToPixel(cell: GridCell): Point {
  return {
    x: cell.x * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: cell.y * GRID_CELL_SIZE + GRID_CELL_SIZE / 2
  };
}

// Create a grid key for Map storage
function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

// Manhattan distance heuristic (for 4-directional movement)
function manhattanDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Build blocked cell set from boxes with margin
function buildBlockedCells(
  boxes: Box[],
  excludeIndices: Set<number>
): Set<string> {
  const blocked = new Set<string>();

  for (let i = 0; i < boxes.length; i++) {
    if (excludeIndices.has(i)) continue;

    const box = boxes[i];
    // Convert box bounds to grid cells with margin
    const minCellX = Math.floor((box.x - OBSTACLE_MARGIN) / GRID_CELL_SIZE);
    const maxCellX = Math.ceil((box.x + box.width + OBSTACLE_MARGIN) / GRID_CELL_SIZE);
    const minCellY = Math.floor((box.y - OBSTACLE_MARGIN) / GRID_CELL_SIZE);
    const maxCellY = Math.ceil((box.y + box.height + OBSTACLE_MARGIN) / GRID_CELL_SIZE);

    // Mark all cells in the expanded box as blocked
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        blocked.add(cellKey({ x: cx, y: cy }));
      }
    }
  }

  return blocked;
}

// 4-directional neighbors (orthogonal movement only)
const DIRECTIONS: GridCell[] = [
  { x: 0, y: -1 },  // Up
  { x: 1, y: 0 },   // Right
  { x: 0, y: 1 },   // Down
  { x: -1, y: 0 },  // Left
];

// Find nearest unblocked cell to a given cell
function findNearestUnblockedCell(
  target: GridCell,
  blocked: Set<string>,
  gridBounds: { minX: number; maxX: number; minY: number; maxY: number }
): GridCell {
  if (!blocked.has(cellKey(target))) {
    return target;
  }

  // BFS to find nearest unblocked cell
  const queue: GridCell[] = [target];
  const visited = new Set<string>();
  visited.add(cellKey(target));

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of DIRECTIONS) {
      const neighbor: GridCell = {
        x: current.x + dir.x,
        y: current.y + dir.y
      };
      const key = cellKey(neighbor);

      if (visited.has(key)) continue;
      if (neighbor.x < gridBounds.minX || neighbor.x > gridBounds.maxX ||
          neighbor.y < gridBounds.minY || neighbor.y > gridBounds.maxY) {
        continue;
      }

      visited.add(key);

      if (!blocked.has(key)) {
        return neighbor;
      }

      queue.push(neighbor);
    }
  }

  return target; // Fallback to original if nothing found
}

// A* pathfinding algorithm
function aStarSearch(
  startPixel: Point,
  endPixel: Point,
  blocked: Set<string>,
  gridBounds: { minX: number; maxX: number; minY: number; maxY: number }
): GridCell[] | null {
  let start = pixelToGrid(startPixel.x, startPixel.y);
  let end = pixelToGrid(endPixel.x, endPixel.y);

  // If start or end is blocked, find nearest unblocked cell
  start = findNearestUnblockedCell(start, blocked, gridBounds);
  end = findNearestUnblockedCell(end, blocked, gridBounds);

  // If start equals end, return direct path
  if (start.x === end.x && start.y === end.y) {
    return [start];
  }

  const openSet: AStarNode[] = [];
  const closedSet = new Set<string>();
  const gScores = new Map<string, number>();

  const startNode: AStarNode = {
    cell: start,
    g: 0,
    h: manhattanDistance(start, end),
    f: manhattanDistance(start, end),
    parent: null
  };

  openSet.push(startNode);
  gScores.set(cellKey(start), 0);

  let iterations = 0;
  const maxIterations = 10000; // Safety limit

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f score
    let lowestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[lowestIdx].f) {
        lowestIdx = i;
      }
    }

    const current = openSet[lowestIdx];

    // Check if we reached the goal
    if (current.cell.x === end.x && current.cell.y === end.y) {
      // Reconstruct path
      const path: GridCell[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift(node.cell);
        node = node.parent;
      }
      return path;
    }

    // Move current from open to closed
    openSet.splice(lowestIdx, 1);
    closedSet.add(cellKey(current.cell));

    // Check all neighbors
    for (const dir of DIRECTIONS) {
      const neighbor: GridCell = {
        x: current.cell.x + dir.x,
        y: current.cell.y + dir.y
      };

      const neighborKey = cellKey(neighbor);

      // Skip if out of bounds
      if (neighbor.x < gridBounds.minX || neighbor.x > gridBounds.maxX ||
          neighbor.y < gridBounds.minY || neighbor.y > gridBounds.maxY) {
        continue;
      }

      // Skip if in closed set
      if (closedSet.has(neighborKey)) {
        continue;
      }

      // Skip if blocked (unless it's the end cell)
      if (blocked.has(neighborKey) && !(neighbor.x === end.x && neighbor.y === end.y)) {
        continue;
      }

      const tentativeG = current.g + 1; // Cost of 1 per orthogonal move

      const existingG = gScores.get(neighborKey);
      if (existingG !== undefined && tentativeG >= existingG) {
        continue; // Not a better path
      }

      // This is a better path
      gScores.set(neighborKey, tentativeG);

      const h = manhattanDistance(neighbor, end);
      const neighborNode: AStarNode = {
        cell: neighbor,
        g: tentativeG,
        h: h,
        f: tentativeG + h,
        parent: current
      };

      // Add to open set if not already there
      const existingIdx = openSet.findIndex(n =>
        n.cell.x === neighbor.x && n.cell.y === neighbor.y
      );
      if (existingIdx >= 0) {
        openSet[existingIdx] = neighborNode;
      } else {
        openSet.push(neighborNode);
      }
    }
  }

  // No path found
  return null;
}

/**
 * Simplify path by removing redundant points on same line
 */
export function simplifyPath(path: Point[]): Point[] {
  if (path.length <= 2) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Check if curr is on the line between prev and next
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // If direction changes, keep this point
    const sameDirection = (dx1 === 0 && dx2 === 0) || (dy1 === 0 && dy2 === 0);
    if (!sameDirection) {
      result.push(curr);
    }
  }

  result.push(path[path.length - 1]);
  return result;
}

/**
 * Simplify path by removing only collinear points, validate every removal
 */
export function simplifyPathValidated(path: Point[], boxes: Box[], excludeSet: Set<number>): Point[] {
  if (path.length <= 2) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Check if points are collinear (on same horizontal or vertical line)
    const prevToCurrHorizontal = Math.abs(prev.y - curr.y) < 1;
    const currToNextHorizontal = Math.abs(curr.y - next.y) < 1;
    const prevToCurrVertical = Math.abs(prev.x - curr.x) < 1;
    const currToNextVertical = Math.abs(curr.x - next.x) < 1;

    const collinear = (prevToCurrHorizontal && currToNextHorizontal) ||
                      (prevToCurrVertical && currToNextVertical);

    if (collinear) {
      // Can potentially skip this point, but validate the direct path is clear
      if (isDirectPathClear(prev, next, boxes, excludeSet)) {
        continue; // Skip this point
      }
    }

    // Keep this point
    result.push(curr);
  }

  result.push(path[path.length - 1]);
  return result;
}

/**
 * Main pathfinding function - uses A* with fallback strategies
 *
 * @param start - Start point in pixels
 * @param end - End point in pixels
 * @param boxes - Array of obstacle boxes
 * @param fromBoxIdx - Index of source pedal box (will be excluded from obstacles)
 * @param toBoxIdx - Index of destination pedal box (will be excluded from obstacles)
 * @param boardBounds - Optional board bounds to constrain routing (cables stay on board)
 */
export function findPathAStar(
  start: Point,
  end: Point,
  boxes: Box[],
  fromBoxIdx: number = -1,
  toBoxIdx: number = -1,
  boardBounds?: BoardBounds
): Point[] {
  // Exclude ONLY source and destination pedals. With source/dest excluded the
  // grid search can start from the actual jack position instead of being
  // BFS-relocated out of its own pedal's blocked cells.
  const excludeSet = new Set<number>();
  if (fromBoxIdx >= 0) excludeSet.add(fromBoxIdx);
  if (toBoxIdx >= 0) excludeSet.add(toBoxIdx);

  // STRATEGY 1: Check for direct line path (fastest)
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const distance = Math.sqrt(dx * dx + dy * dy);

  const obstacleCount = boxes.filter((_, i) => !excludeSet.has(i)).length;
  const hasObstacles = obstacleCount > 0;

  const isVeryShort = distance < 40;
  const isHorizontal = dy < 15 && dx > dy;
  const isVertical = dx < 15 && dy > dx;

  if ((isVeryShort || (!hasObstacles && (isHorizontal || isVertical))) &&
      isDirectPathClear(start, end, boxes, excludeSet)) {
    return [start, end];
  }

  // STRATEGY 2: Simple L-shaped paths for short distances
  const maxLPathDistance = hasObstacles ? 80 : 150;

  if (distance < maxLPathDistance) {
    const midH = { x: end.x, y: start.y };
    const midV = { x: start.x, y: end.y };

    const isCornerSafe = (corner: Point): boolean => {
      return !isPointInAnyBox(corner, boxes, excludeSet, OBSTACLE_MARGIN);
    };

    if (isCornerSafe(midH) &&
        isDirectPathClear(start, midH, boxes, excludeSet) &&
        isDirectPathClear(midH, end, boxes, excludeSet)) {
      return [start, midH, end];
    }

    if (isCornerSafe(midV) &&
        isDirectPathClear(start, midV, boxes, excludeSet) &&
        isDirectPathClear(midV, end, boxes, excludeSet)) {
      return [start, midV, end];
    }
  }

  // STRATEGY 3: Full A* pathfinding
  // Calculate grid bounds with padding
  let minX = Math.min(start.x, end.x);
  let maxX = Math.max(start.x, end.x);
  let minY = Math.min(start.y, end.y);
  let maxY = Math.max(start.y, end.y);

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  }

  // Add padding for routing around obstacles
  const padding = 100;

  // Clamp to board bounds if provided (keep cables on the board)
  // Allow some margin outside board for routing, but not too far
  const boardPadding = 50;
  if (boardBounds) {
    // Clamp minX/maxX to board bounds with small padding
    // But always include start/end points (which may be off-board for guitar/amp)
    minX = Math.min(start.x, end.x, Math.max(minX, boardBounds.minX - boardPadding));
    maxX = Math.max(start.x, end.x, Math.min(maxX, boardBounds.maxX + boardPadding));
    minY = Math.min(start.y, end.y, Math.max(minY, boardBounds.minY - boardPadding));
    maxY = Math.max(start.y, end.y, Math.min(maxY, boardBounds.maxY + boardPadding));
  }

  const gridBounds = {
    minX: Math.floor((minX - padding) / GRID_CELL_SIZE),
    maxX: Math.ceil((maxX + padding) / GRID_CELL_SIZE),
    minY: Math.floor((minY - padding) / GRID_CELL_SIZE),
    maxY: Math.ceil((maxY + padding) / GRID_CELL_SIZE)
  };

  // Build blocked cells
  const blocked = buildBlockedCells(boxes, excludeSet);

  // Run A* search
  const gridPath = aStarSearch(start, end, blocked, gridBounds);

  if (gridPath && gridPath.length > 0) {
    // Convert grid path to pixels
    const pixelPath: Point[] = [start];

    for (let i = 0; i < gridPath.length; i++) {
      pixelPath.push(gridToPixel(gridPath[i]));
    }

    pixelPath.push(end);

    // Simplify path - only remove truly collinear points, validate each step
    return simplifyPathValidated(pixelPath, boxes, excludeSet);
  }

  // STRATEGY 4: Perimeter fallback (validated with the shared policy)
  let perimMinX = Infinity, perimMaxX = -Infinity;
  let perimMinY = Infinity, perimMaxY = -Infinity;
  for (const box of boxes) {
    perimMinX = Math.min(perimMinX, box.x);
    perimMaxX = Math.max(perimMaxX, box.x + box.width);
    perimMinY = Math.min(perimMinY, box.y);
    perimMaxY = Math.max(perimMaxY, box.y + box.height);
  }

  const perimMargin = OBSTACLE_MARGIN + 10;
  const perimTop = Math.max(5, perimMinY - perimMargin);
  const perimBottom = perimMaxY + perimMargin;
  const perimLeft = Math.max(5, perimMinX - perimMargin);
  const perimRight = perimMaxX + perimMargin;

  const perimeterRoutes = [
    // Top route
    [start, { x: start.x, y: perimTop }, { x: end.x, y: perimTop }, end],
    // Bottom route
    [start, { x: start.x, y: perimBottom }, { x: end.x, y: perimBottom }, end],
    // Left route
    [start, { x: perimLeft, y: start.y }, { x: perimLeft, y: end.y }, end],
    // Right route
    [start, { x: perimRight, y: start.y }, { x: perimRight, y: end.y }, end],
    // Top-left corner
    [start, { x: start.x, y: perimTop }, { x: perimLeft, y: perimTop }, { x: perimLeft, y: end.y }, end],
    // Top-right corner
    [start, { x: start.x, y: perimTop }, { x: perimRight, y: perimTop }, { x: perimRight, y: end.y }, end],
    // Bottom-left corner
    [start, { x: start.x, y: perimBottom }, { x: perimLeft, y: perimBottom }, { x: perimLeft, y: end.y }, end],
    // Bottom-right corner
    [start, { x: start.x, y: perimBottom }, { x: perimRight, y: perimBottom }, { x: perimRight, y: end.y }, end],
  ];

  for (const route of perimeterRoutes) {
    if (isPathClear(route, boxes, { fromBoxIdx, toBoxIdx })) {
      return route;
    }
  }

  // ULTIMATE FALLBACK: Return direct line path
  // This will fail validation and be shown in red by the renderer
  console.warn('Cable routing: All strategies failed, returning direct line (will show as invalid)');
  return [start, end];
}

/**
 * Check if a direct line path is clear (no obstacles)
 */
export function isDirectPathClear(p1: Point, p2: Point, boxes: Box[], excludeSet: Set<number>): boolean {
  for (let i = 0; i < boxes.length; i++) {
    if (excludeSet.has(i)) continue;
    if (lineIntersectsBox(p1, p2, boxes[i], OBSTACLE_MARGIN)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a point is inside any non-excluded box (with optional margin)
 */
export function isPointInAnyBox(p: Point, boxes: Box[], excludeSet: Set<number>, margin: number = 0): boolean {
  for (let i = 0; i < boxes.length; i++) {
    if (excludeSet.has(i)) continue;
    const box = boxes[i];
    if (p.x >= box.x - margin && p.x <= box.x + box.width + margin &&
        p.y >= box.y - margin && p.y <= box.y + box.height + margin) {
      return true;
    }
  }
  return false;
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
