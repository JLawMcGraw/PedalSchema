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
import { LANE_SPACING, LANE_TOLERANCE, manhattanize } from '../geometry';
import { generateObstacles, type ObstacleSet } from '../obstacles';
import {
  routeCableWithObstacles, isComplexRoute, COMPLEX_ROUTE_PENALTY_INCHES, type RoutingStrategy,
} from './routing-strategies';
import { getExternalEndpointPx, getPedalJackPx, type ExternalEndpointType } from './endpoints';
import { isPathValid, type ValidationResult } from './validation';
import { routeCablesWithLanes, type LaneRouteRequest, type LaneOutcome } from '../lanes';
import { isDebugEnabled } from '../debug-flag';
import { detectCableCrossings } from '../pathfinding';

/**
 * One routed polyline, with no `Cable` attached.
 *
 * This is the unit BOTH callers share: the renderer, which has real Cable
 * objects, and the layout cost function, which has none. Keeping the pedal ids
 * on here is not optional - `separateParallelRuns` re-validates every lane
 * shift with `isPathValid(candidate, obstacles, fromPedalId, toPedalId)`, so a
 * path that has lost its endpoints cannot be laned.
 */
export interface RoutedPath {
  /** Routed polyline in pixels */
  path: Point[];
  /**
   * Which router produced this path: 'lane-router' when the corridor model
   * served it, otherwise the strategy rung that succeeded. Recorded so
   * "why does this cable look like that?" is answerable from state rather
   * than by re-tracing the cascade by hand.
   */
  strategy: RoutingStrategy | 'lane-router';
  /**
   * What the corridor router did with this cable, which `strategy` cannot say.
   *
   * `strategy` reports the rung that eventually SUCCEEDED, so every corridor
   * failure looks the same from outside: the cable simply arrives carrying
   * 'l-horizontal' or 'channel' with no record of what it was refused first.
   * Four unrelated causes collapsed that way, and one of them - 'evicted' - is
   * the `assignLanes` cliff, the only one that indicates a crowded board rather
   * than an ordinary one.
   *
   * Undefined when the lane router did not run (`laneRouter: false`).
   */
  laneOutcome?: LaneOutcome;
  /** Whether the path clears all obstacles */
  valid: boolean;
  /** Populated only when invalid */
  validation?: ValidationResult;
  /** The pedals this path terminates on, if any - see the note above */
  fromPedalId: string | null;
  toPedalId: string | null;
}

export interface RoutedCable extends RoutedPath {
  cable: Cable;
  /** Resolved endpoint positions in pixels */
  fromPos: Point;
  toPos: Point;
}

/**
 * Enabled by ?debug-cables in the browser, or DEBUG_CABLES=1 for offline
 * replay. Asked through debug-flag rather than `typeof window`: bundlers fold
 * that check to a literal in a client bundle, and a Worker IS a client bundle
 * with no `window` - see engine/debug-flag for the full account.
 */
const DEBUG_PATHS = isDebugEnabled('debug-cables');

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
  results: RoutedPath[],
  obstacles: ObstacleSet,
  movable?: Set<number>
): void {
  // Nothing may move: every cable was served by the lane router, which already
  // coordinates its own lanes. Cheap, but the real point is that it makes this
  // pass provably a no-op for that case rather than merely an empty one.
  if (movable && movable.size === 0) return;

  // Board bounds come from the obstacle set, not from board/scale. They are
  // the same numbers: generateObstacles sets boardBounds to {0, w*scale, 0,
  // d*scale}, so `-LANE_BOARD_OVERHANG` is exactly `minX - LANE_BOARD_OVERHANG`.
  // Taking them from here is what lets the cost function - which has a board
  // but no reason to pass one - share this pass.
  const { boardBounds } = obstacles;
  const minX = boardBounds.minX - LANE_BOARD_OVERHANG;
  const maxX = boardBounds.maxX + LANE_BOARD_OVERHANG;
  const minY = boardBounds.minY - LANE_BOARD_OVERHANG;
  const maxY = boardBounds.maxY + LANE_BOARD_OVERHANG;

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
    // Moving this run's shared endpoints tilts any neighbour that ran
    // parallel to the shift; manhattanize restores the square corner rather
    // than rejecting the shift, which would cost the lane separation the
    // shift exists to create.
    return manhattanize(candidate);
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
        if (!isPathValid(candidate, obstacles, rc.fromPedalId, rc.toPedalId)) continue;
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
          if (!isPathValid(candidate, obstacles, rc.fromPedalId, rc.toPedalId)) continue;
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
 * When true, cables route through the Manhattan corridor graph
 * (src/lib/engine/lanes) with the strategy router as per-cable fallback.
 */
const USE_LANE_ROUTER = true;

/**
 * Route a batch of endpoint pairs. THE routing entry point - everything that
 * needs a cable path goes through here, so nothing can score one geometry
 * while the user is shown another.
 *
 * Batch, not per-cable, and that is load-bearing: `assignLanes` derives a
 * cable's perpendicular lane from how many cables share its corridor. Routed
 * one at a time every cable centres in its corridor (n=1), giving different
 * geometry AND zero lane separation. A caller holding one cable must still
 * call this with an array of one and understand it is getting the n=1 answer.
 *
 * Deliberately takes no `board` and no `scale`: everything positional it needs
 * is already in the obstacle set. That is what lets the layout cost function
 * share it.
 *
 * This lives in route-cables.ts rather than a new module on purpose.
 * `lane-spacing-authority.test.ts` asserts BY FILENAME that this file imports
 * LANE_SPACING from geometry and does not redefine it; moving the lane logic
 * elsewhere would satisfy that test while defeating its point.
 */
export function routeCablePaths(
  requests: LaneRouteRequest[],
  obstacles: ObstacleSet,
  options?: { laneRouter?: boolean }
): RoutedPath[] {
  const laneRouter = options?.laneRouter ?? USE_LANE_ROUTER;
  if (!laneRouter) return routeOnce(requests, obstacles, false);

  const { lanes: withLanes, cascade: plain } = routeBothWays(requests, obstacles);

  /*
   * THE CORRIDOR MODEL MUST NEVER DRAW A WORSE BOARD THAN THE CASCADE IT
   * REPLACED.
   *
   * The lane router coordinates runs so parallel cables sit in separate lanes,
   * which is better on some boards and worse on others: on a dense board its
   * coordinated detours can cross each other more often than the cascade's
   * independent routes do. That was a TOLERANCE in lane-router.test.ts ("no
   * more than one extra crossing"), which is a hope rather than a guarantee,
   * and it was breached the moment a board got harder.
   *
   * This guard was built and REVERTED once, on 2026-08-18, because it did not
   * work: where the lane router lost, the cascade's cheaper alternative
   * contained diagonal segments, and trading a crossing for a diagonal cable
   * is not a trade worth making. It works now because the cascade was made
   * orthogonal - the two pictures are finally comparable.
   *
   * "WORSE" MEANS THE WHOLE PICTURE - see compareRoutingOutcomes. Until
   * 2026-11-16 it meant crossings alone, and a guard that measures one thing
   * guarantees one thing.
   *
   * COST: two routing passes instead of one, on every derive AND inside the
   * optimizer's scoring loop. Paid in both places deliberately - scoring a
   * picture you do not draw is the P1.5 defect, and a guard that ran only when
   * drawing would rebuild it.
   */
  if (compareRoutingOutcomes(routingOutcome(withLanes), routingOutcome(plain), obstacles.scale) <= 0) {
    return withLanes;
  }

  // The cascade won. Cables the corridor SERVED are relabelled 'outrouted' so
  // that "strategy is lane-router exactly when the corridor served it" keeps
  // holding; a cable the corridor never served keeps the reason it failed,
  // which is what the canvas quotes when it explains a red cable.
  return plain.map((r, i) => {
    const outcome = withLanes[i]?.laneOutcome;
    const served = outcome === 'lane-routed' || outcome === 'shortcut';
    return { ...r, laneOutcome: served ? ('outrouted' as LaneOutcome) : outcome };
  });
}

/**
 * The same cables routed by each router on its own: the corridor model (with
 * the cascade as its per-cable fallback), and the cascade alone.
 *
 * routeCablePaths keeps one of these two and nothing else, so this is the
 * whole of what it chooses between. Exported so that choice can be CHECKED -
 * "the drawn board is never worse than either" is not testable when one of
 * the two candidates can only be seen on the boards where it won.
 */
export function routeBothWays(
  requests: LaneRouteRequest[],
  obstacles: ObstacleSet
): { lanes: RoutedPath[]; cascade: RoutedPath[] } {
  return {
    lanes: routeOnce(requests, obstacles, true),
    cascade: routeOnce(requests, obstacles, false),
  };
}

/**
 * How good a routed board is: the things a person can see wrong with one, in
 * the order they matter, and what its cables cost.
 */
export interface RoutingOutcome {
  /** Cables with no legal route: drawn red, through pedals. */
  invalid: number;
  /** Places one cable crosses another. */
  crossings: number;
  /**
   * Pairs of parallel runs from different cables close enough to read as one
   * line - the same definition the config-matrix lane invariant judges by.
   */
  laneConflicts: number;
  /**
   * Cables that needed a complex route - down a row corridor, over or under
   * everything, a search, or around the outside of the board. Whatever
   * isComplexRoute says, which is what the layout cost function charges for.
   */
  complexRoutes: number;
  /** Total drawn length, in pixels. */
  lengthPx: number;
}

/**
 * Length differences smaller than this are arithmetic, not routing: both
 * routers add up the same pixel segments in a different order. Below it the
 * two boards are the same length and the tie rule decides.
 */
const LENGTH_TIE_PX = 0.5;

export function routingOutcome(routed: RoutedPath[]): RoutingOutcome {
  const runs: Array<LaneSegment & { cable: number }> = [];
  let lengthPx = 0;
  routed.forEach((r, cable) => {
    for (let i = 0; i < r.path.length - 1; i++) {
      const a = r.path[i];
      const b = r.path[i + 1];
      lengthPx += Math.hypot(b.x - a.x, b.y - a.y);
      const seg = toLaneSegment(a, b);
      if (seg) runs.push({ ...seg, cable });
    }
  });

  let laneConflicts = 0;
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      if (a.cable === b.cable || a.horizontal !== b.horizontal) continue;
      if (Math.abs(a.fixed - b.fixed) >= LANE_TOLERANCE) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > MIN_PARALLEL_OVERLAP) laneConflicts++;
    }
  }

  return {
    invalid: routed.filter((r) => !r.valid).length,
    crossings: crossingCount(routed),
    laneConflicts,
    complexRoutes: routed.filter((r) => isComplexRoute(r.strategy)).length,
    lengthPx,
  };
}

/**
 * Which of two routings of the SAME cables is the better board.
 * Negative when `a` is better, positive when `b` is, zero when they tie.
 *
 * Judged in order, each one only breaking a tie on the one before:
 *
 *   1. invalid cables   a cable that cannot be wired outranks everything
 *   2. crossings        the thing the guard was built to protect
 *   3. lane conflicts   two runs drawn as one line - what the lane router is FOR
 *   4. cable cost       with everything else equal, the cheaper board: its
 *                       length, plus COMPLEX_ROUTE_PENALTY_INCHES for every
 *                       cable that needed a complex route
 *
 * Only crossings were compared until 2026-11-16, with every tie going to the
 * lane router. Measured that day over 216 boards, each router on its own:
 *
 *                         lane router    cascade
 *   total drawn length      14,228in     9,365in
 *   fewer crossings on      28 boards    88 boards     (tie on 100)
 *   lane conflicts               8            4
 *
 * On the 100 ties the lane router's board was more than 3in longer on 93 -
 * 19.4in on average - and on every one of those 93 the cascade had no lane
 * conflict at all. So the guard was keeping the longer drawing on boards
 * where the shorter one was just as clean. The three-pedal fixture shows the
 * shape of it: the guitar cable left the board, ran along underneath it and
 * came back, 20.1in where a plain L is 14.0in.
 *
 * And since finding 2 landed the same day, that length is no longer only a
 * picture: it is the cable the shopping list tells you to buy.
 *
 * Lane conflicts sit ABOVE cost on purpose. If they did not, the cascade
 * would win a board by stacking two cables on one line, which is shorter and
 * unreadable - the lane router's whole reason to exist is that case, and
 * there it still wins.
 *
 * WHY STEP 4 IS NOT BARE LENGTH - it was, for a few hours, and the first real
 * board through it showed why not. On the owner's nine-pedal board one layout
 * routed both ways tied on everything above:
 *
 *   lane router   65.1in, 3 crossings, every cable on the board
 *   cascade       54.1in, 3 crossings, THREE cables sent around the outside
 *
 * Bare length took the cascade: 11in shorter. But a cable around the outside
 * of the board is the cascade's own last resort, and the cost function
 * charges 10in for each - so the optimizer scored the picture it was handed
 * at 118.1 where the other was 89.1, concluded this layout was a poor one,
 * and settled on a different layout drawing 78.7in. Old code had drawn that
 * board at 65.1in. The router and the optimizer were each right by their own
 * rule and the rules disagreed.
 *
 * So when everything above ties, the two pictures are compared on exactly
 * what the cost function would then charge them: with invalid cables and
 * crossings level, that is length plus the complex-route penalty and nothing
 * else. The first three steps are deliberately NOT a weighted sum - "never
 * more crossings than either router alone" is a guarantee the owner asked
 * for, and a guarantee cannot be traded for inches.
 */
export function compareRoutingOutcomes(
  a: RoutingOutcome,
  b: RoutingOutcome,
  /** The scale the paths were routed at; converts the penalty into pixels. */
  pixelsPerInch: number = 40
): number {
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.crossings !== b.crossings) return a.crossings - b.crossings;
  if (a.laneConflicts !== b.laneConflicts) return a.laneConflicts - b.laneConflicts;
  const penaltyPx = COMPLEX_ROUTE_PENALTY_INCHES * pixelsPerInch;
  const cost =
    (a.lengthPx + a.complexRoutes * penaltyPx) - (b.lengthPx + b.complexRoutes * penaltyPx);
  return Math.abs(cost) < LENGTH_TIE_PX ? 0 : cost;
}

/** How many places do these paths cross each other? */
function crossingCount(routed: RoutedPath[]): number {
  return detectCableCrossings(
    routed.map((r, i) => ({ id: String(i), points: r.path }))
  ).length;
}

function routeOnce(
  requests: LaneRouteRequest[],
  obstacles: ObstacleSet,
  laneRouter: boolean
): RoutedPath[] {
  // Corridor-graph routing first (when enabled); nulls fall back below
  let lanePaths: Array<Point[] | null> = requests.map(() => null);
  let laneOutcomes: LaneOutcome[] | null = null;
  if (laneRouter) {
    const laneResult = routeCablesWithLanes(requests, obstacles);
    lanePaths = laneResult.paths;
    laneOutcomes = laneResult.diagnostics.outcomes;
  }

  const results: RoutedPath[] = [];
  const fallbackIndices = new Set<number>();

  requests.forEach((req, index) => {
    const lanePath = lanePaths[index];
    if (lanePath) {
      results.push({
        path: lanePath,
        strategy: 'lane-router',
        laneOutcome: laneOutcomes?.[index],
        valid: true,
        fromPedalId: req.fromPedalId,
        toPedalId: req.toPedalId,
      });
      return;
    }

    const result = routeCableWithObstacles(
      req.from,
      req.to,
      obstacles,
      req.fromPedalId,
      req.toPedalId
    );
    fallbackIndices.add(results.length);
    results.push({
      path: result.path,
      strategy: result.strategy,
      laneOutcome: laneOutcomes?.[index],
      valid: result.valid,
      validation: result.validation,
      fromPedalId: req.fromPedalId,
      toPedalId: req.toPedalId,
    });
  });

  // Spread overlapping parallel runs into adjacent lanes. Lane-routed
  // cables have coordinated lanes already and stay fixed; only fallback
  // cables shift around them.
  separateParallelRuns(results, obstacles, laneRouter ? fallbackIndices : undefined);

  return results;
}

/**
 * Route every cable for the current configuration.
 *
 * Endpoint resolution and Cable mapping only - the routing itself is
 * routeCablePaths. Note the asymmetry this wrapper owns: a cable whose
 * endpoints no longer resolve is silently dropped, so the returned array can
 * be shorter than `cables`.
 */

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

  const requests: LaneRouteRequest[] = resolved.map((r) => ({
    from: r.fromPos,
    to: r.toPos,
    fromPedalId: r.cable.fromPedalId ?? null,
    toPedalId: r.cable.toPedalId ?? null,
  }));

  const routed = routeCablePaths(requests, obstacles, { laneRouter });

  const results: RoutedCable[] = routed.map((rp, index) => ({
    ...rp,
    cable: resolved[index].cable,
    fromPos: resolved[index].fromPos,
    toPos: resolved[index].toPos,
  }));

  if (DEBUG_PATHS) {
    for (const rc of results) {
      const label = `${rc.cable.fromType}${rc.cable.fromPedalId ? `:${rc.cable.fromPedalId.slice(0, 6)}` : ''} → ${rc.cable.toType}${rc.cable.toPedalId ? `:${rc.cable.toPedalId.slice(0, 6)}` : ''}`;
      console.log(`[PATH] ${label} (${rc.path.length}pts, valid:${rc.valid}): ${rc.path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ')}`);
    }
  }

  return results;
}
