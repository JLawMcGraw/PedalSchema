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
  sharesAxis,
  isPathClear,
  findPathViolations,
} from '../geometry';

import { findPathAStar, getStandoffPoint } from '../pathfinding';

import type { ObstacleSet } from '../obstacles';
import { getBoxForPedal } from '../obstacles';
import { validateCablePath, type ValidationResult } from './validation';

// Re-export types
export type { Point, Box, BoardBounds };


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

  const outside = (p: Point): boolean =>
    p.x < boardBounds.minX || p.x > boardBounds.maxX ||
    p.y < boardBounds.minY || p.y > boardBounds.maxY;

  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    if (p.x < boardBounds.minX - BOARD_OVERHANG ||
        p.x > boardBounds.maxX + BOARD_OVERHANG ||
        p.y < boardBounds.minY - BOARD_OVERHANG ||
        p.y > boardBounds.maxY + BOARD_OVERHANG) {
      return false;
    }
  }

  // THE OVERHANG IS FOR POKING OUT, NOT FOR TRAVELLING.
  //
  // The per-point check above says how FAR outside a point may sit; it says
  // nothing about how far a route may RUN out there. A jack on a pedal flush
  // against the edge points its stub slightly off-board, which is the whole
  // reason for the allowance - but the same tolerance let A* leave the board
  // and use the 16px band as a highway: measured on the perimeter fixture as a
  // 520px run along y=-12, from x=700 to x=1220, which beat the perimeter rung
  // and so was drawn as an ordinary cable rather than a dashed one the user is
  // told to run underneath.
  //
  // A segment with BOTH ends outside the board is a run, not a stub, and may
  // not be longer than one.
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (outside(a) && outside(b) && dist(a, b) > STANDOFF) return false;
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
 * How far outside the board a perimeter route runs.
 *
 * Wider than BOARD_OVERHANG because this is a cable lying beside or under the
 * board, not a jack stub poking past the edge - it needs to read as "this one
 * does not lie on the board" rather than as a near-miss.
 *
 * Must stay inside the canvas padding (PADDING_INCHES = 2in = 80px in
 * editor-canvas.tsx), or the route is drawn outside the viewBox and the user
 * sees a cable that simply vanishes at the board edge.
 */
const PERIMETER_OFFSET = 24;

/**
 * Route around the OUTSIDE of the board.
 *
 * A full board has no room left between its rows. The real 20-pedal Classic
 * Pro packs three rows of ~5.1in pedals into 16in, which leaves 0.2in
 * corridors - and a patch cable is about 0.24in thick, so it physically does
 * not fit between them. Every on-board strategy is right to refuse.
 *
 * That is not the same as the cable being impossible. The run people actually
 * make there goes around the edge of the board, or under it - which is what
 * this builds. It matters because the alternative is `fallback-invalid`, whose
 * straight line cut diagonally through five pedal bodies: a drawing of a cable
 * that could not exist, where the truth is a cable that exists but leaves the
 * board plane.
 *
 * Walks the ring outside the board in both directions and takes the shorter
 * clear one, entering and leaving by whichever edge each endpoint is nearest.
 */
function routeAroundBoard(
  s: Point,
  t: Point,
  boardBounds: BoardBounds | null,
  /** Judges a candidate RING as the fully assembled path it will become. */
  isClear: (core: Point[]) => boolean
): Point[] | null {
  if (!boardBounds) return null;
  const { minX, maxX, minY, maxY } = boardBounds;
  const oL = minX - PERIMETER_OFFSET;
  const oR = maxX + PERIMETER_OFFSET;
  const oT = minY - PERIMETER_OFFSET;
  const oB = maxY + PERIMETER_OFFSET;

  /**
   * EVERY edge this endpoint could leave by, nearest first - not just the
   * nearest one.
   *
   * Taking only the nearest edge is what made this strategy useless in the
   * situation it exists for. Leaving by an edge means a straight run from the
   * endpoint out past the board, and on a FULL board that run is very likely
   * blocked - the board being full is the premise. Measured on the `test`
   * board: a source at (734,269) has its nearest edge 269px away (top), and the
   * straight shot up crosses a back-row pedal occupying x[716,832]. Both ring
   * directions inherit that one blocked stub, so both were rejected and the
   * cable fell through to `fallback-invalid` - a red diagonal across the board,
   * which is precisely the drawing this strategy was added to replace.
   *
   * Nearest first only sets the preference; the shortest CLEAR candidate wins
   * below, so an ordinary cable still leaves by the sensible edge.
   */
  const exits = (p: Point): Array<{ side: number; point: Point }> => {
    const d = [p.x - minX, minY === maxY ? Infinity : p.y - minY, maxX - p.x, maxY - p.y];
    const points = [
      { x: oL, y: p.y }, { x: p.x, y: oT }, { x: oR, y: p.y }, { x: p.x, y: oB },
    ];
    return [0, 1, 2, 3]
      .filter((side) => Number.isFinite(d[side]))
      .sort((a, b) => d[a] - d[b] || a - b)
      .map((side) => ({ side, point: points[side] }));
  };

  const corners = [
    { x: oL, y: oT }, // between left(0) and top(1)
    { x: oR, y: oT }, // between top(1) and right(2)
    { x: oR, y: oB }, // between right(2) and bottom(3)
    { x: oL, y: oB }, // between bottom(3) and left(0)
  ];

  const length = (pts: Point[]): number =>
    pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);

  // Every (exit edge x entry edge x direction) combination - at most 32, each
  // a handful of segments. Cheap, and this is the last rung of the cascade.
  const candidates: Array<{ core: Point[]; len: number; rank: number }> = [];
  const fromExits = exits(s);
  const toExits = exits(t);

  fromExits.forEach((from, fi) => {
    toExits.forEach((to, ti) => {
      for (const dir of [1, -1]) {
        const ring: Point[] = [from.point];
        // Step side by side around the ring, collecting the corner between each
        // pair, until the entry side is reached.
        let side = from.side;
        for (let step = 0; step < 4 && side !== to.side; step++) {
          // Going forward (dir=1) the corner AFTER side `side` is corners[side];
          // going backward it is the corner before it.
          ring.push(corners[dir === 1 ? side : (side + 3) % 4]);
          side = (side + dir + 4) % 4;
        }
        ring.push(to.point);
        // rank keeps ties deterministic: config-matrix asserts determinism and
        // idempotence, and sorting on length alone leaves mirror-image rings
        // (dir 1 vs -1 between opposite edges) exactly equal.
        candidates.push({
          core: ring,
          len: length([s, ...ring, t]),
          rank: (fi * 4 + ti) * 2 + (dir === 1 ? 0 : 1),
        });
      }
    });
  });

  return (
    candidates
      // isClear judges the ring as the assembled path it will become - see the
      // call site. Passing the bare core is what keeps the two in step.
      .filter((c) => isClear(c.core))
      .sort((a, b) => a.len - b.len || a.rank - b.rank)[0]?.core ?? null
  );
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
export const ROUTING_STRATEGIES = [
  'facing',           // standoffs meet - the cable is just the two stubs
  'direct',           // straight line between standoffs (<= 80px)
  'l-horizontal',     // single corner, horizontal leg first
  'l-vertical',       // single corner, vertical leg first
  'channel',          // through a gap between pedal rows
  'above',            // over the top of every pedal
  'below',            // under the bottom of every pedal
  'safe-lane',        // a lane just outside the obstacle rows
  'astar',            // grid pathfinding
  'perimeter',        // around the outside of the board - see routeAroundBoard
  'fallback-invalid', // nothing worked; renderer draws this red
] as const;

/**
 * Derived from the value, not declared alongside it. A hand-written union
 * next to a hardcoded list in a test is how optimize-e2e came to assert
 * against a set that silently omitted 'perimeter' - it passed only because
 * no fixture board happened to need one. Adding a strategy here can no
 * longer leave a test list stale.
 */
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

/**
 * Strategies that are a GOOD result - the cable took an ordinary shape.
 *
 * Listed as the small set rather than its complement on purpose: a strategy
 * added to the cascade later gets added at the desperate end (that is why a new
 * rung is ever needed), so an unrecognised one should default to complex. The
 * inverse list would default it to free and quietly stop charging for the exact
 * case the penalty exists to notice.
 *
 * 'lane-router' is not in ROUTING_STRATEGIES - it is not a rung of the cascade
 * but the corridor model that runs before it - and it is the outcome the whole
 * router is built to produce, so it heads the list.
 */
const SIMPLE_ROUTES = new Set<string>([
  'lane-router',   // the corridor loom - the result P1.5 exists to get
  'facing',        // two standoffs meeting; there is no route to speak of
  'direct',        // a straight line
  'l-horizontal',  // one corner
  'l-vertical',    // one corner
]);

/**
 * Whether a cable's route should be charged COMPLEX_ROUTING_PENALTY_INCHES.
 *
 * This replaces `path.length > 3` in routing-cost.ts, which was the same
 * statement before P1.5 and stopped being one after it. Measured on both saved
 * boards on 2026-08-08, the point-count test charged 21 of 33 cables and 15 of
 * those were 'lane-router' - the tidy loom the corridor model exists to build,
 * which is four points before anything has gone wrong. Both L strategies were
 * charged too, though the penalty's own comment names the "simple L-path" as
 * the thing it is NOT about. A manhattanized L with a standoff at each end is
 * 4-5 points.
 *
 * 'fallback-invalid' is deliberately NOT complex: an unroutable cable is
 * already charged twice CABLE_COLLISION_PENALTY_INCHES by `routingFailures`,
 * and charging it here as well would make one defect show up as two dimensions
 * in a score explanation that is supposed to add up.
 */
export function isComplexRoute(strategy: RoutingStrategy | 'lane-router'): boolean {
  if (strategy === 'fallback-invalid') return false; // routingFailures owns this
  return !SIMPLE_ROUTES.has(strategy);
}

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

  // Strategy 1: Direct line between standoffs (for very close jacks).
  //
  // ONLY WHEN THE STANDOFFS ALREADY LINE UP. A patch cable leaves a jack
  // square-on and turns at right angles; joining two standoffs that differ on
  // both axes draws a diagonal, which is a picture of a cable that cannot
  // exist. This rung was the last place in the cascade that produced one - A*
  // is 4-directional, the L-paths and lane strategies are orthogonal by
  // construction, the perimeter ring is axis-aligned, and even the
  // deliberately-through-pedals fallback draws elbows.
  //
  // It costs nothing to restrict: when the standoffs DO line up, `[s, t]` is
  // exactly what the L-paths below collapse to after dedupePath, and when they
  // do not, those L-paths are the right answer anyway. What it buys is that
  // the cascade's output can now be compared with the lane router's on equal
  // terms - see the never-worse guard note in lane-router.test.ts, which was
  // reverted precisely because this rung made the comparison unfair.
  if (sharesAxis(s, t) && dist(s, t) <= 80) {
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

  // Strategy 8: around the outside of the board. Last resort before giving up,
  // because a cable lying beside the board is a real cable but not the one
  // anybody wants - every on-board route above is preferable. See
  // routeAroundBoard for why a full board leaves no on-board option at all.
  //
  // The predicate judges the ring as the FULLY ASSEMBLED path it will become -
  // standoffs included - so selection and final validation see identical
  // geometry with identical segment indices. They did not before: the ring was
  // checked as [standoff, ...ring, standoff] and then returned as
  // [jack, ...ring, jack], so the exit stub was stub-EXEMPT while being chosen
  // and non-exempt when validated, and the standoffs were dropped from the
  // path entirely. That let a route be selected and then reported invalid -
  // the same "two policies" bug the facing-jack shortcut had.
  const perimeterPath = (core: Point[]): Point[] => assemble([s, ...core, t]);
  const around = routeAroundBoard(s, t, boardBounds, (core) =>
    isPathClear(perimeterPath(core), boxes, { fromBoxIdx, toBoxIdx })
  );
  if (around) {
    // Deliberately NOT run through candidateOk: this path is off-board by
    // construction, which is the one thing candidateOk forbids.
    return { path: perimeterPath(around), strategy: 'perimeter' };
  }

  // Last resort: route THROUGH the pedals, deliberately, and say so.
  //
  // A sealed jack is a real situation rather than a bug to route around. On the
  // `test` board the NS-2's left output is enclosed on all four sides - the
  // row-1/row-2 gap is 7.6px where a path needs 2 x OBSTACLE_MARGIN, and the
  // PW-3 straddler merges rows 2 and 3 so there is no lane between them either.
  // No corridor, no perimeter ring and no A* route exists at that clearance. In
  // the room you press the cable in: pedals have chamfers and cables bend.
  //
  // This used to join the two standoffs DIRECTLY, which drew a diagonal across
  // the board - a picture of a cable that could not exist, since a patch cable
  // leaves a jack square-on and turns at right angles. It stays
  // `fallback-invalid` so the renderer still draws it red and routingFailures
  // still charges it: the board really is over-full and should say so. What
  // changes is that the drawing is now a cable.
  //
  // Of the two L-paths, take the one crossing the fewest pedal BODIES - if it
  // must pass through something, pass through as little as possible. Ties go to
  // horizontal-first for determinism, which config-matrix asserts.
  const elbows = [
    { x: toStandoff.x, y: fromStandoff.y }, // horizontal leg first
    { x: fromStandoff.x, y: toStandoff.y }, // vertical leg first
  ];
  const scored = elbows.map((elbow) => {
    const candidate = dedupePath([from, fromStandoff, elbow, toStandoff, to]);
    return {
      candidate,
      crossings: findPathViolations(candidate, boxes, { fromBoxIdx, toBoxIdx }).length,
    };
  });
  const best = scored[1].crossings < scored[0].crossings ? scored[1] : scored[0];

  return {
    path: best.candidate,
    strategy: 'fallback-invalid',
  };
}
