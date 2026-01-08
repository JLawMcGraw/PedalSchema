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

import type { Board, Pedal, PlacedPedal, RoutingConfig, PedalPlacement } from '@/types';
import { getJackPosition } from '../cables';
import {
  Point,
  Box,
  STANDOFF,
  OBSTACLE_MARGIN,
  findPathAStar,
  getStandoffPoint,
  calculatePathLength,
  detectCableCrossings,
  dist,
  lineIntersectsBox,
  validateRoute,
} from '../pathfinding';

// 4-cable method category classifications
const BEFORE_HUB_CATEGORIES = ['tuner', 'filter', 'wah', 'pitch'];
const IN_HUB_LOOP_CATEGORIES = ['overdrive', 'distortion', 'fuzz', 'boost'];
const IN_AMP_LOOP_CATEGORIES = ['modulation', 'tremolo', 'delay', 'reverb'];
const AFTER_HUB_CATEGORIES = ['looper', 'volume'];

// Scale factor: 40 pixels per inch (matching the editor canvas)
const PIXELS_PER_INCH = 40;

// Penalty for each cable crossing (in inches)
const CROSSING_PENALTY_INCHES = 6;

// Minimum spacing between pedals for cable clearance (in pixels)
// Pedals closer than this will be penalized heavily
const MIN_CABLE_CLEARANCE_PX = OBSTACLE_MARGIN * 3; // 75px = ~1.9 inches - need room for L-paths

// Penalty per pedal pair that's too close (in inches) - VERY HEAVY to force spacing
const SPACING_PENALTY_INCHES = 200;

// Penalty when a cable would have to go through a pedal (in inches)
const CABLE_COLLISION_PENALTY_INCHES = 100;

// Penalty when cable needs complex routing (channel/perimeter/A*) instead of simple L-path
const COMPLEX_ROUTING_PENALTY_INCHES = 30;

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

  // Build obstacle boxes from placements
  const boxes: Box[] = placements.map(placement => {
    const placed = placedPedals.find(p => p.id === placement.id);
    if (!placed) return { x: 0, y: 0, width: 0, height: 0 };

    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return { x: 0, y: 0, width: 0, height: 0 };

    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return {
      x: placement.x * scale,
      y: placement.y * scale,
      width: (isRotated ? pedal.depthInches : pedal.widthInches) * scale,
      height: (isRotated ? pedal.widthInches : pedal.depthInches) * scale,
    };
  });

  // Create index map from pedal id to box index
  const idToBoxIdx = new Map<string, number>();
  placements.forEach((p, idx) => idToBoxIdx.set(p.id, idx));

  // External positions - matching cable-renderer.tsx
  const boardWidthPx = board.widthInches * scale;
  const boardHeightPx = board.depthInches * scale;
  const guitarPos: Point = { x: boardWidthPx + 60, y: boardHeightPx / 2 };
  const ampInputPos: Point = { x: -60, y: useEffectsLoop ? boardHeightPx * 0.8 : boardHeightPx * 0.5 };
  const ampSendPos: Point = { x: -60, y: boardHeightPx * 0.5 };
  const ampReturnPos: Point = { x: -60, y: boardHeightPx * 0.2 };

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

  // Track complex routing penalty
  let complexRoutingPenalty = 0;

  // Helper to add a cable route
  const addCableRoute = (fromId: string, toId: string, fromPos: Point, toPos: Point, fromBoxIdx: number, toBoxIdx: number) => {
    const path = routeCable(fromPos, toPos, boxes, fromBoxIdx, toBoxIdx);
    const routedDist = calculatePathLength(path) / scale;
    const directDist = dist(fromPos, toPos) / scale;

    // Penalize complex routing (more than 3 points = not a simple L-path)
    if (path.length > 3) {
      complexRoutingPenalty += COMPLEX_ROUTING_PENALTY_INCHES;
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
              addCableRoute(startId, endId, startPos, endPos, -1, -1);
              return;
            }

            // Start to first pedal
            const firstPlaced = chain[0];
            const firstPlacement = placementMap.get(firstPlaced.id);
            if (firstPlacement) {
              const jacks = getJackPositions(firstPlaced, firstPlacement);
              if (jacks) {
                addCableRoute(startId, firstPlaced.id, startPos, jacks.inputPos, -1, idToBoxIdx.get(firstPlaced.id) ?? -1);
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
                    idToBoxIdx.get(fromPlaced.id) ?? -1, idToBoxIdx.get(toPlaced.id) ?? -1
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
                addCableRoute(lastPlaced.id, endId, jacks.outputPos, endPos, idToBoxIdx.get(lastPlaced.id) ?? -1, -1);
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
          const collisionPenalty = calculateCableCollisionPenalty(allPaths, boxes);

          return {
            totalLengthInches: totalRoutedLength,
            crossingCount: crossings.length,
            totalScore: totalRoutedLength + crossingPenalty + spacingPenalty + collisionPenalty + complexRoutingPenalty,
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
        addCableRoute('guitar', firstPlaced.id, guitarPos, jacks.inputPos, -1, idToBoxIdx.get(firstPlaced.id) ?? -1);
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
            idToBoxIdx.get(fromPlaced.id) ?? -1, idToBoxIdx.get(toPlaced.id) ?? -1
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
        addCableRoute(lastPlaced.id, 'amp_input', jacks.outputPos, ampInputPos, idToBoxIdx.get(lastPlaced.id) ?? -1, -1);
      }
    }
  } else {
    // No pedals - guitar straight to amp
    addCableRoute('guitar', 'amp_input', guitarPos, ampInputPos, -1, -1);
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
        addCableRoute('amp_send', firstLoopPlaced.id, ampSendPos, jacks.inputPos, -1, idToBoxIdx.get(firstLoopPlaced.id) ?? -1);
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
            idToBoxIdx.get(fromPlaced.id) ?? -1, idToBoxIdx.get(toPlaced.id) ?? -1
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
        addCableRoute(lastLoopPlaced.id, 'amp_return', jacks.outputPos, ampReturnPos, idToBoxIdx.get(lastLoopPlaced.id) ?? -1, -1);
      }
    }
  }

  // Detect cable crossings
  const crossings = detectCableCrossings(allPaths);
  const crossingPenalty = crossings.length * CROSSING_PENALTY_INCHES;

  // Calculate spacing penalty for pedals that are too close together
  const spacingPenalty = calculateSpacingPenalty(boxes);

  // Calculate penalty for cables going through pedals
  const collisionPenalty = calculateCableCollisionPenalty(allPaths, boxes);

  return {
    totalLengthInches: totalRoutedLength,
    crossingCount: crossings.length,
    totalScore: totalRoutedLength + crossingPenalty + spacingPenalty + collisionPenalty + complexRoutingPenalty,
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
 * Calculate a penalty for cables that would go through pedals.
 * This is a VERY heavy penalty to force the optimizer to avoid such layouts.
 */
function calculateCableCollisionPenalty(
  allPaths: Array<{ id: string; points: Point[] }>,
  boxes: Box[]
): number {
  let penalty = 0;

  // Check each cable path
  for (const cable of allPaths) {
    const { points } = cable;
    if (points.length < 2) continue;

    // Check each segment of the cable
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // Check against each pedal box
      for (const box of boxes) {
        if (box.width === 0 || box.height === 0) continue;

        // Check if this segment intersects the box (with margin)
        if (lineIntersectsBox(p1, p2, box, OBSTACLE_MARGIN)) {
          // Heavy penalty per collision
          penalty += CABLE_COLLISION_PENALTY_INCHES;
        }
      }
    }
  }

  return penalty;
}

/**
 * Route a cable using the SAME logic as the visual renderer (cable-renderer.tsx).
 * This ensures the cost function accurately predicts what will be displayed.
 *
 * Uses simple L-shaped paths first, falling back to A* only if needed.
 * NO exclusions - cables must never go through ANY pedal.
 */
function routeCable(
  from: Point,
  to: Point,
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number
): Point[] {
  // NO exclusions - cables must never go through ANY pedal (matching visual renderer)
  const noExclusions = new Set<number>();
  const validBoxes = boxes.filter(b => b.width > 0 && b.height > 0);

  // Strategy 1: Direct line (for very close jacks)
  const jackDistance = dist(from, to);
  if (jackDistance <= 80 && validateRoute([from, to], boxes, noExclusions)) {
    return [from, to];
  }

  // Strategy 2: Simple L-shaped routing (matching visual renderer)
  // Option 2a: Horizontal first, then vertical
  const midH = { x: to.x, y: from.y };
  const pathH = [from, midH, to];
  if (validateRoute(pathH, boxes, noExclusions)) {
    return pathH;
  }

  // Option 2b: Vertical first, then horizontal
  const midV = { x: from.x, y: to.y };
  const pathV = [from, midV, to];
  if (validateRoute(pathV, boxes, noExclusions)) {
    return pathV;
  }

  // Strategy 3: Route through horizontal channel between pedal rows
  if (validBoxes.length > 0) {
    const yRanges = validBoxes.map(b => ({ top: b.y, bottom: b.y + b.height }));
    yRanges.sort((a, b) => a.top - b.top);

    // Try routing through Y gaps
    for (let i = 0; i < yRanges.length - 1; i++) {
      const gap = yRanges[i + 1].top - yRanges[i].bottom;
      if (gap > OBSTACLE_MARGIN * 2) {
        const channelY = yRanges[i].bottom + gap / 2;
        const pathChannel = [
          from,
          { x: from.x, y: channelY },
          { x: to.x, y: channelY },
          to
        ];
        if (validateRoute(pathChannel, boxes, noExclusions)) {
          return pathChannel;
        }
      }
    }

    // Try routing above all pedals
    const minY = Math.min(...yRanges.map(r => r.top));
    const aboveY = Math.max(10, minY - STANDOFF);
    const pathAbove = [from, { x: from.x, y: aboveY }, { x: to.x, y: aboveY }, to];
    if (validateRoute(pathAbove, boxes, noExclusions)) {
      return pathAbove;
    }

    // Try routing below all pedals
    const maxY = Math.max(...yRanges.map(r => r.bottom));
    const belowY = maxY + STANDOFF;
    const pathBelow = [from, { x: from.x, y: belowY }, { x: to.x, y: belowY }, to];
    if (validateRoute(pathBelow, boxes, noExclusions)) {
      return pathBelow;
    }
  }

  // Fallback: Use A* pathfinding (matching visual renderer)
  return findPathAStar(from, to, boxes, -1, -1);
}

/**
 * Scale a point from inches to pixels
 */
function scalePoint(pos: { x: number; y: number }, scale: number): Point {
  return { x: pos.x * scale, y: pos.y * scale };
}

/**
 * Calculate total Euclidean cable distance (for comparison)
 * This is the simple estimation without routing
 */
export function calculateEuclideanDistance(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): number {
  const placementMap = new Map(placements.map(p => [p.id, p]));
  const sortedPedals = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);

  let totalDistance = 0;

  // Guitar position (right side of board)
  const guitarX = board.widthInches + 3;
  const guitarY = board.depthInches / 2;

  // Amp position (left side of board)
  const ampX = -3;
  const ampY = board.depthInches / 2;

  for (let i = 0; i < sortedPedals.length; i++) {
    const placed = sortedPedals[i];
    const placement = placementMap.get(placed.id);
    if (!placement) continue;

    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    const tempPlaced: PlacedPedal = {
      ...placed,
      xInches: placement.x,
      yInches: placement.y,
    };

    const inputJack = pedal.jacks?.find(j => j.jackType === 'input');
    const inputPos = inputJack
      ? getJackPosition(tempPlaced, inputJack, pedal)
      : { x: placement.x + (pedal.widthInches || 3), y: placement.y + (pedal.depthInches || 5) / 2 };

    const outputJack = pedal.jacks?.find(j => j.jackType === 'output');
    const outputPos = outputJack
      ? getJackPosition(tempPlaced, outputJack, pedal)
      : { x: placement.x, y: placement.y + (pedal.depthInches || 5) / 2 };

    if (i === 0) {
      totalDistance += euclideanDist(guitarX, guitarY, inputPos.x, inputPos.y);
    } else {
      const prevPlaced = sortedPedals[i - 1];
      const prevPlacement = placementMap.get(prevPlaced.id);
      if (prevPlacement) {
        const prevPedal = pedalsById[prevPlaced.pedalId] || prevPlaced.pedal;
        if (prevPedal) {
          const prevTempPlaced: PlacedPedal = {
            ...prevPlaced,
            xInches: prevPlacement.x,
            yInches: prevPlacement.y,
          };
          const prevOutputJack = prevPedal.jacks?.find(j => j.jackType === 'output');
          const prevOutputPos = prevOutputJack
            ? getJackPosition(prevTempPlaced, prevOutputJack, prevPedal)
            : { x: prevPlacement.x, y: prevPlacement.y + (prevPedal.depthInches || 5) / 2 };

          totalDistance += euclideanDist(prevOutputPos.x, prevOutputPos.y, inputPos.x, inputPos.y);
        }
      }
    }

    if (i === sortedPedals.length - 1) {
      totalDistance += euclideanDist(outputPos.x, outputPos.y, ampX, ampY);
    }
  }

  return totalDistance;
}

function euclideanDist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
