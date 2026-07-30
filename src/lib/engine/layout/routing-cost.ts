/**
 * Routing-Aware Cost Function
 *
 * Scores a candidate placement by routing every cable of the signal
 * topology (the same segments calculateCables emits - see ../topology)
 * through the shared routing pipeline, plus placement-quality penalties.
 *
 * Because both this scorer and the renderer consume the same topology and
 * the same router, the optimizer optimizes exactly what will be drawn.
 */

import type { Amp, Board, Pedal, PlacedPedal, RoutingConfig, PedalPlacement } from '@/types';
import { getExternalEndpointPx, getPedalJackPx } from '../cables/endpoints';
import {
  Point,
  Box,
  OBSTACLE_MARGIN,
  calculatePathLength,
  detectCableCrossings,
  dist,
} from '../pathfinding';
import { generateObstacles } from '../obstacles';
import { routeCableWithObstacles } from '../cables/routing-strategies';
import {
  deriveSignalTopology,
  primaryChain,
  type Anchor,
  type SignalTopology,
} from '../topology';

// Scale factor: 40 pixels per inch (matching the editor canvas)
const PIXELS_PER_INCH = 40;

// Penalty for each cable crossing (in inches)
const CROSSING_PENALTY_INCHES = 8;

// Minimum spacing between pedals for cable clearance (in pixels)
// Pedals closer than this will be penalized
const MIN_CABLE_CLEARANCE_PX = OBSTACLE_MARGIN * 2; // one cable lane between two margin zones

// Penalty per pedal pair that's too close (in inches)
// NOT too heavy - we want cable length to still matter
const SPACING_PENALTY_INCHES = 15;

// Penalty when a cable would have to go through a pedal (in inches)
const CABLE_COLLISION_PENALTY_INCHES = 50;

// Penalty when cable needs complex routing (channel/perimeter/A*) instead of simple L-path
const COMPLEX_ROUTING_PENALTY_INCHES = 10;

// Penalty for signal flow violations within a row (chain should read in one
// direction per segment). VERY HIGH to prevent breaking visual signal flow.
const SIGNAL_FLOW_PENALTY_INCHES = 100;

// Penalty for pedals not aligned to rows
const ROW_MISALIGNMENT_PENALTY_INCHES = 20;

// Re-export for backwards compatibility
export type { PedalPlacement };

/**
 * The dimensions a placement is scored on, in the order they are reported.
 *
 * This list is the SINGLE source of both the score and the explanation of the
 * score. `totalScore` is the sum of the dimension values - it is not computed
 * separately - so a rationale shown to the user cannot describe a ranking
 * different from the one that actually chose the layout. Adding a penalty
 * means adding a dimension here; there is no second list of labels to forget.
 */
export const COST_DIMENSIONS = [
  { key: 'cableLength', label: 'cable length', unit: 'inches' },
  { key: 'crossings', label: 'cable crossings', unit: 'count' },
  { key: 'spacing', label: 'pedals crowded together', unit: 'score' },
  { key: 'complexRouting', label: 'cables needing complex routing', unit: 'count' },
  { key: 'routingFailures', label: 'cables that cannot route cleanly', unit: 'count' },
  { key: 'signalFlow', label: 'signal-flow reversals', unit: 'score' },
  { key: 'rowAlignment', label: 'pedals off their row', unit: 'score' },
] as const;

export type CostDimensionKey = (typeof COST_DIMENSIONS)[number]['key'];

export interface CostDimension {
  key: CostDimensionKey;
  label: string;
  /** Contribution to totalScore, in inch-equivalents */
  value: number;
  /**
   * The countable thing behind the value (crossings, failing cables), when
   * one exists. Explanations prefer this because "2 fewer crossings" is
   * meaningful to a user and "16 less penalty" is not.
   */
  count?: number;
}

export interface RoutingCostResult {
  /** Total routed cable length in inches */
  totalLengthInches: number;
  /** Number of cable crossings detected */
  crossingCount: number;
  /** Total score: the sum of `dimensions` values, never computed separately */
  totalScore: number;
  /** Every scored dimension, in COST_DIMENSIONS order */
  dimensions: CostDimension[];
  /** Per-cable breakdown */
  cableDetails: Array<{
    fromId: string;
    toId: string;
    directDistance: number;
    routedDistance: number;
    path: Point[];
    /** Which routing strategy produced this path (see routing-strategies) */
    strategy: string;
  }>;
}

/**
 * Calculate the routing cost for a given placement configuration.
 */
export function calculateRoutingCost(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number = PIXELS_PER_INCH,
  useEffectsLoop: boolean = false,
  use4CableMethod: boolean = false,
  routingConfig?: RoutingConfig
): RoutingCostResult {
  const placementMap = new Map(placements.map(p => [p.id, p]));

  // Candidate positions applied to the pedals
  const tempPlacedPedals: PlacedPedal[] = placedPedals.map(placed => {
    const placement = placementMap.get(placed.id);
    if (!placement) return placed;
    return { ...placed, xInches: placement.x, yInches: placement.y };
  });
  const placedById = new Map(tempPlacedPedals.map((p) => [p.id, p]));

  const obstacles = generateObstacles(tempPlacedPedals, pedalsById, board, scale);
  const boxes = obstacles.boxes;

  // The cost function has no real Amp; the useEffectsLoop flag already
  // encodes "the loop participates" for scoring purposes.
  const pseudoAmp = useEffectsLoop ? ({ hasEffectsLoop: true } as Amp) : null;
  const topology = deriveSignalTopology(
    tempPlacedPedals, pedalsById, pseudoAmp, useEffectsLoop, use4CableMethod, routingConfig
  );

  // --- Route every segment cable through the shared pipeline ---------------
  const cableDetails: RoutingCostResult['cableDetails'] = [];
  const allPaths: Array<{ id: string; points: Point[] }> = [];
  let totalRoutedLength = 0;
  let complexRoutingPenalty = 0;
  let validationFailurePenalty = 0;
  let complexRoutingCount = 0;
  let validationFailureCount = 0;

  interface ResolvedAnchor { id: string; pos: Point; pedalId: string | null }

  const resolveAnchor = (anchor: Anchor): ResolvedAnchor => {
    if (anchor.kind === 'external') {
      return {
        id: anchor.type,
        pos: getExternalEndpointPx(anchor.type, board, scale, useEffectsLoop),
        pedalId: null,
      };
    }
    const placed = placedById.get(anchor.pedalId)!;
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    return {
      id: `${anchor.pedalId}:${anchor.jack}`,
      pos: pedal
        ? getPedalJackPx(placed, pedal, anchor.jack, scale)
        : { x: placed.xInches * scale, y: placed.yInches * scale },
      pedalId: anchor.pedalId,
    };
  };

  const jackPx = (placed: PlacedPedal, jackType: 'input' | 'output'): Point => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    return pedal
      ? getPedalJackPx(placed, pedal, jackType, scale)
      : { x: placed.xInches * scale, y: placed.yInches * scale };
  };

  const addCableRoute = (
    fromId: string, toId: string,
    fromPos: Point, toPos: Point,
    fromPedalId: string | null, toPedalId: string | null
  ) => {
    const result = routeCableWithObstacles(fromPos, toPos, obstacles, fromPedalId, toPedalId);
    const path = result.path;
    const routedDist = calculatePathLength(path) / scale;
    const directDist = dist(fromPos, toPos) / scale;

    if (path.length > 3) {
      complexRoutingPenalty += COMPLEX_ROUTING_PENALTY_INCHES;
      complexRoutingCount++;
    }
    if (!result.valid) {
      validationFailurePenalty += CABLE_COLLISION_PENALTY_INCHES * 2;
      validationFailureCount++;
    }

    cableDetails.push({
      fromId, toId, directDistance: directDist, routedDistance: routedDist, path,
      strategy: result.strategy,
    });
    allPaths.push({ id: `${fromId}-${toId}`, points: path });
    totalRoutedLength += routedDist;
  };

  for (const segment of topology.segments) {
    const from = resolveAnchor(segment.from);
    const to = resolveAnchor(segment.to);

    if (segment.pedals.length === 0) {
      addCableRoute(from.id, to.id, from.pos, to.pos, from.pedalId, to.pedalId);
      continue;
    }

    const first = segment.pedals[0];
    addCableRoute(from.id, first.id, from.pos, jackPx(placedById.get(first.id)!, 'input'), from.pedalId, first.id);

    for (let i = 0; i < segment.pedals.length - 1; i++) {
      const a = placedById.get(segment.pedals[i].id)!;
      const b = placedById.get(segment.pedals[i + 1].id)!;
      addCableRoute(a.id, b.id, jackPx(a, 'output'), jackPx(b, 'input'), a.id, b.id);
    }

    const last = segment.pedals[segment.pedals.length - 1];
    addCableRoute(last.id, to.id, jackPx(placedById.get(last.id)!, 'output'), to.pos, last.id, to.pedalId);
  }

  // --- Penalties ------------------------------------------------------------
  const crossings = detectCableCrossings(allPaths);
  const crossingPenalty = crossings.length * CROSSING_PENALTY_INCHES;
  const spacingPenalty = calculateSpacingPenalty(boxes);
  const signalFlowPenalty = calculateSignalFlowPenalty(topology, placedById, pedalsById);
  const rowAlignmentPenalty = calculateRowAlignmentPenalty(placements, board);

  // One list, in COST_DIMENSIONS order. totalScore is its sum - deriving both
  // from here is what stops a shown rationale from describing a different
  // ranking than the one that actually picked the layout.
  const byKey: Record<CostDimensionKey, { value: number; count?: number }> = {
    cableLength: { value: totalRoutedLength },
    crossings: { value: crossingPenalty, count: crossings.length },
    spacing: { value: spacingPenalty },
    complexRouting: { value: complexRoutingPenalty, count: complexRoutingCount },
    routingFailures: { value: validationFailurePenalty, count: validationFailureCount },
    signalFlow: { value: signalFlowPenalty },
    rowAlignment: { value: rowAlignmentPenalty },
  };
  const dimensions: CostDimension[] = COST_DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    ...byKey[d.key],
  }));

  return {
    totalLengthInches: totalRoutedLength,
    crossingCount: crossings.length,
    totalScore: dimensions.reduce((sum, d) => sum + d.value, 0),
    dimensions,
    cableDetails,
  };
}

/**
 * Calculate a penalty for pedals that are too close together.
 * This encourages the optimizer to leave room for cable routing channels.
 */
function calculateSpacingPenalty(boxes: Box[]): number {
  let penalty = 0;

  for (let i = 0; i < boxes.length; i++) {
    const boxA = boxes[i];
    if (boxA.width === 0 || boxA.height === 0) continue;

    for (let j = i + 1; j < boxes.length; j++) {
      const boxB = boxes[j];
      if (boxB.width === 0 || boxB.height === 0) continue;

      const gapX = Math.max(boxA.x, boxB.x) - Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
      const gapY = Math.max(boxA.y, boxB.y) - Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

      if (gapX > MIN_CABLE_CLEARANCE_PX || gapY > MIN_CABLE_CLEARANCE_PX) continue;

      const minGap = Math.max(gapX, gapY);
      if (minGap < MIN_CABLE_CLEARANCE_PX) {
        const severityMultiplier = 1 + (MIN_CABLE_CLEARANCE_PX - minGap) / MIN_CABLE_CLEARANCE_PX;
        penalty += SPACING_PENALTY_INCHES * severityMultiplier;
      }
    }
  }

  return penalty;
}

/**
 * Penalize signal-flow inversions WITHIN a row, per topology chain.
 * Every chain (the primary run and each cluster segment) should read
 * right-to-left within a row; row transitions are exempt (a wrap
 * legitimately reverses X).
 */
function calculateSignalFlowPenalty(
  topology: SignalTopology,
  placedById: Map<string, PlacedPedal>,
  pedalsById: Record<string, Pedal>
): number {
  const centerX = (p: PlacedPedal): number => {
    const pedal = pedalsById[p.pedalId] || p.pedal;
    const rot = p.rotationDegrees === 90 || p.rotationDegrees === 270;
    const width = pedal ? (rot ? pedal.depthInches : pedal.widthInches) : 2.87;
    return p.xInches + width / 2;
  };

  const chainPenalty = (chain: PlacedPedal[]): number => {
    let penalty = 0;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = placedById.get(chain[i].id);
      const b = placedById.get(chain[i + 1].id);
      if (!a || !b) continue;
      if (Math.abs(a.yInches - b.yInches) > 1) continue; // row transition
      const violation = centerX(b) - centerX(a); // next should be further LEFT
      if (violation > 0) {
        penalty += SIGNAL_FLOW_PENALTY_INCHES * (1 + violation / 5);
      }
    }
    return penalty;
  };

  let penalty = chainPenalty(primaryChain(topology));
  for (const segment of topology.segments) {
    // Cluster segments not covered by the primary run
    if (segment.id === 'front' || segment.id === 'before-hub') continue;
    if (topology.mode === '4cm' && segment.id === 'hub-loop') continue; // in primary
    if (topology.mode === 'pedal-loop' && segment.id === 'after-hub') continue; // in primary
    penalty += chainPenalty(segment.pedals);
  }
  return penalty;
}

/**
 * Calculate penalty for pedals not aligned to standard row positions.
 */
function calculateRowAlignmentPenalty(
  placements: PedalPlacement[],
  board: Board
): number {
  let penalty = 0;

  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  const rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05];

  for (const placement of placements) {
    let minDistance = Infinity;
    for (const rowY of rowYPositions) {
      minDistance = Math.min(minDistance, Math.abs(placement.y - rowY));
    }
    if (minDistance > 0.5) {
      penalty += ROW_MISALIGNMENT_PENALTY_INCHES * minDistance;
    }
  }

  return penalty;
}

// ============================================================================
// EXPLAINING A SCORE
// ============================================================================

export interface CostChange {
  key: CostDimensionKey;
  label: string;
  /** Score delta (negative = the new layout is better on this dimension) */
  delta: number;
  /** Count delta where the dimension has a countable thing, else undefined */
  countDelta?: number;
}

export interface OptimizationSummary {
  /** Total score before and after */
  before: number;
  after: number;
  /** Negative when optimizing helped */
  delta: number;
  /** Cable length change in inches (the number users care about most) */
  lengthDeltaInches: number;
  /** Dimensions that actually moved, biggest improvement first */
  changes: CostChange[];
  /** One line fit to show next to the Optimize button */
  headline: string;
}

/** Round to one decimal, avoiding "-0.0" */
function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
}

/**
 * Explain what optimizing changed, derived from the SAME dimension list that
 * produced the scores. There is no separate table of labels or thresholds to
 * drift: a dimension that moved is reported, one that did not is not, and the
 * headline is built from the top entries of that same list.
 *
 * Reports honestly when the layout got worse or did not change - an optimizer
 * that always claims an improvement is not worth reading.
 */
export function summarizeOptimization(
  before: RoutingCostResult,
  after: RoutingCostResult
): OptimizationSummary {
  const beforeByKey = new Map(before.dimensions.map((d) => [d.key, d]));

  const changes: CostChange[] = after.dimensions
    .map((d) => {
      const prev = beforeByKey.get(d.key);
      const delta = d.value - (prev?.value ?? 0);
      const countDelta =
        d.count !== undefined && prev?.count !== undefined ? d.count - prev.count : undefined;
      return { key: d.key, label: d.label, delta, countDelta };
    })
    // A dimension is "unchanged" only if neither its score nor its count moved
    .filter((c) => Math.abs(c.delta) > 0.05 || (c.countDelta ?? 0) !== 0)
    .sort((a, b) => a.delta - b.delta);

  const lengthDeltaInches =
    (after.dimensions.find((d) => d.key === 'cableLength')?.value ?? 0) -
    (before.dimensions.find((d) => d.key === 'cableLength')?.value ?? 0);

  const delta = after.totalScore - before.totalScore;

  // Phrase a change the way a person would say it
  const phrase = (c: CostChange): string => {
    const meta = COST_DIMENSIONS.find((d) => d.key === c.key)!;
    if (meta.unit === 'inches') {
      const inches = Math.abs(round1(c.delta));
      return `${inches}in ${c.delta < 0 ? 'less' : 'more'} ${c.label}`;
    }
    if (meta.unit === 'count' && c.countDelta) {
      const n = Math.abs(c.countDelta);
      return `${n} ${c.countDelta < 0 ? 'fewer' : 'more'} ${c.label}`;
    }
    // Score-only dimensions have no countable magnitude to quote, but every
    // label is a plural noun phrase, so "fewer/more" reads correctly.
    return `${c.delta < 0 ? 'fewer' : 'more'} ${c.label}`;
  };

  const sentence = (parts: string[]) => {
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  };

  let headline: string;
  if (changes.length === 0) {
    headline = 'Already optimal - nothing moved.';
  } else if (delta > 0.05) {
    // The rearrangement scored WORSE. Lead with what got worse - `changes` is
    // sorted best-first, so quoting changes[0] here would cherry-pick the one
    // improvement inside a net regression. The layout is still applied (undo
    // reverses it), so do not claim the previous one was kept.
    const worst = changes[changes.length - 1];
    headline = `Rearranged, but scored worse - ${phrase(worst)}. Undo to go back.`;
  } else {
    headline = sentence(changes.slice(0, 2).map(phrase));
  }

  return {
    before: before.totalScore,
    after: after.totalScore,
    delta,
    lengthDeltaInches,
    changes,
    headline,
  };
}
