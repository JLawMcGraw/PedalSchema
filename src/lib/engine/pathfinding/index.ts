/**
 * A* Pathfinding Module
 *
 * Provides grid-based A* pathfinding for cable routing with obstacle avoidance.
 * Extracted from cable-renderer.tsx for reuse in layout optimization.
 */

// Core types
export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

// Grid-based A* configuration
export const GRID_CELL_SIZE = 8; // 8px per grid cell - finer grid for better routing
export const OBSTACLE_MARGIN = 25; // Margin around pedals in pixels - must be large enough to prevent visual clipping
export const STANDOFF = 40; // Distance from jack to first routing point - must be outside pedal box

// Debug flags - set to false for production
const DEBUG_PATHS = false;
const DEBUG_GRID = false;

/**
 * Calculate a standoff point outside the pedal box based on which edge the jack is on
 */
export function getStandoffPoint(jackPos: Point, box: Box | null, standoff: number): Point {
  if (!box) return jackPos; // No box = external connection, no standoff needed

  const tolerance = 5; // How close to edge to consider "on" that edge

  // Determine which edge the jack is on
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
 * Distance between two points
 */
export function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Check if a line segment from p1 to p2 intersects a box (with margin)
 */
export function lineIntersectsBox(p1: Point, p2: Point, box: Box, margin: number = 8): boolean {
  const left = box.x - margin;
  const right = box.x + box.width + margin;
  const top = box.y - margin;
  const bottom = box.y + box.height + margin;

  // Quick bounding box rejection
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (maxX < left || minX > right || maxY < top || minY > bottom) {
    return false;
  }

  // Check if either endpoint is inside the box
  if (p1.x >= left && p1.x <= right && p1.y >= top && p1.y <= bottom) return true;
  if (p2.x >= left && p2.x <= right && p2.y >= top && p2.y <= bottom) return true;

  // Check line against each edge of the box
  const edges = [
    [{ x: left, y: top }, { x: right, y: top }],     // Top edge
    [{ x: right, y: top }, { x: right, y: bottom }], // Right edge
    [{ x: right, y: bottom }, { x: left, y: bottom }], // Bottom edge
    [{ x: left, y: bottom }, { x: left, y: top }],  // Left edge
  ];

  for (const [e1, e2] of edges) {
    if (segmentsIntersect(p1, p2, e1, e2)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two line segments intersect
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;

  return false;
}

/**
 * Get the intersection point of two line segments, if they intersect
 */
export function getSegmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) {
    return null;
  }

  // Calculate intersection point
  const denom = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denom) < 0.0001) return null;

  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / denom;

  return {
    x: a1.x + t * (a2.x - a1.x),
    y: a1.y + t * (a2.y - a1.y)
  };
}

function direction(p1: Point, p2: Point, p3: Point): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1: Point, p2: Point, p: Point): boolean {
  return p.x >= Math.min(p1.x, p2.x) && p.x <= Math.max(p1.x, p2.x) &&
         p.y >= Math.min(p1.y, p2.y) && p.y <= Math.max(p1.y, p2.y);
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
  excludeIndices: Set<number>,
  gridBounds: { minX: number; maxX: number; minY: number; maxY: number }
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
 * Remove small zigzags from path
 */
export function smoothPath(path: Point[]): Point[] {
  if (path.length <= 2) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Calculate the deviation: how far does curr deviate from the prev→next line?
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1) {
      // prev and next are basically the same point, skip curr
      continue;
    }

    // Project curr onto line prev→next
    const t = ((curr.x - prev.x) * dx + (curr.y - prev.y) * dy) / (len * len);
    const projX = prev.x + t * dx;
    const projY = prev.y + t * dy;
    const deviation = Math.sqrt((curr.x - projX) ** 2 + (curr.y - projY) ** 2);

    // Keep point only if it creates significant deviation (> 20px)
    if (deviation > 20) {
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
 */
export function findPathAStar(
  start: Point,
  end: Point,
  boxes: Box[],
  fromBoxIdx: number = -1,
  toBoxIdx: number = -1
): Point[] {
  // Build exclude set - ONLY exclude source and destination pedals
  // Do NOT exclude other pedals even if start/end is inside them - this was causing
  // cables to go through pedals when jack positions overlapped with adjacent pedal boxes
  const excludeSet = new Set<number>();
  if (fromBoxIdx >= 0) excludeSet.add(fromBoxIdx);
  if (toBoxIdx >= 0) excludeSet.add(toBoxIdx);

  // STRATEGY 1: Check for direct line path (fastest)
  // Only use direct path for VERY short distances where there's no room for obstacles
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const isVeryShort = distance < 50; // Only very short distances - reduced from 80
  const isHorizontal = dy < 20 && dx > dy; // Nearly horizontal - tightened from 30
  const isVertical = dx < 20 && dy > dx; // Nearly vertical - tightened from 30

  if ((isVeryShort || isHorizontal || isVertical) && isDirectPathClear(start, end, boxes, excludeSet)) {
    if (DEBUG_PATHS) {
      console.log(`  [DIRECT] Using direct path (dist=${distance.toFixed(0)}, dx=${dx.toFixed(0)}, dy=${dy.toFixed(0)})`);
    }
    return [start, end];
  }

  // STRATEGY 2: Simple L-shaped paths (only for short distances)
  if (distance < 150) { // Reduced from 200
    const midH = { x: end.x, y: start.y };
    const midV = { x: start.x, y: end.y };

    if (isDirectPathClear(start, midH, boxes, excludeSet) &&
        isDirectPathClear(midH, end, boxes, excludeSet) &&
        !isPointInAnyBox(midH, boxes, excludeSet)) {
      if (DEBUG_PATHS) {
        console.log(`  [L-PATH] Using L-shaped path via (${midH.x.toFixed(0)},${midH.y.toFixed(0)})`);
      }
      return [start, midH, end];
    }

    if (isDirectPathClear(start, midV, boxes, excludeSet) &&
        isDirectPathClear(midV, end, boxes, excludeSet) &&
        !isPointInAnyBox(midV, boxes, excludeSet)) {
      if (DEBUG_PATHS) {
        console.log(`  [L-PATH] Using L-shaped path via (${midV.x.toFixed(0)},${midV.y.toFixed(0)})`);
      }
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
  const gridBounds = {
    minX: Math.floor((minX - padding) / GRID_CELL_SIZE),
    maxX: Math.ceil((maxX + padding) / GRID_CELL_SIZE),
    minY: Math.floor((minY - padding) / GRID_CELL_SIZE),
    maxY: Math.ceil((maxY + padding) / GRID_CELL_SIZE)
  };

  // Build blocked cells
  const blocked = buildBlockedCells(boxes, excludeSet, gridBounds);

  if (DEBUG_GRID) {
    console.log(`A* Grid: ${gridBounds.maxX - gridBounds.minX} x ${gridBounds.maxY - gridBounds.minY} cells`);
    console.log(`Blocked cells: ${blocked.size}`);
  }

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
    const simplified = simplifyPathValidated(pixelPath, boxes, excludeSet);

    if (DEBUG_PATHS) {
      console.log(`A* found path with ${gridPath.length} grid cells, simplified to ${simplified.length} points`);
    }

    return simplified;
  }

  // STRATEGY 4: Perimeter fallback (validated)
  let perimMinX = Infinity, perimMaxX = -Infinity;
  let perimMinY = Infinity, perimMaxY = -Infinity;
  for (const box of boxes) {
    perimMinX = Math.min(perimMinX, box.x);
    perimMaxX = Math.max(perimMaxX, box.x + box.width);
    perimMinY = Math.min(perimMinY, box.y);
    perimMaxY = Math.max(perimMaxY, box.y + box.height);
  }

  const margin = 50;
  const perimTop = perimMinY - margin;
  const perimBottom = perimMaxY + margin;
  const perimLeft = perimMinX - margin;
  const perimRight = perimMaxX + margin;

  // Try various perimeter routes and validate each
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
    if (validateRoute(route, boxes, excludeSet)) {
      return route;
    }
  }

  // ULTIMATE FALLBACK: Return a path that goes way outside
  console.warn('Cable routing: All strategies failed, using emergency fallback');
  const emergencyY = perimTop - 100;
  return [
    start,
    { x: start.x, y: emergencyY },
    { x: end.x, y: emergencyY },
    end
  ];
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
 * Check if a point is inside any non-excluded box
 */
export function isPointInAnyBox(p: Point, boxes: Box[], excludeSet: Set<number>): boolean {
  for (let i = 0; i < boxes.length; i++) {
    if (excludeSet.has(i)) continue;
    const box = boxes[i];
    if (p.x >= box.x && p.x <= box.x + box.width &&
        p.y >= box.y && p.y <= box.y + box.height) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that an entire route is clear
 */
export function validateRoute(route: Point[], boxes: Box[], excludeSet: Set<number>): boolean {
  // Check each segment
  for (let i = 0; i < route.length - 1; i++) {
    if (!isDirectPathClear(route[i], route[i + 1], boxes, excludeSet)) {
      return false;
    }
  }

  // Check that intermediate points aren't inside any box
  for (let i = 1; i < route.length - 1; i++) {
    if (isPointInAnyBox(route[i], boxes, excludeSet)) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate the total length of a path
 */
export function calculatePathLength(path: Point[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += dist(path[i], path[i + 1]);
  }
  return total;
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
          const intersection = getSegmentIntersection(
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
