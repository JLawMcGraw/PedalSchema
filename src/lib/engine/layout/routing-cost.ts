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

export interface RoutingCostResult {
  /** Total routed cable length in inches */
  totalLengthInches: number;
  /** Number of cable crossings detected */
  crossingCount: number;
  /** Total score: length + penalties */
  totalScore: number;
  /** Per-cable breakdown */
  cableDetails: Array<{
    fromId: string;
    toId: string;
    directDistance: number;
    routedDistance: number;
    path: Point[];
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
    }
    if (!result.valid) {
      validationFailurePenalty += CABLE_COLLISION_PENALTY_INCHES * 2;
    }

    cableDetails.push({ fromId, toId, directDistance: directDist, routedDistance: routedDist, path });
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

  return {
    totalLengthInches: totalRoutedLength,
    crossingCount: crossings.length,
    totalScore:
      totalRoutedLength + crossingPenalty + spacingPenalty +
      complexRoutingPenalty + validationFailurePenalty +
      signalFlowPenalty + rowAlignmentPenalty,
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
