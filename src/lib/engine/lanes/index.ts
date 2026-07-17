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
import { OBSTACLE_MARGIN, STANDOFF, isPathClear } from '../geometry';
import type { ObstacleSet } from '../obstacles';
import { getBoxForPedal } from '../obstacles';
import { getStandoffPoint } from '../pathfinding';

/** Preferred distance between adjacent lanes in a corridor */
const LANE_SPACING = 12;
/** Minimum squeezed lane spacing before a corridor counts as over capacity */
const MIN_LANE_SPACING = 9;
/** Cost added per corridor switch (a corner) */
const TURN_PENALTY = 30;
/** How far off-board the external columns and row corridors extend */
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

export interface LaneRouteResult {
  /** Routed paths in request order; null = corridor routing unavailable, caller falls back */
  paths: Array<Point[] | null>;
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

function assignLanes(corridors: Corridor[], traversals: Traversal[]): boolean {
  const byCorridor = new Map<number, Traversal[]>();
  for (const t of traversals) {
    if (!byCorridor.has(t.corridorId)) byCorridor.set(t.corridorId, []);
    byCorridor.get(t.corridorId)!.push(t);
  }

  for (const [corridorId, list] of byCorridor) {
    const corridor = corridors[corridorId];
    const width = corridor.hi - corridor.lo;
    const n = list.length;

    let spacing = LANE_SPACING;
    if (n > 1 && (n - 1) * spacing > width) {
      spacing = width / (n - 1);
      if (spacing < MIN_LANE_SPACING) return false; // over capacity
    }

    // Keep parallel flows parallel: order lanes by run midpoint
    list.sort((a, b) => (a.alongLo + a.alongHi) - (b.alongLo + b.alongHi));

    const center = (corridor.lo + corridor.hi) / 2;
    const first = center - ((n - 1) * spacing) / 2;
    list.forEach((t, i) => {
      t.lane = first + i * spacing;
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function routeCablesWithLanes(
  requests: LaneRouteRequest[],
  obstacles: ObstacleSet
): LaneRouteResult {
  const { corridors } = buildCorridors(obstacles);
  const paths: Array<Point[] | null> = requests.map(() => null);
  const planned: Array<PlannedRoute | null> = [];
  const traversals: Traversal[] = [];

  // --- Plan corridor sequences ------------------------------------------------
  requests.forEach((req, index) => {
    const fromBox = req.fromPedalId ? getBoxForPedal(req.fromPedalId, obstacles) : null;
    const toBox = req.toPedalId ? getBoxForPedal(req.toPedalId, obstacles) : null;
    const fromStub = getStandoffPoint(req.from, fromBox, STANDOFF);
    const toStub = getStandoffPoint(req.to, toBox, STANDOFF);

    // Facing-jack shortcut: nearly-touching stubs connect directly
    if (Math.abs(fromStub.x - toStub.x) < 1 && Math.abs(fromStub.y - toStub.y) <= 2 * STANDOFF + 1) {
      planned.push(null);
      paths[index] = dedupe([req.from, fromStub, toStub, req.to]);
      return;
    }
    if (Math.abs(fromStub.y - toStub.y) < 1 && Math.abs(fromStub.x - toStub.x) <= 2 * STANDOFF + 1) {
      planned.push(null);
      paths[index] = dedupe([req.from, fromStub, toStub, req.to]);
      return;
    }

    const startC = attachCorridor(corridors, fromStub);
    const goalC = attachCorridor(corridors, toStub);
    if (startC < 0 || goalC < 0) {
      planned.push(null);
      return;
    }

    const seq = findCorridorPath(corridors, startC, goalC, fromStub, toStub);
    if (!seq) {
      planned.push(null);
      return;
    }

    planned.push({ corridors: seq, from: req.from, fromStub, to: req.to, toStub });
  });

  // --- Register traversals for lane assignment --------------------------------
  planned.forEach((plan, index) => {
    if (!plan) return;
    plan.corridors.forEach((cid, i) => {
      const corridor = corridors[cid];
      // Approximate along-extent: from previous crossing to next crossing
      const prevPt = i === 0 ? plan.fromStub : crossingCenter(corridors[plan.corridors[i - 1]], corridor);
      const nextPt = i === plan.corridors.length - 1 ? plan.toStub : crossingCenter(corridor, corridors[plan.corridors[i + 1]]);
      const along = corridor.horizontal ? [prevPt.x, nextPt.x] : [prevPt.y, nextPt.y];
      traversals.push({
        cableIndex: index,
        corridorId: cid,
        alongLo: Math.min(along[0], along[1]),
        alongHi: Math.max(along[0], along[1]),
        lane: 0,
      });
    });
  });

  if (!assignLanes(corridors, traversals)) {
    // Corridor over capacity somewhere - let every planned cable fall back
    return { paths: paths.map((p) => p ?? null) };
  }

  // --- Realize geometry --------------------------------------------------------
  planned.forEach((plan, index) => {
    if (!plan) return;

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

    const path = dedupe(pts);

    // Shared validation policy (stub exemptions at the ends)
    const fromBoxIdx = requests[index].fromPedalId
      ? obstacles.pedalIdToBox.get(requests[index].fromPedalId!) ?? -1 : -1;
    const toBoxIdx = requests[index].toPedalId
      ? obstacles.pedalIdToBox.get(requests[index].toPedalId!) ?? -1 : -1;
    if (isPathClear(path, obstacles.boxes, { fromBoxIdx, toBoxIdx })) {
      paths[index] = path;
    }
  });

  return { paths };
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
