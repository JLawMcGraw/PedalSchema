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
  findPathAStar,
  getStandoffPoint,
  calculatePathLength,
  detectCableCrossings,
  dist,
} from '../pathfinding';

// Scale factor: 40 pixels per inch (matching the editor canvas)
const PIXELS_PER_INCH = 40;

// Penalty for each cable crossing (in inches)
const CROSSING_PENALTY_INCHES = 6;

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
  useEffectsLoop: boolean = false
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

  // Helper to add a cable route
  const addCableRoute = (fromId: string, toId: string, fromPos: Point, toPos: Point, fromBoxIdx: number, toBoxIdx: number) => {
    const path = routeCable(fromPos, toPos, boxes, fromBoxIdx, toBoxIdx);
    const routedDist = calculatePathLength(path) / scale;
    const directDist = dist(fromPos, toPos) / scale;

    cableDetails.push({ fromId, toId, directDistance: directDist, routedDistance: routedDist, path });
    allPaths.push({ id: `${fromId}-${toId}`, points: path });
    totalRoutedLength += routedDist;
  };

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

  return {
    totalLengthInches: totalRoutedLength,
    crossingCount: crossings.length,
    totalScore: totalRoutedLength + crossingPenalty,
    cableDetails,
  };
}

/**
 * Route a cable between two points, using standoffs and A* pathfinding
 */
function routeCable(
  from: Point,
  to: Point,
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number
): Point[] {
  const fromBox = fromBoxIdx >= 0 ? boxes[fromBoxIdx] : null;
  const toBox = toBoxIdx >= 0 ? boxes[toBoxIdx] : null;

  const jackDistance = dist(from, to);
  const isShortDistance = jackDistance <= 60; // Reduced from 120 to force proper routing

  if (isShortDistance) {
    // Short distance: route directly
    return findPathAStar(from, to, boxes, fromBoxIdx, toBoxIdx);
  } else if (!fromBox || !toBox) {
    // External connection: simple L-shaped or A* fallback
    return findPathAStar(from, to, boxes, fromBoxIdx, toBoxIdx);
  } else {
    // Long pedal-to-pedal: use standoffs
    const fromStandoff = getStandoffPoint(from, fromBox, STANDOFF);
    const toStandoff = getStandoffPoint(to, toBox, STANDOFF);

    // Route between standoff points
    const routePath = findPathAStar(fromStandoff, toStandoff, boxes, -1, -1);

    // Build complete path
    const path: Point[] = [from];

    if (fromBox) {
      path.push(fromStandoff);
    }

    for (const pt of routePath) {
      const lastPt = path[path.length - 1];
      if (Math.abs(pt.x - lastPt.x) > 15 || Math.abs(pt.y - lastPt.y) > 15) {
        path.push(pt);
      }
    }

    if (toBox) {
      const lastPt = path[path.length - 1];
      if (Math.abs(toStandoff.x - lastPt.x) > 15 || Math.abs(toStandoff.y - lastPt.y) > 15) {
        path.push(toStandoff);
      }
    }

    const lastPt = path[path.length - 1];
    if (Math.abs(to.x - lastPt.x) > 5 || Math.abs(to.y - lastPt.y) > 5) {
      path.push(to);
    }

    return path;
  }
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
