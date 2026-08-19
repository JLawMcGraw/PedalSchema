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
 * CONTRACT, both halves, at the app's 40px/inch:
 *
 *   2 * OBSTACLE_MARGIN < COLLISION_SPACING * 40   (0.5in = 20px, side to side)
 *   2 * OBSTACLE_MARGIN < ROW_GAP * 40             (0.35in = 14px, row to row)
 *
 * clearance-contract.test.ts asserts both. The SECOND HALF was missing until
 * 2026-08-18, and it was violated: at 8 a cable needed 16px to travel between
 * two rows that the placer designs 14px apart. So a board laid out exactly to
 * spec had no row corridor the router would use - every cable that had to
 * cross between rows reported `unattached-*` and was drawn red. On the real
 * 22-pedal board that was four cables, and the owner was right that they fit:
 * the rows are 0.35in apart and a patch cable is about 0.24in.
 *
 * Same shape as the 25px-margin against 20px-spacing contradiction found in
 * the July review - two numbers describing one gap, written in different
 * files, agreeing with neither each other nor the hardware.
 *
 * 6 satisfies both (12 < 14 < 20). Raising it again means widening ROW_GAP
 * first, and ROW_GAP has its own arithmetic to redo - see layout/constants.ts.
 */
export const OBSTACLE_MARGIN = 6;

/**
 * Reduced-margin allowance for the first and last path segments.
 * Jacks sit on pedal edges, so endpoint segments may legitimately start
 * closer to a neighboring pedal than the full margin allows.
 */
export const ENDPOINT_TOLERANCE = 4;

/**
 * Distance a cable exits a jack before turning, in pixels (the "stub").
 *
 * SIDE axis (satisfied): must be > OBSTACLE_MARGIN, so the stub clears its own
 * pedal's margin, and <= COLLISION_SPACING*scale - OBSTACLE_MARGIN, so a stub
 * pointing into a minimum-width gap between two side-by-side pedals stays
 * clear of the neighbour's margin: 6 < 10 <= 20 - 6.
 *
 * ROW axis (NOT satisfied, and known): a jack on a TOP or BOTTOM edge points
 * its stub into a row corridor, needing STANDOFF + OBSTACLE_MARGIN = 16px
 * where ROW_GAP designs 14px. Short by 2px, so such a jack cannot plant a
 * legal stub in a corridor the placer is happy with.
 *
 * This is the same shape of omission that had OBSTACLE_MARGIN demanding 16px
 * in a 14px corridor until 2026-08-18 - a contract written against
 * COLLISION_SPACING alone, with the row axis simply not mentioned. It is
 * asserted as a known contradiction in clearance-contract.test.ts rather than
 * fixed, because fixing it does not make the board that found it green:
 * corridor capacity binds independently there.
 *
 * The arithmetic above used to read `8 < 10 <= 20 - 8`, quoting an
 * OBSTACLE_MARGIN of 8 that has been 6 since 2026-08-18.
 */
export const STANDOFF = 10;

/**
 * How far two coordinates may differ and still count as sharing an axis, in
 * pixels.
 *
 * EVERY cable this app draws turns at right angles - a patch cable leaves a
 * jack square-on, so a diagonal line is a picture of a cable that cannot
 * exist. Sub-pixel differences fall out of jack-position arithmetic and are
 * not diagonals anybody can see; this is the threshold that separates the two.
 *
 * Lives here because the PRODUCERS (the strategy cascade, A*) and the CHECKERS
 * (orthogonal-cascade.test.ts, the lane router's acceptance test) must agree
 * on it. They were separately hard-coded as 0.5 before 2026-08-18.
 */
export const ORTHOGONAL_EPSILON = 0.5;

/** Do these two points share an axis, to within ORTHOGONAL_EPSILON? */
export function sharesAxis(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < ORTHOGONAL_EPSILON || Math.abs(a.y - b.y) < ORTHOGONAL_EPSILON;
}

/** Grid resolution for A* pathfinding, in pixels. */
export const GRID_CELL_SIZE = 8;

/**
 * Perpendicular distance between adjacent parallel cable runs, in pixels.
 *
 * CONTRACT: must exceed the rendered width of a cable, or two runs at this
 * spacing read as one thick line. A cable draws as a 3px stroke inside a 5px
 * shadow (cable-renderer.tsx), so the rendered width is 5px and 12 > 5 holds
 * with room for the eye to separate them.
 *
 * Owned here because TWO different stages space runs apart and must agree:
 * the corridor model in engine/lanes (how many lanes fit in a corridor) and
 * the parallel-run separation pass in engine/cables/route-cables (how far to
 * shift an overlapping run). They were independently defined as 12 in both
 * files until 2026-07-30; changing the stroke width would have updated one
 * and silently desynced the other.
 */
export const LANE_SPACING = 12;

/**
 * Floor for LANE_SPACING when a corridor is squeezed, in pixels.
 * Below this a corridor counts as over capacity and the router gives up on
 * fitting another lane rather than drawing runs that visually merge.
 * Lives beside LANE_SPACING so raising one without reconsidering the other
 * is an obvious omission rather than an invisible one.
 */
export const MIN_LANE_SPACING = 9;

/**
 * How close two parallel runs may sit before the separation pass treats them
 * as overlapping, in pixels.
 *
 * This is the ACCEPTANCE threshold, and it must never sit above the floor the
 * invariant judges against. It was declared locally in cables/route-cables as
 * 10 while `laneViolations` flagged anything below MIN_LANE_SPACING (9), so
 * separateParallelRuns could stop at 10px believing it had succeeded while the
 * runs were still one pixel from a violation - and the invariant, satisfied at
 * 9, never said otherwise. Two thresholds for one question, in two files,
 * disagreeing by design.
 *
 * Equal to MIN_LANE_SPACING on purpose: "far enough apart" and "not a
 * violation" are the same question and now have one answer.
 */
export const LANE_TOLERANCE = MIN_LANE_SPACING;

// ============================================================================
// BASIC GEOMETRY
// ============================================================================

/**
 * Force an orthogonal polyline: any diagonal segment gains one elbow.
 *
 * Cable paths are Manhattan by contract - the renderer draws square corners
 * and the lane model classifies every run as horizontal or vertical, so a
 * diagonal both looks wrong and drops out of overlap detection. Two places
 * can introduce one: a stub whose jack is not on a box edge, and the
 * parallel-run separation pass, which moves a segment's shared endpoints and
 * so tilts any neighbour running parallel to the shift.
 *
 * The elbow continues the incoming segment's orientation where there is one,
 * so a run keeps its direction and turns exactly once.
 */
export function manhattanize(pts: Point[]): Point[] {
  if (pts.length < 2) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (!sharesAxis(a, b)) {
      const prev = out.length >= 2 ? out[out.length - 2] : null;
      const cameHorizontally = prev
        ? Math.abs(a.y - prev.y) <= ORTHOGONAL_EPSILON
        : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      out.push(cameHorizontally ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
    out.push(b);
  }
  return out;
}

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
