/**
 * Manhattan Lane Router (roadmap Phase 3)
 *
 * Routes cables through a CORRIDOR GRAPH derived from the placement instead
 * of per-cable pathfinding:
 *
 * - HORIZONTAL corridors: the free bands above/between/below pedal rows
 *   (extending off-board toward the amp and guitar)
 * - VERTICAL corridors: the gaps between adjacent pedals within a row, the
 *   row ends, and the off-board amp/guitar columns
 *
 * Each cable takes the cheapest corridor sequence (Dijkstra, length + turn
 * penalty). Lanes within a corridor are assigned AFTER all cables are
 * routed, at uniform spacing around the corridor center, ordered to keep
 * parallel flows parallel - so shared corridors render as tidy looms with
 * square corners by construction.
 *
 * Cables the corridor graph cannot serve (unreachable endpoints, corridor
 * over capacity, validation failure) return null and fall back to the
 * strategy router in routing-strategies.ts.
 */

import type { Point, Box } from '../geometry';
import { OBSTACLE_MARGIN, STANDOFF, LANE_SPACING, MIN_LANE_SPACING, isPathClear, manhattanize } from '../geometry';
import type { ObstacleSet } from '../obstacles';
import { getBoxForPedal } from '../obstacles';
import { getStandoffPoint } from '../pathfinding';

/** Cost added per corridor switch (a corner) */
const TURN_PENALTY = 30;
/**
 * How far off-board the external columns and row corridors extend.
 *
 * NOT the same quantity as route-cables' LANE_BOARD_OVERHANG (70) or
 * routing-strategies' BOARD_OVERHANG (16), despite the similar names -
 * audited 2026-07-30, deliberately left separate. Three different stages:
 * this sizes the corridor GRAPH, LANE_BOARD_OVERHANG clamps where a
 * lane-SHIFTED run may land, and BOARD_OVERHANG is the tolerance for
 * REJECTING a routed path. Do not collapse them into one constant.
 */
const OVERHANG = 64;

interface Corridor {
  id: number;
  horizontal: boolean;
  /** Usable perpendicular range (margins already applied) */
  lo: number;
  hi: number;
  /** Extent along the corridor */
  spanLo: number;
  spanHi: number;
  /** Ids of corridors this one connects to */
  neighbors: number[];
}

interface Traversal {
  cableIndex: number;
  corridorId: number;
  /** Along-coordinates of this cable's run through the corridor (for lane ordering) */
  alongLo: number;
  alongHi: number;
  /**
   * The furthest this run can possibly reach along the corridor, whichever
   * lanes its neighbours end up in.
   *
   * `alongLo`/`alongHi` say where the run ends if the corridors either side of
   * it seat this cable dead centre. They may not: a run in THIS corridor ends
   * on the cable's lane in the NEXT one, and that lane is not chosen yet. So
   * two runs cannot be said to miss each other on the nominal ends alone -
   * this is the range that is safe to reason with. See reachOf.
   */
  reachLo: number;
  reachHi: number;
  /** Where across the corridor this cable would run if it had it to itself - see preferredLane. */
  prefer: number;
  /** Assigned perpendicular lane coordinate (filled by assignLanes) */
  lane: number;
}

interface PlannedRoute {
  /** Corridor sequence from source stub to destination stub */
  corridors: number[];
  from: Point;
  fromStub: Point;
  to: Point;
  toStub: Point;
}

export interface LaneRouteRequest {
  from: Point;
  to: Point;
  fromPedalId: string | null;
  toPedalId: string | null;
}

/**
 * Why a cable did or did not get a corridor route.
 *
 * A null path used to mean any of four unrelated things, and downstream they
 * collapsed further: route-cables sees only `lanePath === null` and records
 * whichever fallback rung succeeded. So the strategy tally could say a cable
 * fell back but never why - and `evicted` is exactly the why that matters,
 * because it is the `assignLanes` cliff.
 */
export type LaneOutcome =
  /** Facing-jack shortcut: connected directly, never entered the corridor graph. */
  | 'shortcut'
  /** Seated in a lane and the realized geometry validated. */
  | 'lane-routed'
  /**
   * The corridor model routed this cable perfectly well, and the BOARD was
   * still drawn better without it - so the cascade's path is the one on
   * screen. Set by routeCablePaths' never-worse guard, which compares the two
   * routers on the whole picture - invalid cables, crossings, lane conflicts,
   * then length (see compareRoutingOutcomes) - and keeps the better one.
   *
   * A distinct value rather than reusing 'lane-routed', because the invariant
   * that a cable reports strategy 'lane-router' exactly when the corridor
   * served it has to keep holding. Here the corridor served it and lost.
   */
  | 'outrouted'
  /**
   * A standoff attaches to no corridor. Split by WHICH end, because that is the
   * whole diagnostic value: 6 of these on the `test` board looked alike and had
   * at least two different causes.
   *
   * Note a standoff OUTSIDE the board is legitimate and must attach: a pedal
   * with rear-edge jacks sits flush against the back rail and its plugs hang
   * over the edge, which is what people actually build. The corridor model
   * covers that deliberately (`minY - 40`, and the external columns).
   */
  | 'unattached-from'
  | 'unattached-to'
  | 'unattached-both'
  /** Corridors exist at both ends but no sequence connects them. */
  | 'no-corridor-path'
  /** Corridor over capacity - this cable lost its seat. THE CLIFF. */
  | 'evicted'
  /** A lane was seated; the realized path then hit a pedal. */
  | 'validation-failed';

/** A corridor that was asked to seat more cables SIDE BY SIDE than it can hold. */
interface CorridorPressure {
  corridorId: number;
  /** Lanes the corridor can seat at MIN_LANE_SPACING. */
  capacity: number;
  /**
   * The most cables that wanted the same stretch of it at once, before any
   * eviction - NOT how many cables used the corridor in total. Two cables at
   * opposite ends of a corridor demand one lane between them.
   */
  demanded: number;
  /** How many were evicted to bring demand within capacity. */
  evicted: number;
}

interface LaneDiagnostics {
  /** One per request, in request order. */
  outcomes: LaneOutcome[];
  /** Over-capacity corridors only. Empty means the cliff never fired. */
  pressure: CorridorPressure[];
  /** Cables evicted for capacity. Not the same as cables that fell back. */
  evictedCount: number;
}

export interface LaneRouteResult {
  /** Routed paths in request order; null = corridor routing unavailable, caller falls back */
  paths: Array<Point[] | null>;
  /**
   * Why each cable landed where it did, plus which corridors are over
   * subscribed. Purely observational - nothing here changes geometry.
   */
  diagnostics: LaneDiagnostics;
}

// ---------------------------------------------------------------------------
// Corridor model
// ---------------------------------------------------------------------------

interface Band {
  top: number;
  bottom: number;
  boxes: Box[];
  aboveCorridor: number;
  belowCorridor: number;
}

function buildCorridors(obstacles: ObstacleSet): { corridors: Corridor[]; bands: Band[] } {
  const { boxes, boardBounds } = obstacles;
  const corridors: Corridor[] = [];
  const valid = boxes.filter((b) => b.width > 0 && b.height > 0);

  // Cluster boxes into row bands by y-overlap (transitive)
  const sorted = [...valid].sort((a, b) => a.y - b.y);
  const bands: Band[] = [];
  for (const box of sorted) {
    const band = bands.find((bd) => box.y < bd.bottom && box.y + box.height > bd.top);
    if (band) {
      band.top = Math.min(band.top, box.y);
      band.bottom = Math.max(band.bottom, box.y + box.height);
      band.boxes.push(box);
    } else {
      bands.push({ top: box.y, bottom: box.y + box.height, boxes: [box], aboveCorridor: -1, belowCorridor: -1 });
    }
  }
  bands.sort((a, b) => a.top - b.top);

  const spanLo = boardBounds.minX - OVERHANG;
  const spanHi = boardBounds.maxX + OVERHANG;

  const addCorridor = (c: Omit<Corridor, 'id' | 'neighbors'>): number => {
    const id = corridors.length;
    corridors.push({ ...c, id, neighbors: [] });
    return id;
  };

  // Horizontal corridors: above the first band, between bands, below the last
  const yLimits: Array<{ lo: number; hi: number }> = [];
  if (bands.length === 0) {
    yLimits.push({ lo: boardBounds.minY - 40, hi: boardBounds.maxY + 40 });
  } else {
    yLimits.push({ lo: boardBounds.minY - 40, hi: bands[0].top - OBSTACLE_MARGIN });
    for (let i = 0; i < bands.length - 1; i++) {
      yLimits.push({ lo: bands[i].bottom + OBSTACLE_MARGIN, hi: bands[i + 1].top - OBSTACLE_MARGIN });
    }
    yLimits.push({ lo: bands[bands.length - 1].bottom + OBSTACLE_MARGIN, hi: boardBounds.maxY + 40 });
  }

  const hIds: number[] = [];
  yLimits.forEach((range) => {
    if (range.hi - range.lo < 2) {
      hIds.push(-1); // unusable (e.g., rows too close) - no corridor here
      return;
    }
    hIds.push(addCorridor({ horizontal: true, lo: range.lo, hi: range.hi, spanLo, spanHi }));
  });

  bands.forEach((band, i) => {
    band.aboveCorridor = hIds[i];
    band.belowCorridor = hIds[i + 1];
  });

  // Vertical corridors: gaps within each band (+ row ends)
  for (const band of bands) {
    const rowBoxes = [...band.boxes].sort((a, b) => a.x - b.x);
    const gaps: Array<{ lo: number; hi: number }> = [];

    // Left end of the row (toward the amp)
    gaps.push({ lo: boardBounds.minX - 20, hi: rowBoxes[0].x - OBSTACLE_MARGIN });
    for (let i = 0; i < rowBoxes.length - 1; i++) {
      const a = rowBoxes[i];
      const b = rowBoxes[i + 1];
      const lo = a.x + a.width + OBSTACLE_MARGIN;
      const hi = b.x - OBSTACLE_MARGIN;
      if (hi > lo + 1) gaps.push({ lo, hi });
    }
    const last = rowBoxes[rowBoxes.length - 1];
    gaps.push({ lo: last.x + last.width + OBSTACLE_MARGIN, hi: boardBounds.maxX + 20 });

    for (const gap of gaps) {
      if (gap.hi - gap.lo < 2) continue;
      const id = addCorridor({
        horizontal: false,
        lo: gap.lo,
        hi: gap.hi,
        spanLo: band.top,
        spanHi: band.bottom,
      });
      if (band.aboveCorridor >= 0) connect(corridors, id, band.aboveCorridor);
      if (band.belowCorridor >= 0) connect(corridors, id, band.belowCorridor);
    }
  }

  // External columns (amp left, guitar right): vertical corridors spanning
  // everything, connecting all horizontal corridors
  const leftCol = addCorridor({
    horizontal: false,
    lo: boardBounds.minX - OVERHANG,
    hi: boardBounds.minX - 22,
    spanLo: boardBounds.minY - 40,
    spanHi: boardBounds.maxY + 40,
  });
  const rightCol = addCorridor({
    horizontal: false,
    lo: boardBounds.maxX + 22,
    hi: boardBounds.maxX + OVERHANG,
    spanLo: boardBounds.minY - 40,
    spanHi: boardBounds.maxY + 40,
  });
  for (const id of hIds) {
    if (id < 0) continue;
    connect(corridors, leftCol, id);
    connect(corridors, rightCol, id);
  }

  return { corridors, bands };
}

function connect(corridors: Corridor[], a: number, b: number): void {
  if (!corridors[a].neighbors.includes(b)) corridors[a].neighbors.push(b);
  if (!corridors[b].neighbors.includes(a)) corridors[b].neighbors.push(a);
}

/** Center of the crossing region between two connected corridors */
function crossingCenter(a: Corridor, b: Corridor): Point {
  const v = a.horizontal ? b : a;
  const h = a.horizontal ? a : b;
  return {
    x: (Math.max(v.lo, h.spanLo) + Math.min(v.hi, h.spanHi)) / 2,
    y: (Math.max(h.lo, v.spanLo) + Math.min(h.hi, v.spanHi)) / 2,
  };
}

// ---------------------------------------------------------------------------
// Endpoint attachment
// ---------------------------------------------------------------------------

/**
 * Which corridor does this stub tip sit in (or point into)?
 */
function attachCorridor(corridors: Corridor[], stub: Point): number {
  let best = -1;
  let bestDist = Infinity;
  for (const c of corridors) {
    const inPerp = c.horizontal
      ? stub.y >= c.lo && stub.y <= c.hi
      : stub.x >= c.lo && stub.x <= c.hi;
    const inSpan = c.horizontal
      ? stub.x >= c.spanLo && stub.x <= c.spanHi
      : stub.y >= c.spanLo && stub.y <= c.spanHi;
    if (inPerp && inSpan) return c.id;
    // Near-miss: stub points toward the corridor (within a standoff's reach)
    if (inSpan) {
      const dist = c.horizontal
        ? Math.max(c.lo - stub.y, stub.y - c.hi)
        : Math.max(c.lo - stub.x, stub.x - c.hi);
      if (dist > 0 && dist <= STANDOFF + OBSTACLE_MARGIN && dist < bestDist) {
        bestDist = dist;
        best = c.id;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Corridor-graph Dijkstra
// ---------------------------------------------------------------------------

function findCorridorPath(
  corridors: Corridor[],
  start: number,
  goal: number,
  startPoint: Point,
  goalPoint: Point
): number[] | null {
  if (start === goal) return [start];

  interface Node { corridor: number; cost: number; prev: number | null; point: Point }
  const bestCost = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: Node[] = [{ corridor: start, cost: 0, prev: null, point: startPoint }];
  bestCost.set(start, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.corridor === goal) {
      const path: number[] = [goal];
      let at = goal;
      while (prev.has(at)) {
        at = prev.get(at)!;
        path.unshift(at);
      }
      return path;
    }
    if (current.cost > (bestCost.get(current.corridor) ?? Infinity)) continue;

    for (const next of corridors[current.corridor].neighbors) {
      const cross = crossingCenter(corridors[current.corridor], corridors[next]);
      const stepCost =
        Math.abs(cross.x - current.point.x) + Math.abs(cross.y - current.point.y) + TURN_PENALTY;
      const total = current.cost + stepCost +
        (next === goal ? Math.abs(goalPoint.x - cross.x) + Math.abs(goalPoint.y - cross.y) : 0);
      if (total < (bestCost.get(next) ?? Infinity)) {
        bestCost.set(next, total);
        prev.set(next, current.corridor);
        queue.push({ corridor: next, cost: total, prev: current.corridor, point: cross });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lane assignment
// ---------------------------------------------------------------------------

/** How many lanes a corridor can seat before runs would visually merge. */
function corridorCapacity(corridor: Corridor): number {
  const width = corridor.hi - corridor.lo;
  return Math.max(1, Math.floor(width / MIN_LANE_SPACING) + 1);
}

/**
 * How far inside a corridor's edge a lane may sit, in pixels. A corridor's
 * edges are EXACTLY one margin from the pedals either side, and the validation
 * policy counts a run on the margin as touching - so a lane on the edge is an
 * illegal lane. Half a pixel clears it.
 */
const LANE_EDGE_INSET = 0.5;

/** The band of a corridor lanes may occupy. A corridor too thin to inset keeps its centre line. */
function laneBand(corridor: Corridor): [number, number] {
  const inset = Math.min(LANE_EDGE_INSET, (corridor.hi - corridor.lo) / 2);
  return [corridor.lo + inset, corridor.hi - inset];
}

/**
 * Where across a corridor a cable would run if it had the corridor to itself.
 *
 * A cable's length does not depend on where it crosses a corridor so long as
 * that is somewhere BETWEEN its two ends, measured across the corridor: any
 * such line costs the same, and any line outside that span costs twice the
 * overshoot. So the cable has a span of free positions, and this picks the
 * one nearest the corridor's centre line - away from the pedals - or, when the
 * span misses the corridor altogether, the edge nearest to it.
 *
 * Lanes used to be laid out around the centre line regardless. A corridor is
 * often much wider than a cable needs - the strip above the back row runs
 * from 40px off the board to the pedals - and its centre can be far from
 * where the cable is going. On the three-pedal fixture that put the amp cable
 * at y=123 on its way to a jack at y=250: up, across, and back down the face
 * of the amp.
 */
function preferredLane(corridor: Corridor, from: Point, to: Point): number {
  const across = (p: Point) => (corridor.horizontal ? p.y : p.x);
  const [lo, hi] = laneBand(corridor);
  const spanLo = Math.min(across(from), across(to));
  const spanHi = Math.max(across(from), across(to));
  if (spanHi < lo) return lo;
  if (spanLo > hi) return hi;
  const center = (corridor.lo + corridor.hi) / 2;
  return Math.min(Math.max(center, Math.max(lo, spanLo)), Math.min(hi, spanHi));
}

/**
 * Seat one lane per cable, each as near its preferred line as the others allow.
 *
 * `list` is in the order the lanes must keep across the corridor (by run
 * midpoint - what keeps parallel flows parallel). Walk it once pushing each
 * lane at least a spacing clear of the one before, then walk back pulling any
 * that overshot the far edge into the corridor.
 */
function placeByPreference(corridor: Corridor, list: Traversal[]): void {
  const n = list.length;
  let [lo, hi] = laneBand(corridor);
  let spacing = LANE_SPACING;
  if (n > 1 && (n - 1) * spacing > hi - lo) {
    // Too many for full spacing: use the whole corridor, edge to edge, as the
    // centred layout always has. Guaranteed >= MIN_LANE_SPACING - eviction ran.
    [lo, hi] = [corridor.lo, corridor.hi];
    spacing = (hi - lo) / (n - 1);
  }
  for (let i = 0; i < n; i++) {
    const least = i === 0 ? lo : list[i - 1].lane + spacing;
    list[i].lane = Math.max(least, Math.min(list[i].prefer, hi));
  }
  for (let i = n - 1; i >= 0; i--) {
    const most = i === n - 1 ? hi : list[i + 1].lane - spacing;
    list[i].lane = Math.min(list[i].lane, most);
  }
}

/**
 * Two runs may share a lane only with at least this much clear corridor
 * between the end of one and the start of the other, in pixels. Less than
 * that and they read as one cable with a nick in it.
 */
const SHARED_LANE_GAP = MIN_LANE_SPACING;

/** Do these two runs need different lanes? */
function contend(a: Traversal, b: Traversal): boolean {
  return a.reachLo - b.reachHi < SHARED_LANE_GAP && b.reachLo - a.reachHi < SHARED_LANE_GAP;
}

/**
 * The runs wanting the busiest stretch of one corridor at the same time.
 *
 * Runs along a corridor are intervals, and intervals that pairwise overlap all
 * share a common point - so the biggest set that must each have its own lane
 * is simply the deepest pile-up along the corridor, found by walking the
 * interval ends in order. Its size is the number of lanes the corridor needs.
 */
function busiestStretch(list: Traversal[]): Traversal[] {
  // Each run claims its reach plus half the shared-lane gap either side, so
  // two claims overlap exactly when the runs contend.
  const pad = SHARED_LANE_GAP / 2;
  const starts = [...list].sort((a, b) => (a.reachLo - b.reachLo) || (a.cableIndex - b.cableIndex));
  let best: Traversal[] = [];
  for (const candidate of starts) {
    const at = candidate.reachLo - pad;
    // Strict on the far side: claims that only touch do not contend.
    const here = list.filter((t) => t.reachLo - pad <= at && at < t.reachHi + pad);
    if (here.length > best.length) best = here;
  }
  return best;
}

/**
 * Seat every cable's runs in a lane, evicting only what genuinely will not fit.
 *
 * This used to return a boolean, and ONE over-capacity corridor anywhere on the
 * board discarded the lane assignment for EVERY cable. That is a step
 * discontinuity worth ~100 x nCables between two candidate layouts that differ
 * by a quarter inch of pedal position - tolerable while only the renderer used
 * this, and not tolerable once the layout cost function scores through it
 * (P1.5). Measured on the real Classic Jr board it meant 1 of 11 cables served.
 *
 * Then it evicted per corridor, which fixed the cliff and left a smaller one:
 * CAPACITY WAS COUNTED PER CORRIDOR, NOT PER STRETCH OF IT. A corridor's
 * capacity is how many cables fit side by side, and it was compared against
 * how many cables used the corridor anywhere along its length. The corridor
 * between two rows runs the whole width of the board and, at the designed
 * 14px, seats one lane - so it carried one cable, total, however far apart
 * the cables were. Measured on 2026-11-16: two cables hopping rows at opposite
 * ends of a 32in board, 890px apart, and one was evicted for want of a lane
 * the other was not using.
 *
 * Now a corridor is over capacity only where more cables want the same STRETCH
 * than it has lanes. Where a corridor has more cables than lanes but they do
 * not all meet, the ones that do not meet share a lane instead of one of them
 * being evicted.
 *
 * Eviction takes the shortest run out of the busiest stretch: a cable barely
 * clipping a corridor loses least by routing around it, while one running its
 * whole length depends on it - and evicting a cable that is not in the pile-up
 * would not relieve it. Ties break on cableIndex so the result is
 * deterministic - config-matrix asserts determinism and idempotence, and a Set
 * iteration order would quietly violate both.
 *
 * @returns the cable indices that could not be seated and must fall back, plus
 *          the corridors that were over capacity. The pressure record is what
 *          makes the cliff observable: an eviction count alone says the board
 *          is crowded, while pressure says WHERE, which is the difference
 *          between a symptom and a diagnosis.
 */
function assignLanes(
  corridors: Corridor[],
  traversals: Traversal[]
): { evicted: Set<number>; pressure: CorridorPressure[] } {
  const evicted = new Set<number>();
  const evictedFrom = new Map<number, number>();

  const groupRemaining = (): Map<number, Traversal[]> => {
    const byCorridor = new Map<number, Traversal[]>();
    for (const t of traversals) {
      if (evicted.has(t.cableIndex)) continue;
      if (!byCorridor.has(t.corridorId)) byCorridor.set(t.corridorId, []);
      byCorridor.get(t.corridorId)!.push(t);
    }
    return byCorridor;
  };

  /** Peak demand per corridor BEFORE any eviction, so pressure is not self-erasing. */
  const initialDemand = new Map<number, number>();
  for (const [corridorId, list] of groupRemaining()) {
    initialDemand.set(corridorId, busiestStretch(list).length);
  }

  // Evicting a cable removes it from EVERY corridor it crossed, which can
  // relieve pressure elsewhere, so this has to re-check rather than sweep once.
  for (;;) {
    const byCorridor = groupRemaining();
    let worst: { corridorId: number; over: number; pileUp: Traversal[] } | null = null;

    for (const corridorId of [...byCorridor.keys()].sort((a, b) => a - b)) {
      const pileUp = busiestStretch(byCorridor.get(corridorId)!);
      const over = pileUp.length - corridorCapacity(corridors[corridorId]);
      if (over > 0 && (!worst || over > worst.over)) worst = { corridorId, over, pileUp };
    }
    if (!worst) break;

    const victim = [...worst.pileUp].sort((a, b) => {
      const lenA = a.alongHi - a.alongLo;
      const lenB = b.alongHi - b.alongLo;
      return lenA !== lenB ? lenA - lenB : a.cableIndex - b.cableIndex;
    })[0];
    evicted.add(victim.cableIndex);
    evictedFrom.set(worst.corridorId, (evictedFrom.get(worst.corridorId) ?? 0) + 1);
  }

  for (const [corridorId, list] of groupRemaining()) {
    const corridor = corridors[corridorId];
    const width = corridor.hi - corridor.lo;
    const capacity = corridorCapacity(corridor);

    // Give each run the lowest-numbered lane no contending run already has.
    const seat = (order: Traversal[]): { track: Map<Traversal, number>; used: number } => {
      const track = new Map<Traversal, number>();
      let used = 0;
      for (const t of order) {
        const taken = new Set<number>();
        for (const [other, k] of track) if (contend(t, other)) taken.add(k);
        let k = 0;
        while (taken.has(k)) k++;
        track.set(t, k);
        used = Math.max(used, k + 1);
      }
      return { track, used };
    };

    // Keep parallel flows parallel: order by run midpoint.
    //
    // The cableIndex tie-break is a no-op TODAY - traversals are pushed in
    // cable order, so a stable sort already leaves equal midpoints in that
    // order - and it is here so it stays a no-op. Two cables sharing a
    // midpoint decide which lane each gets, i.e. what is drawn, and leaving
    // that to the incoming array order is how the chain-order bug worked.
    list.sort((a, b) =>
      ((a.alongLo + a.alongHi) - (b.alongLo + b.alongHi)) || (a.cableIndex - b.cableIndex));

    let seated: { track: Map<Traversal, number>; used: number };
    if (list.length <= capacity) {
      /*
       * ROOM FOR EVERYONE: one lane each, in midpoint order, exactly as it has
       * always been - even for runs that never meet and COULD share.
       *
       * Sharing wherever it is possible was built first and measured, and it
       * is worse. Putting two runs on one line frees a lane nobody needed and
       * throws away the ordering: which side of its neighbours a run sits on
       * is what keeps its two legs from crossing them. Over 216 boards the
       * lane router's own crossings went from 307 to 410 and the boards it
       * gave the better picture on from 34 to 27.
       *
       * So a lane is shared only when the alternative is evicting a cable.
       */
      placeByPreference(corridor, list);
      continue;
    } else {
      // More cables than lanes, but never more than `capacity` of them in the
      // same stretch (eviction saw to that): runs that do not meet share.
      seated = seat(list);

      // Midpoint order is the pretty one, not the frugal one: on runs that
      // only partly overlap it can spend a lane more than the pile-up needs.
      // When that does not fit, seat in order of where each run STARTS, which
      // never uses more lanes than the busiest stretch.
      if (seated.used > capacity) {
        seated = seat([...list].sort((a, b) => (a.reachLo - b.reachLo) || (a.cableIndex - b.cableIndex)));
      }
    }

    const lanes = seated.used;
    let spacing = LANE_SPACING;
    if (lanes > 1 && (lanes - 1) * spacing > width) {
      // Guaranteed >= MIN_LANE_SPACING now: eviction ran first.
      spacing = width / (lanes - 1);
    }
    const center = (corridor.lo + corridor.hi) / 2;
    const first = center - ((lanes - 1) * spacing) / 2;
    for (const t of list) t.lane = first + seated.track.get(t)! * spacing;
  }

  // Only corridors that were genuinely over subscribed. Reported against
  // INITIAL demand: evicting a cable removes it from every corridor it crossed,
  // so measuring afterwards would show a corridor at capacity and hide that it
  // was the one that caused the eviction.
  const pressure: CorridorPressure[] = [];
  for (const corridorId of [...initialDemand.keys()].sort((a, b) => a - b)) {
    const demanded = initialDemand.get(corridorId)!;
    const capacity = corridorCapacity(corridors[corridorId]);
    if (demanded > capacity) {
      pressure.push({
        corridorId,
        capacity,
        demanded,
        evicted: evictedFrom.get(corridorId) ?? 0,
      });
    }
  }

  return { evicted, pressure };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * The stub exemptions isPathClear needs: a cable is allowed to touch the two
 * pedals it terminates on. Shared by the facing-jack shortcut and the realize
 * loop so both are held to one policy - they were the same expression written
 * twice, which is how the shortcut came to skip validation entirely.
 */
function endpointBoxes(req: LaneRouteRequest, obstacles: ObstacleSet) {
  return {
    fromBoxIdx: req.fromPedalId ? obstacles.pedalIdToBox.get(req.fromPedalId) ?? -1 : -1,
    toBoxIdx: req.toPedalId ? obstacles.pedalIdToBox.get(req.toPedalId) ?? -1 : -1,
  };
}

export function routeCablesWithLanes(
  requests: LaneRouteRequest[],
  obstacles: ObstacleSet
): LaneRouteResult {
  const { corridors } = buildCorridors(obstacles);
  const paths: Array<Point[] | null> = requests.map(() => null);
  const planned: Array<PlannedRoute | null> = [];
  const traversals: Traversal[] = [];
  // Every cable ends up with exactly one of these. Seeded pessimistically so a
  // path that is never reached cannot be silently reported as a success.
  const outcomes: LaneOutcome[] = requests.map(() => 'no-corridor-path');

  // --- Plan corridor sequences ------------------------------------------------
  requests.forEach((req, index) => {
    const fromBox = req.fromPedalId ? getBoxForPedal(req.fromPedalId, obstacles) : null;
    const toBox = req.toPedalId ? getBoxForPedal(req.toPedalId, obstacles) : null;
    const fromStub = getStandoffPoint(req.from, fromBox, STANDOFF);
    const toStub = getStandoffPoint(req.to, toBox, STANDOFF);

    // Facing-jack shortcut: nearly-touching stubs connect directly.
    //
    // Collinearity and proximity say the two standoffs face each other; they
    // say NOTHING about what sits between them. Every other path this function
    // returns is checked by isPathClear in the realize loop below, and callers
    // stamp the whole batch `valid: true` on the strength of that. An
    // unchecked path here is therefore not a shortcut but an unearned
    // guarantee - and it becomes a scoring error the moment the layout cost
    // function shares this router. Check it on the same policy, and fall
    // through to the corridor graph when it does not hold.
    const collinearX = Math.abs(fromStub.x - toStub.x) < 1
      && Math.abs(fromStub.y - toStub.y) <= 2 * STANDOFF + 1;
    const collinearY = Math.abs(fromStub.y - toStub.y) < 1
      && Math.abs(fromStub.x - toStub.x) <= 2 * STANDOFF + 1;
    if (collinearX || collinearY) {
      const direct = dedupe([req.from, fromStub, toStub, req.to]);
      if (isPathClear(direct, obstacles.boxes, endpointBoxes(requests[index], obstacles))) {
        planned.push(null);
        paths[index] = direct;
        outcomes[index] = 'shortcut';
        return;
      }
    }

    const startC = attachCorridor(corridors, fromStub);
    const goalC = attachCorridor(corridors, toStub);
    if (startC < 0 || goalC < 0) {
      planned.push(null);
      outcomes[index] =
        startC < 0 && goalC < 0 ? 'unattached-both'
        : startC < 0 ? 'unattached-from'
        : 'unattached-to';
      return;
    }

    const seq = findCorridorPath(corridors, startC, goalC, fromStub, toStub);
    if (!seq) {
      planned.push(null);
      outcomes[index] = 'no-corridor-path';
      return;
    }

    planned.push({ corridors: seq, from: req.from, fromStub, to: req.to, toStub });
  });

  // --- Register traversals for lane assignment --------------------------------
  // Each cable's preferred lane in each corridor it crosses, and per corridor
  // the spread of those preferences - needed before any run's reach can be
  // stated, see laneRange.
  const preferIn = new Map<string, number>();
  const wanted = new Map<number, { lo: number; hi: number; count: number }>();
  planned.forEach((plan, index) => {
    if (!plan) return;
    plan.corridors.forEach((cid, i) => {
      const prefer = preferredLane(corridors[cid], plan.fromStub, plan.toStub);
      preferIn.set(`${index}:${i}`, prefer);
      const w = wanted.get(cid);
      if (!w) wanted.set(cid, { lo: prefer, hi: prefer, count: 1 });
      else { w.lo = Math.min(w.lo, prefer); w.hi = Math.max(w.hi, prefer); w.count++; }
    });
  });

  /**
   * Where a cable's lane in `corridor` can end up, before lanes are assigned.
   *
   * Every lane starts from a preferred line and is moved only to keep clear
   * of the others, each of which can push it by at most one spacing. So with
   * n cables wanting the corridor, every lane lies within (n - 1) spacings of
   * the span their preferences cover - and a cable alone in a corridor is
   * known to sit exactly on its preferred line.
   */
  const laneRange = (corridor: Corridor): [number, number] => {
    const w = wanted.get(corridor.id);
    if (!w) return [corridor.lo, corridor.hi];
    const slack = (w.count - 1) * LANE_SPACING;
    return [Math.max(corridor.lo, w.lo - slack), Math.min(corridor.hi, w.hi + slack)];
  };

  planned.forEach((plan, index) => {
    if (!plan) return;
    plan.corridors.forEach((cid, i) => {
      const corridor = corridors[cid];
      const first = i === 0;
      const last = i === plan.corridors.length - 1;
      const stubAlong = (stub: Point) => (corridor.horizontal ? stub.x : stub.y);

      // Approximate along-extent: from previous crossing to next crossing
      const prevPt = first ? plan.fromStub : crossingCenter(corridors[plan.corridors[i - 1]], corridor);
      const nextPt = last ? plan.toStub : crossingCenter(corridor, corridors[plan.corridors[i + 1]]);
      const along = corridor.horizontal ? [prevPt.x, nextPt.x] : [prevPt.y, nextPt.y];

      // A run starts on the cable's lane in the corridor it came from and ends
      // on its lane in the corridor it turns into (corridors alternate
      // orientation, so a neighbour's lane IS a position along this one). At
      // the two ends of the cable it starts or ends on the stub, exactly.
      const entry: [number, number] = first
        ? [stubAlong(plan.fromStub), stubAlong(plan.fromStub)]
        : laneRange(corridors[plan.corridors[i - 1]]);
      const exit: [number, number] = last
        ? [stubAlong(plan.toStub), stubAlong(plan.toStub)]
        : laneRange(corridors[plan.corridors[i + 1]]);

      traversals.push({
        cableIndex: index,
        corridorId: cid,
        alongLo: Math.min(along[0], along[1]),
        alongHi: Math.max(along[0], along[1]),
        reachLo: Math.min(entry[0], exit[0]),
        reachHi: Math.max(entry[1], exit[1]),
        prefer: preferIn.get(`${index}:${i}`)!,
        lane: 0,
      });
    });
  });

  // Cables the corridors could not seat. They fall back individually; the rest
  // keep their lanes. This used to be all-or-nothing for the whole board.
  const { evicted, pressure } = assignLanes(corridors, traversals);
  for (const index of evicted) outcomes[index] = 'evicted';

  // --- Realize geometry --------------------------------------------------------
  planned.forEach((plan, index) => {
    if (!plan || evicted.has(index)) return;

    const lanes = plan.corridors.map(
      (cid) => traversals.find((t) => t.cableIndex === index && t.corridorId === cid)!.lane
    );

    const pts: Point[] = [plan.from, plan.fromStub];
    let cursor = { ...plan.fromStub };

    for (let i = 0; i < plan.corridors.length; i++) {
      const corridor = corridors[plan.corridors[i]];
      const lane = lanes[i];

      // Jog onto this corridor's lane (perpendicular coordinate)
      if (corridor.horizontal) {
        if (Math.abs(cursor.y - lane) > 0.5) {
          cursor = { x: cursor.x, y: lane };
          pts.push({ ...cursor });
        }
      } else {
        if (Math.abs(cursor.x - lane) > 0.5) {
          cursor = { x: lane, y: cursor.y };
          pts.push({ ...cursor });
        }
      }

      // Travel along the corridor toward the next hop (or the destination)
      const targetAlong = i === plan.corridors.length - 1
        ? (corridor.horizontal ? plan.toStub.x : plan.toStub.y)
        : (corridors[plan.corridors[i + 1]].horizontal
            ? lanes[i + 1] // next is horizontal: its lane is a y - not along for us
            : lanes[i + 1]);

      if (corridor.horizontal) {
        // Along = x. Next corridor is vertical with lane = x position
        const x = i === plan.corridors.length - 1 ? plan.toStub.x : targetAlong;
        if (Math.abs(cursor.x - x) > 0.5) {
          cursor = { x, y: cursor.y };
          pts.push({ ...cursor });
        }
      } else {
        const y = i === plan.corridors.length - 1 ? plan.toStub.y : targetAlong;
        if (Math.abs(cursor.y - y) > 0.5) {
          cursor = { x: cursor.x, y };
          pts.push({ ...cursor });
        }
      }
    }

    // Final jog to the destination stub, then the jack
    if (Math.abs(cursor.x - plan.toStub.x) > 0.5 || Math.abs(cursor.y - plan.toStub.y) > 0.5) {
      // One orthogonal jog: prefer matching the last corridor's orientation
      const lastCorr = corridors[plan.corridors[plan.corridors.length - 1]];
      if (lastCorr.horizontal) {
        pts.push({ x: plan.toStub.x, y: cursor.y });
      } else {
        pts.push({ x: cursor.x, y: plan.toStub.y });
      }
    }
    pts.push(plan.toStub, plan.to);

    // The corridor model is Manhattan by construction, but the STUB segments
    // at each end are not: an external endpoint's standoff is offset along one
    // axis while its corridor lane sits on another, so moving corridor
    // positions can leave a diagonal like (-60,250)->(-50,262). Insert the
    // missing elbow rather than emitting a diagonal - a diagonal cable both
    // looks wrong and defeats the lane model's overlap reasoning.
    const path = dedupe(manhattanize(pts));

    // Shared validation policy (stub exemptions at the ends)
    if (isPathClear(path, obstacles.boxes, endpointBoxes(requests[index], obstacles))) {
      paths[index] = path;
      outcomes[index] = 'lane-routed';
    } else {
      outcomes[index] = 'validation-failed';
    }
  });

  return {
    paths,
    diagnostics: { outcomes, pressure, evictedCount: evicted.size },
  };
}

function dedupe(path: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of path) {
    const last = result[result.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) {
      result.push(p);
    }
  }
  return result;
}
