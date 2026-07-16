/**
 * Shared Geometry Module
 *
 * SINGLE SOURCE OF TRUTH for:
 * - Core geometric types (Point, Box, BoardBounds)
 * - Routing clearance constants
 * - Segment/box intersection math
 * - Cable path validation policy
 *
 * Every layer (pathfinding, obstacles, validation, routing strategies,
 * routing cost) imports from here. Do not duplicate these constants or
 * functions elsewhere.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

/**
 * Board bounds in pixels - cables should stay within these bounds
 * except for explicit off-board endpoints (guitar, amp)
 */
export interface BoardBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ============================================================================
// CLEARANCE CONSTANTS
// ============================================================================

/**
 * Clearance cables must keep from non-endpoint pedals, in pixels.
 *
 * CONTRACT: must be strictly less than half the minimum guaranteed pedal
 * spacing (COLLISION_SPACING = 0.5" = 20px at 40px/inch), otherwise no cable
 * can pass between two legally placed pedals. 2 * 8 = 16px < 20px.
 */
export const OBSTACLE_MARGIN = 8;

/**
 * Reduced-margin allowance for the first and last path segments.
 * Jacks sit on pedal edges, so endpoint segments may legitimately start
 * closer to a neighboring pedal than the full margin allows.
 */
export const ENDPOINT_TOLERANCE = 4;

/**
 * Distance a cable exits a jack before turning, in pixels (the "stub").
 * Must be > OBSTACLE_MARGIN (so the standoff clears its own pedal's margin)
 * and <= COLLISION_SPACING*scale - OBSTACLE_MARGIN (so a standoff pointing
 * into a minimum-width gap stays clear of the neighboring pedal's margin):
 * 8 < 10 <= 20 - 8.
 */
export const STANDOFF = 10;

/** Grid resolution for A* pathfinding, in pixels. */
export const GRID_CELL_SIZE = 8;

// ============================================================================
// BASIC GEOMETRY
// ============================================================================

/** Distance between two points */
export function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Total polyline length */
export function calculatePathLength(path: Point[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += dist(path[i], path[i + 1]);
  }
  return total;
}

function direction(p1: Point, p2: Point, p3: Point): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1: Point, p2: Point, p: Point): boolean {
  return p.x >= Math.min(p1.x, p2.x) && p.x <= Math.max(p1.x, p2.x) &&
         p.y >= Math.min(p1.y, p2.y) && p.y <= Math.max(p1.y, p2.y);
}

/** Check if two line segments intersect */
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

/** Get the intersection point of two line segments, if they intersect */
export function getSegmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) {
    return null;
  }

  const denom = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denom) < 0.0001) return null;

  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / denom;

  return {
    x: a1.x + t * (a2.x - a1.x),
    y: a1.y + t * (a2.y - a1.y)
  };
}

/**
 * Check if a line segment from p1 to p2 intersects a box expanded by margin
 */
export function lineIntersectsBox(p1: Point, p2: Point, box: Box, margin: number = OBSTACLE_MARGIN): boolean {
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
  const edges: [Point, Point][] = [
    [{ x: left, y: top }, { x: right, y: top }],
    [{ x: right, y: top }, { x: right, y: bottom }],
    [{ x: right, y: bottom }, { x: left, y: bottom }],
    [{ x: left, y: bottom }, { x: left, y: top }],
  ];

  for (const [e1, e2] of edges) {
    if (segmentsIntersect(p1, p2, e1, e2)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// PATH VALIDATION (single policy)
// ============================================================================

/**
 * A single path-vs-obstacle violation, in box-index terms.
 */
export interface BoxViolation {
  /** Index of the path segment that caused the violation */
  segmentIndex: number;
  /** Index of the obstacle box that was intersected */
  boxIndex: number;
  /** Approximate point of the violation (segment midpoint) */
  point: Point;
}

/**
 * Endpoint pedal boxes for validation. A cable may only overlap its own
 * source/destination pedal on the STUB segments (first segment for the
 * source, last segment for the destination) - the short jack exits.
 * Everywhere else, its own pedals are obstacles like any other, which is
 * what prevents cables from being drawn straight through their own chassis.
 */
export interface PathEndpoints {
  /** Box index of the source pedal, or -1 for external endpoints */
  fromBoxIdx?: number;
  /** Box index of the destination pedal, or -1 for external endpoints */
  toBoxIdx?: number;
}

/**
 * THE cable path validation policy. Used both mid-routing (to accept or
 * reject candidate strategies) and for final path acceptance, so the two can
 * never disagree.
 *
 * Policy:
 * - Every segment must stay OBSTACLE_MARGIN away from every box.
 * - The first and last segments use a reduced margin
 *   (OBSTACLE_MARGIN - ENDPOINT_TOLERANCE) because jacks sit on pedal edges.
 * - The source box is exempt ONLY on the first segment (the exit stub);
 *   the destination box ONLY on the last segment (the entry stub).
 *
 * @param path - Polyline points
 * @param boxes - All obstacle boxes
 * @param endpoints - Source/destination box indices (see PathEndpoints)
 * @returns All violations found (empty array = valid path)
 */
export function findPathViolations(
  path: Point[],
  boxes: Box[],
  endpoints: PathEndpoints = {}
): BoxViolation[] {
  const violations: BoxViolation[] = [];
  if (path.length < 2) return violations;

  const fromBoxIdx = endpoints.fromBoxIdx ?? -1;
  const toBoxIdx = endpoints.toBoxIdx ?? -1;
  const lastSeg = path.length - 2;

  for (let segIdx = 0; segIdx < path.length - 1; segIdx++) {
    const p1 = path[segIdx];
    const p2 = path[segIdx + 1];

    const isEndpointSegment = segIdx === 0 || segIdx === lastSeg;
    const margin = isEndpointSegment ? OBSTACLE_MARGIN - ENDPOINT_TOLERANCE : OBSTACLE_MARGIN;

    for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
      // Stub exemptions: source box on the first segment, destination box
      // on the last segment
      if (segIdx === 0 && boxIdx === fromBoxIdx) continue;
      if (segIdx === lastSeg && boxIdx === toBoxIdx) continue;

      const box = boxes[boxIdx];
      if (box.width <= 0 || box.height <= 0) continue;

      if (lineIntersectsBox(p1, p2, box, margin)) {
        violations.push({
          segmentIndex: segIdx,
          boxIndex: boxIdx,
          point: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        });
      }
    }
  }

  return violations;
}

/**
 * Quick boolean form of findPathViolations (early exit on first violation).
 */
export function isPathClear(
  path: Point[],
  boxes: Box[],
  endpoints: PathEndpoints = {}
): boolean {
  if (path.length < 2) return true;

  const fromBoxIdx = endpoints.fromBoxIdx ?? -1;
  const toBoxIdx = endpoints.toBoxIdx ?? -1;
  const lastSeg = path.length - 2;

  for (let segIdx = 0; segIdx < path.length - 1; segIdx++) {
    const isEndpointSegment = segIdx === 0 || segIdx === lastSeg;
    const margin = isEndpointSegment ? OBSTACLE_MARGIN - ENDPOINT_TOLERANCE : OBSTACLE_MARGIN;

    for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
      if (segIdx === 0 && boxIdx === fromBoxIdx) continue;
      if (segIdx === lastSeg && boxIdx === toBoxIdx) continue;

      const box = boxes[boxIdx];
      if (box.width <= 0 || box.height <= 0) continue;

      if (lineIntersectsBox(path[segIdx], path[segIdx + 1], box, margin)) {
        return false;
      }
    }
  }

  return true;
}
