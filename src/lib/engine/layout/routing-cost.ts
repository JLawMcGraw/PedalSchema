/**
 * Routing-Aware Cost Function
 *
 * Calculates the actual routed cable length using A* pathfinding,
 * including cable crossing penalties. This provides accurate cost
 * estimation for layout optimization.
 *
 * IMPORTANT: This must respect the same routing logic as calculateCables():
 * - Front-of-amp pedals: Guitar → Pedal Chain → Amp Input
 * - Effects loop pedals: Amp Send → Pedal Chain → Amp Return
 */

import type { Board, Pedal, PlacedPedal, PedalPlacement } from '@/types';
import { getJackPosition } from '../cables';
import { getExternalEndpointPx } from '../cables/endpoints';
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

// 4-cable method category classifications
const BEFORE_HUB_CATEGORIES = ['tuner', 'filter', 'wah', 'pitch'];
const IN_HUB_LOOP_CATEGORIES = ['overdrive', 'distortion', 'fuzz', 'boost'];
const IN_AMP_LOOP_CATEGORIES = ['modulation', 'tremolo', 'delay', 'reverb'];
const AFTER_HUB_CATEGORIES = ['looper', 'volume'];

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

// Penalty for signal flow violations (later pedal is to the RIGHT of earlier pedal)
// This keeps pedals in proper right-to-left order
// VERY HIGH penalty to prevent optimizer from breaking signal flow
const SIGNAL_FLOW_PENALTY_INCHES = 100;

// Penalty for pedals not aligned to rows
// This keeps pedals organized in neat rows
const ROW_MISALIGNMENT_PENALTY_INCHES = 20;

// Re-export for backwards compatibility
export type { PedalPlacement };

export interface RoutingCostResult {
  /** Total routed cable length in inches */
  totalLengthInches: number;
  /** Number of cable crossings detected */
  crossingCount: number;
  /** Total score: length + crossing penalty */
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
 * Uses A* pathfinding to simulate actual cable routes and detect crossings.
 *
 * Respects effects loop routing:
 * - Front-of-amp pedals connect: Guitar → Chain → Amp Input
 * - Effects loop pedals connect: Amp Send → Chain → Amp Return
 */
export function calculateRoutingCost(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number = PIXELS_PER_INCH,
  useEffectsLoop: boolean = false,
  use4CableMethod: boolean = false
): RoutingCostResult {
  // Create placement map for quick lookup
  const placementMap = new Map(placements.map(p => [p.id, p]));

  // Split pedals by location - this is critical for correct routing cost
  const frontOfAmpPedals = placedPedals
    .filter(p => p.location !== 'effects_loop')
    .sort((a, b) => a.chainPosition - b.chainPosition);

  const effectsLoopPedals = useEffectsLoop
    ? placedPedals
        .filter(p => p.location === 'effects_loop')
        .sort((a, b) => a.chainPosition - b.chainPosition)
    : [];

  // Build temporary PlacedPedals with updated positions for obstacle generation
  const tempPlacedPedals: PlacedPedal[] = placedPedals.map(placed => {
    const placement = placementMap.get(placed.id);
    if (!placement) return placed;
    return {
      ...placed,
      xInches: placement.x,
      yInches: placement.y,
    };
  });

  // Generate obstacles using the unified obstacle service
  const obstacles = generateObstacles(tempPlacedPedals, pedalsById, board, scale);
  const boxes = obstacles.boxes; // For legacy compatibility

  // External positions - shared with the renderer via the endpoints module
  const guitarPos: Point = getExternalEndpointPx('guitar', board, scale, useEffectsLoop);
  const ampInputPos: Point = getExternalEndpointPx('amp_input', board, scale, useEffectsLoop);
  const ampSendPos: Point = getExternalEndpointPx('amp_send', board, scale, useEffectsLoop);
  const ampReturnPos: Point = getExternalEndpointPx('amp_return', board, scale, useEffectsLoop);

  // Calculate all cable paths
  const cableDetails: RoutingCostResult['cableDetails'] = [];
  const allPaths: Array<{ id: string; points: Point[] }> = [];
  let totalRoutedLength = 0;

  // Helper to get jack positions for a pedal
  const getJackPositions = (placed: PlacedPedal, placement: PedalPlacement) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return null;

    const tempPlaced: PlacedPedal = {
      ...placed,
      xInches: placement.x,
      yInches: placement.y,
    };

    const inputJack = pedal.jacks?.find(j => j.jackType === 'input');
    const outputJack = pedal.jacks?.find(j => j.jackType === 'output');

    return {
      pedal,
      inputPos: inputJack
        ? scalePoint(getJackPosition(tempPlaced, inputJack, pedal), scale)
        : { x: placement.x * scale + (pedal.widthInches || 3) * scale, y: placement.y * scale + (pedal.depthInches || 5) * scale / 2 },
      outputPos: outputJack
        ? scalePoint(getJackPosition(tempPlaced, outputJack, pedal), scale)
        : { x: placement.x * scale, y: placement.y * scale + (pedal.depthInches || 5) * scale / 2 },
    };
  };

  // Track complex routing penalty and validation failures
  let complexRoutingPenalty = 0;
  let validationFailurePenalty = 0;

  // Helper to add a cable route using the unified routing system
  const addCableRoute = (fromId: string, toId: string, fromPos: Point, toPos: Point, fromPedalId: string | null, toPedalId: string | null) => {
    // Route using the unified system
    const result = routeCableWithObstacles(fromPos, toPos, obstacles, fromPedalId, toPedalId);
    const path = result.path;
    const routedDist = calculatePathLength(path) / scale;
    const directDist = dist(fromPos, toPos) / scale;

    // Penalize complex routing (more than 3 points = not a simple L-path)
    if (path.length > 3) {
      complexRoutingPenalty += COMPLEX_ROUTING_PENALTY_INCHES;
    }

    // Penalize invalid paths (cables that would go through pedals)
    if (!result.valid) {
      validationFailurePenalty += CABLE_COLLISION_PENALTY_INCHES * 2;
    }

    cableDetails.push({ fromId, toId, directDistance: directDist, routedDistance: routedDist, path });
    allPaths.push({ id: `${fromId}-${toId}`, points: path });
    totalRoutedLength += routedDist;
  };

  // Helper to get send/return jack positions for hub pedal
  const getHubJackPositions = (placed: PlacedPedal, placement: PedalPlacement) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return null;

    const tempPlaced: PlacedPedal = {
      ...placed,
      xInches: placement.x,
      yInches: placement.y,
    };

    const inputJack = pedal.jacks?.find(j => j.jackType === 'input');
    const outputJack = pedal.jacks?.find(j => j.jackType === 'output');
    const sendJack = pedal.jacks?.find(j => j.jackType === 'send');
    const returnJack = pedal.jacks?.find(j => j.jackType === 'return');

    return {
      pedal,
      inputPos: inputJack
        ? scalePoint(getJackPosition(tempPlaced, inputJack, pedal), scale)
        : { x: placement.x * scale + (pedal.widthInches || 3) * scale, y: placement.y * scale + (pedal.depthInches || 5) * scale / 2 },
      outputPos: outputJack
        ? scalePoint(getJackPosition(tempPlaced, outputJack, pedal), scale)
        : { x: placement.x * scale, y: placement.y * scale + (pedal.depthInches || 5) * scale / 2 },
      sendPos: sendJack
        ? scalePoint(getJackPosition(tempPlaced, sendJack, pedal), scale)
        : { x: placement.x * scale + (pedal.widthInches || 3) * scale * 0.75, y: placement.y * scale },
      returnPos: returnJack
        ? scalePoint(getJackPosition(tempPlaced, returnJack, pedal), scale)
        : { x: placement.x * scale + (pedal.widthInches || 3) * scale * 0.25, y: placement.y * scale },
    };
  };

  // === 4-CABLE METHOD ROUTING ===
  if (use4CableMethod && useEffectsLoop) {
    // Find the hub pedal (supports4Cable like NS-2)
    const hubPlaced = placedPedals.find(p => {
      const pedal = pedalsById[p.pedalId] || p.pedal;
      return pedal?.supports4Cable === true;
    });

    if (hubPlaced) {
      const hubPlacement = placementMap.get(hubPlaced.id);
      if (hubPlacement) {
        const hubJacks = getHubJackPositions(hubPlaced, hubPlacement);
        if (hubJacks) {
          // Categorize pedals for 4-cable routing
          const beforeHub: PlacedPedal[] = [];
          const inHubLoop: PlacedPedal[] = [];
          const inAmpLoop: PlacedPedal[] = [];
          const afterHub: PlacedPedal[] = [];

          for (const placed of placedPedals) {
            if (placed.id === hubPlaced.id) continue;
            const pedal = pedalsById[placed.pedalId] || placed.pedal;
            if (!pedal) continue;

            const category = pedal.category;
            if (BEFORE_HUB_CATEGORIES.includes(category)) {
              beforeHub.push(placed);
            } else if (IN_HUB_LOOP_CATEGORIES.includes(category)) {
              inHubLoop.push(placed);
            } else if (IN_AMP_LOOP_CATEGORIES.includes(category)) {
              inAmpLoop.push(placed);
            } else if (AFTER_HUB_CATEGORIES.includes(category)) {
              afterHub.push(placed);
            } else {
              inHubLoop.push(placed); // Default to hub loop
            }
          }

          // Sort each group by chain position
          beforeHub.sort((a, b) => a.chainPosition - b.chainPosition);
          inHubLoop.sort((a, b) => a.chainPosition - b.chainPosition);
          inAmpLoop.sort((a, b) => a.chainPosition - b.chainPosition);
          afterHub.sort((a, b) => a.chainPosition - b.chainPosition);

          // Helper to route a chain of pedals
          const routeChain = (chain: PlacedPedal[], startId: string, startPos: Point, endId: string, endPos: Point) => {
            if (chain.length === 0) {
              // Direct connection
              addCableRoute(startId, endId, startPos, endPos, null, null);
              return;
            }

            // Start to first pedal
            const firstPlaced = chain[0];
            const firstPlacement = placementMap.get(firstPlaced.id);
            if (firstPlacement) {
              const jacks = getJackPositions(firstPlaced, firstPlacement);
              if (jacks) {
                addCableRoute(startId, firstPlaced.id, startPos, jacks.inputPos, null, firstPlaced.id);
              }
            }

            // Connect chain pedals
            for (let i = 0; i < chain.length - 1; i++) {
              const fromPlaced = chain[i];
              const toPlaced = chain[i + 1];
              const fromPlacement = placementMap.get(fromPlaced.id);
              const toPlacement = placementMap.get(toPlaced.id);

              if (fromPlacement && toPlacement) {
                const fromJacks = getJackPositions(fromPlaced, fromPlacement);
                const toJacks = getJackPositions(toPlaced, toPlacement);
                if (fromJacks && toJacks) {
                  addCableRoute(
                    fromPlaced.id, toPlaced.id,
                    fromJacks.outputPos, toJacks.inputPos,
                    fromPlaced.id, toPlaced.id
                  );
                }
              }
            }

            // Last pedal to end
            const lastPlaced = chain[chain.length - 1];
            const lastPlacement = placementMap.get(lastPlaced.id);
            if (lastPlacement) {
              const jacks = getJackPositions(lastPlaced, lastPlacement);
              if (jacks) {
                addCableRoute(lastPlaced.id, endId, jacks.outputPos, endPos, lastPlaced.id, null);
              }
            }
          };

          // 1. Guitar → beforeHub → Hub INPUT
          routeChain(beforeHub, 'guitar', guitarPos, hubPlaced.id, hubJacks.inputPos);

          // 2. Hub SEND → inHubLoop (drives) → Amp INPUT
          routeChain(inHubLoop, hubPlaced.id + '_send', hubJacks.sendPos, 'amp_input', ampInputPos);

          // 3. Amp SEND → inAmpLoop (modulation) → Hub RETURN
          routeChain(inAmpLoop, 'amp_send', ampSendPos, hubPlaced.id + '_return', hubJacks.returnPos);

          // 4. Hub OUTPUT → afterHub (looper) → Amp RETURN
          routeChain(afterHub, hubPlaced.id + '_output', hubJacks.outputPos, 'amp_return', ampReturnPos);

          // Detect cable crossings and calculate penalties
          const crossings = detectCableCrossings(allPaths);
          const crossingPenalty = crossings.length * CROSSING_PENALTY_INCHES;
          const spacingPenalty = calculateSpacingPenalty(boxes);

          return {
            totalLengthInches: totalRoutedLength,
            crossingCount: crossings.length,
            totalScore: totalRoutedLength + crossingPenalty + spacingPenalty + complexRoutingPenalty + validationFailurePenalty,
            cableDetails,
          };
        }
      }
    }
  }

  // === FRONT-OF-AMP CHAIN ===
  // Guitar → [front-of-amp pedals] → Amp Input
  if (frontOfAmpPedals.length > 0) {
    // Guitar to first pedal
    const firstPlaced = frontOfAmpPedals[0];
    const firstPlacement = placementMap.get(firstPlaced.id);
    if (firstPlacement) {
      const jacks = getJackPositions(firstPlaced, firstPlacement);
      if (jacks) {
        addCableRoute('guitar', firstPlaced.id, guitarPos, jacks.inputPos, null, firstPlaced.id);
      }
    }

    // Connect front-of-amp pedals in chain
    for (let i = 0; i < frontOfAmpPedals.length - 1; i++) {
      const fromPlaced = frontOfAmpPedals[i];
      const toPlaced = frontOfAmpPedals[i + 1];
      const fromPlacement = placementMap.get(fromPlaced.id);
      const toPlacement = placementMap.get(toPlaced.id);

      if (fromPlacement && toPlacement) {
        const fromJacks = getJackPositions(fromPlaced, fromPlacement);
        const toJacks = getJackPositions(toPlaced, toPlacement);
        if (fromJacks && toJacks) {
          addCableRoute(
            fromPlaced.id, toPlaced.id,
            fromJacks.outputPos, toJacks.inputPos,
            fromPlaced.id, toPlaced.id
          );
        }
      }
    }

    // Last front-of-amp pedal to amp input
    const lastPlaced = frontOfAmpPedals[frontOfAmpPedals.length - 1];
    const lastPlacement = placementMap.get(lastPlaced.id);
    if (lastPlacement) {
      const jacks = getJackPositions(lastPlaced, lastPlacement);
      if (jacks) {
        addCableRoute(lastPlaced.id, 'amp_input', jacks.outputPos, ampInputPos, lastPlaced.id, null);
      }
    }
  } else {
    // No pedals - guitar straight to amp
    addCableRoute('guitar', 'amp_input', guitarPos, ampInputPos, null, null);
  }

  // === EFFECTS LOOP CHAIN ===
  // Amp Send → [effects-loop pedals] → Amp Return
  if (effectsLoopPedals.length > 0) {
    // Amp send to first effects loop pedal
    const firstLoopPlaced = effectsLoopPedals[0];
    const firstLoopPlacement = placementMap.get(firstLoopPlaced.id);
    if (firstLoopPlacement) {
      const jacks = getJackPositions(firstLoopPlaced, firstLoopPlacement);
      if (jacks) {
        addCableRoute('amp_send', firstLoopPlaced.id, ampSendPos, jacks.inputPos, null, firstLoopPlaced.id);
      }
    }

    // Connect effects loop pedals in chain
    for (let i = 0; i < effectsLoopPedals.length - 1; i++) {
      const fromPlaced = effectsLoopPedals[i];
      const toPlaced = effectsLoopPedals[i + 1];
      const fromPlacement = placementMap.get(fromPlaced.id);
      const toPlacement = placementMap.get(toPlaced.id);

      if (fromPlacement && toPlacement) {
        const fromJacks = getJackPositions(fromPlaced, fromPlacement);
        const toJacks = getJackPositions(toPlaced, toPlacement);
        if (fromJacks && toJacks) {
          addCableRoute(
            fromPlaced.id, toPlaced.id,
            fromJacks.outputPos, toJacks.inputPos,
            fromPlaced.id, toPlaced.id
          );
        }
      }
    }

    // Last effects loop pedal to amp return
    const lastLoopPlaced = effectsLoopPedals[effectsLoopPedals.length - 1];
    const lastLoopPlacement = placementMap.get(lastLoopPlaced.id);
    if (lastLoopPlacement) {
      const jacks = getJackPositions(lastLoopPlaced, lastLoopPlacement);
      if (jacks) {
        addCableRoute(lastLoopPlaced.id, 'amp_return', jacks.outputPos, ampReturnPos, lastLoopPlaced.id, null);
      }
    }
  }

  // Detect cable crossings
  const crossings = detectCableCrossings(allPaths);
  const crossingPenalty = crossings.length * CROSSING_PENALTY_INCHES;

  // Calculate spacing penalty for pedals that are too close together
  const spacingPenalty = calculateSpacingPenalty(boxes);

  // Calculate signal flow penalty (per segment: front chain flows right-to-left,
  // effects loop chain flows left-to-right, matching the placer)
  const signalFlowPenalty = calculateSignalFlowPenalty(placements, placedPedals, pedalsById);

  // Calculate row alignment penalty
  const rowAlignmentPenalty = calculateRowAlignmentPenalty(placements, board);

  return {
    totalLengthInches: totalRoutedLength,
    crossingCount: crossings.length,
    totalScore: totalRoutedLength + crossingPenalty + spacingPenalty + complexRoutingPenalty + validationFailurePenalty + signalFlowPenalty + rowAlignmentPenalty,
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

      // Calculate the gap between boxes (negative means overlapping)
      const gapX = Math.max(boxA.x, boxB.x) - Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
      const gapY = Math.max(boxA.y, boxB.y) - Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

      // If boxes don't overlap on one axis, they're not adjacent
      if (gapX > MIN_CABLE_CLEARANCE_PX || gapY > MIN_CABLE_CLEARANCE_PX) continue;

      // Calculate minimum gap (the smallest distance between the boxes)
      const minGap = Math.max(gapX, gapY);

      // Penalize if gap is less than minimum clearance
      if (minGap < MIN_CABLE_CLEARANCE_PX) {
        // Penalty increases as gap decreases (stronger penalty for very close pedals)
        const severityMultiplier = 1 + (MIN_CABLE_CLEARANCE_PX - minGap) / MIN_CABLE_CLEARANCE_PX;
        penalty += SPACING_PENALTY_INCHES * severityMultiplier;
      }
    }
  }

  return penalty;
}

/**
 * Scale a point from inches to pixels
 */
function scalePoint(pos: { x: number; y: number }, scale: number): Point {
  return { x: pos.x * scale, y: pos.y * scale };
}

/**
 * Calculate penalty for signal flow violations, evaluated PER SEGMENT:
 * - Front-of-amp chain flows right-to-left (guitar right → amp left):
 *   earlier pedals should be to the RIGHT of later pedals.
 * - Effects loop chain flows left-to-right in the left zone (amp send →
 *   pedals → amp return), matching the placer: earlier pedals should be to
 *   the LEFT of later pedals.
 *
 * Evaluating one global right-to-left order across both chains (the old
 * behavior) penalized the optimizer for the loop layout the placer
 * deliberately creates.
 */
function calculateSignalFlowPenalty(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): number {
  const placementMap = new Map(placements.map(p => [p.id, p]));
  const widthMap = new Map<string, number>();

  for (const placed of placedPedals) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const width = isRotated ? pedal.depthInches : pedal.widthInches;
    widthMap.set(placed.id, width);
  }

  const centerX = (placed: PlacedPedal): number | null => {
    const placement = placementMap.get(placed.id);
    if (!placement) return null;
    return placement.x + (widthMap.get(placed.id) ?? 2.87) / 2;
  };

  const yOf = (placed: PlacedPedal): number | null =>
    placementMap.get(placed.id)?.y ?? null;

  // Penalize consecutive pairs that flow in the wrong direction for their
  // segment. Only pairs on the SAME row count: a chain wrapping to the next
  // row legitimately reverses X (e.g., last row packs against the amp side),
  // and penalizing the wrap would fight the placer's intended layout.
  const segmentPenalty = (chain: PlacedPedal[], direction: 'right-to-left' | 'left-to-right'): number => {
    let penalty = 0;
    for (let i = 0; i < chain.length - 1; i++) {
      const currentX = centerX(chain[i]);
      const nextX = centerX(chain[i + 1]);
      const currentY = yOf(chain[i]);
      const nextY = yOf(chain[i + 1]);
      if (currentX === null || nextX === null || currentY === null || nextY === null) continue;
      if (Math.abs(currentY - nextY) > 1) continue; // row transition - exempt

      const violation = direction === 'right-to-left'
        ? nextX - currentX   // next should be further LEFT
        : currentX - nextX;  // next should be further RIGHT

      if (violation > 0) {
        penalty += SIGNAL_FLOW_PENALTY_INCHES * (1 + violation / 5);
      }
    }
    return penalty;
  };

  const frontChain = placedPedals
    .filter(p => p.location !== 'effects_loop')
    .sort((a, b) => a.chainPosition - b.chainPosition);
  const loopChain = placedPedals
    .filter(p => p.location === 'effects_loop')
    .sort((a, b) => a.chainPosition - b.chainPosition);

  return segmentPenalty(frontChain, 'right-to-left') + segmentPenalty(loopChain, 'left-to-right');
}

/**
 * Calculate penalty for pedals not aligned to standard row positions.
 * This encourages pedals to stay in neat rows rather than scattered positions.
 */
function calculateRowAlignmentPenalty(
  placements: PedalPlacement[],
  board: Board
): number {
  let penalty = 0;

  // Get rail positions (or default to 2 rows)
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  const rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05];

  // Check each placement's distance from nearest row
  for (const placement of placements) {
    let minDistance = Infinity;

    for (const rowY of rowYPositions) {
      const distance = Math.abs(placement.y - rowY);
      minDistance = Math.min(minDistance, distance);
    }

    // Penalize if more than 0.5 inches from a row
    if (minDistance > 0.5) {
      penalty += ROW_MISALIGNMENT_PENALTY_INCHES * minDistance;
    }
  }

  return penalty;
}
