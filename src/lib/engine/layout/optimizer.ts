/**
 * Layout Optimizer with Simulated Annealing
 *
 * Optimizes pedal placements to minimize total cable length using
 * simulated annealing, which can escape local minima unlike hill climbing.
 *
 * Uses a seeded PRNG for deterministic results (avoids SSR hydration mismatches).
 */

import type { Board, Pedal, PlacedPedal, SwappableGroup, JointOptimizationResult, PedalPlacement } from '@/types';
import { calculateRoutingCost, calculateEuclideanDistance } from './routing-cost';

// Re-export for backwards compatibility
export type { PedalPlacement } from '@/types';

/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Produces deterministic random numbers for consistent SSR/client results.
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generate a seed from placement IDs for deterministic optimization
 */
function generateSeed(placements: PedalPlacement[]): number {
  let hash = 0;
  const str = placements.map(p => p.id).join('|');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) || 1;
}

interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SPACING = 0.5;

/**
 * Simulated Annealing Configuration
 */
export interface SAConfig {
  /** Starting temperature - higher = more exploration */
  initialTemperature: number;
  /** How fast temperature decreases (0.9-0.99) */
  coolingRate: number;
  /** Stop when temperature reaches this */
  minTemperature: number;
  /** Number of moves to try at each temperature level */
  iterationsPerTemp: number;
  /** Use routing-aware cost (slower but more accurate) */
  useRoutingCost: boolean;
}

const DEFAULT_CONFIG: SAConfig = {
  initialTemperature: 50,
  coolingRate: 0.92,
  minTemperature: 0.5,
  iterationsPerTemp: 5,
  useRoutingCost: true,
};

/**
 * Get adaptive config based on pedal count
 * NOTE: Always uses routing cost - Euclidean distance is not accurate enough
 */
function getAdaptiveConfig(pedalCount: number): SAConfig {
  // Fewer iterations for more pedals to maintain performance
  // But ALWAYS use routing cost - Euclidean gives poor results
  if (pedalCount <= 5) {
    return {
      ...DEFAULT_CONFIG,
      iterationsPerTemp: 8,
      coolingRate: 0.90,
      useRoutingCost: true,
    };
  } else if (pedalCount <= 10) {
    return {
      ...DEFAULT_CONFIG,
      iterationsPerTemp: 5,
      coolingRate: 0.92,
      useRoutingCost: true,
    };
  } else {
    // For large boards, reduce iterations but keep routing cost
    return {
      ...DEFAULT_CONFIG,
      iterationsPerTemp: 3,
      coolingRate: 0.95,
      useRoutingCost: true,
    };
  }
}

/**
 * Main optimization function using simulated annealing.
 * Replaces the old hill-climbing approach.
 *
 * Returns PedalPlacement[] for backwards compatibility.
 * Use optimizeJointly() for full joint optimization with chain reordering.
 */
export function optimizeForCableLength(
  initialPlacements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  maxIterations: number = 30,
  useEffectsLoop: boolean = false
): PedalPlacement[] {
  if (initialPlacements.length <= 1) {
    return initialPlacements;
  }

  const config = getAdaptiveConfig(initialPlacements.length);

  // For backwards compatibility, use empty swappable groups
  const result = optimizeWithSimulatedAnnealing(
    initialPlacements,
    placedPedals.map(p => p.id), // Initial chain order
    placedPedals,
    pedalsById,
    board,
    [], // No swappable groups for backwards compat
    config,
    useEffectsLoop
  );

  return result.placements;
}

/**
 * Joint optimization that optimizes both placement AND signal chain order.
 */
export function optimizeJointly(
  initialPlacements: PedalPlacement[],
  initialChainOrder: string[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  swappableGroups: SwappableGroup[],
  useEffectsLoop: boolean = false
): JointOptimizationResult {
  if (initialPlacements.length <= 1) {
    return {
      placements: initialPlacements,
      chainOrder: initialChainOrder,
      swappableGroups,
    };
  }

  const config = getAdaptiveConfig(initialPlacements.length);

  return optimizeWithSimulatedAnnealing(
    initialPlacements,
    initialChainOrder,
    placedPedals,
    pedalsById,
    board,
    swappableGroups,
    config,
    useEffectsLoop
  );
}

/**
 * State for joint optimization (placements + chain order)
 */
interface OptimizationState {
  placements: PedalPlacement[];
  chainOrder: string[];
}

/**
 * Simulated Annealing Optimizer
 *
 * Unlike hill climbing, SA can accept worse solutions with a probability
 * that decreases as temperature cools. This allows escaping local minima.
 *
 * Now supports joint optimization of both placement AND signal chain order
 * within swappable groups.
 *
 * Uses seeded PRNG for deterministic results across SSR/client.
 */
export function optimizeWithSimulatedAnnealing(
  initialPlacements: PedalPlacement[],
  initialChainOrder: string[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  swappableGroups: SwappableGroup[],
  config: SAConfig = DEFAULT_CONFIG,
  useEffectsLoop: boolean = false
): JointOptimizationResult {
  // Create seeded random for deterministic results
  const seed = generateSeed(initialPlacements);
  const random = createSeededRandom(seed);

  let current: OptimizationState = {
    placements: [...initialPlacements],
    chainOrder: [...initialChainOrder],
  };
  let currentScore = calculateScoreWithChain(current, placedPedals, pedalsById, board, config.useRoutingCost, useEffectsLoop);

  let best: OptimizationState = {
    placements: [...current.placements],
    chainOrder: [...current.chainOrder],
  };
  let bestScore = currentScore;

  let temperature = config.initialTemperature;

  // Get board rails for row changes
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  const rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05];

  while (temperature > config.minTemperature) {
    for (let iter = 0; iter < config.iterationsPerTemp; iter++) {
      // Generate a neighbor solution (may modify placements, chain order, or both)
      const neighbor = generateNeighborJoint(current, placedPedals, pedalsById, board, rowYPositions, swappableGroups, random);

      if (!neighbor) continue;

      // Check for collisions
      if (hasAnyCollision(neighbor.placements, placedPedals, pedalsById, board)) {
        continue;
      }

      const neighborScore = calculateScoreWithChain(neighbor, placedPedals, pedalsById, board, config.useRoutingCost, useEffectsLoop);
      const delta = neighborScore - currentScore;

      // Accept if better, or probabilistically if worse
      const acceptProbability = delta < 0 ? 1 : Math.exp(-delta / temperature);

      if (random() < acceptProbability) {
        current = neighbor;
        currentScore = neighborScore;

        // Track best solution found
        if (currentScore < bestScore) {
          best = {
            placements: [...current.placements],
            chainOrder: [...current.chainOrder],
          };
          bestScore = currentScore;
        }
      }
    }

    // Cool down
    temperature *= config.coolingRate;
  }

  return {
    placements: best.placements,
    chainOrder: best.chainOrder,
    swappableGroups,
  };
}

/**
 * Calculate the cost score for a placement configuration (without chain order).
 * Uses either routing-aware cost or simple Euclidean distance.
 */
function calculateScore(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  useRoutingCost: boolean,
  useEffectsLoop: boolean = false
): number {
  if (useRoutingCost) {
    const result = calculateRoutingCost(placements, placedPedals, pedalsById, board, undefined, useEffectsLoop);
    return result.totalScore;
  } else {
    return calculateEuclideanDistance(placements, placedPedals, pedalsById, board);
  }
}

/**
 * Calculate the cost score with a specific chain order.
 * The chain order affects which pedals are connected to each other.
 */
function calculateScoreWithChain(
  state: OptimizationState,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  useRoutingCost: boolean,
  useEffectsLoop: boolean = false
): number {
  // Reorder placedPedals according to the chain order
  const reorderedPedals = reorderPedalsByChain(placedPedals, state.chainOrder);

  if (useRoutingCost) {
    const result = calculateRoutingCost(state.placements, reorderedPedals, pedalsById, board, undefined, useEffectsLoop);
    return result.totalScore;
  } else {
    return calculateEuclideanDistance(state.placements, reorderedPedals, pedalsById, board);
  }
}

/**
 * Reorder placedPedals according to a chain order.
 * Updates chainPosition to match the new order.
 */
function reorderPedalsByChain(placedPedals: PlacedPedal[], chainOrder: string[]): PlacedPedal[] {
  const pedalsById = new Map(placedPedals.map(p => [p.id, p]));
  const result: PlacedPedal[] = [];

  for (let i = 0; i < chainOrder.length; i++) {
    const pedal = pedalsById.get(chainOrder[i]);
    if (pedal) {
      result.push({
        ...pedal,
        chainPosition: i + 1,
      });
    }
  }

  // Add any pedals not in chainOrder at the end (shouldn't happen, but be safe)
  for (const pedal of placedPedals) {
    if (!chainOrder.includes(pedal.id)) {
      result.push({
        ...pedal,
        chainPosition: result.length + 1,
      });
    }
  }

  return result;
}

/**
 * Generate a neighboring solution by applying a random move.
 * Now supports chain swaps for joint optimization.
 *
 * Move probabilities:
 * - Swap positions: 30%
 * - Nudge: 30%
 * - Row change: 15%
 * - Chain swap: 25% (only if swappable groups exist)
 */
function generateNeighborJoint(
  state: OptimizationState,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  rowYPositions: number[],
  swappableGroups: SwappableGroup[],
  random: () => number
): OptimizationState | null {
  const hasSwappableGroups = swappableGroups.length > 0;
  const moveType = random();

  // Adjust probabilities based on whether chain swaps are possible
  if (hasSwappableGroups) {
    if (moveType < 0.30) {
      // Swap positions (30%)
      const newPlacements = trySwap(state.placements, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    } else if (moveType < 0.60) {
      // Nudge (30%)
      const newPlacements = tryNudge(state.placements, board, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    } else if (moveType < 0.75) {
      // Row change (15%)
      const newPlacements = tryRowChange(state.placements, placedPedals, pedalsById, board, rowYPositions, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    } else {
      // Chain swap (25%)
      const newChainOrder = tryChainSwap(state.chainOrder, swappableGroups, random);
      return newChainOrder ? { placements: state.placements, chainOrder: newChainOrder } : null;
    }
  } else {
    // No swappable groups - use original distribution
    if (moveType < 0.4) {
      // Swap positions (40%)
      const newPlacements = trySwap(state.placements, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    } else if (moveType < 0.8) {
      // Nudge (40%)
      const newPlacements = tryNudge(state.placements, board, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    } else {
      // Row change (20%)
      const newPlacements = tryRowChange(state.placements, placedPedals, pedalsById, board, rowYPositions, random);
      return newPlacements ? { placements: newPlacements, chainOrder: state.chainOrder } : null;
    }
  }
}

/**
 * Legacy: Generate a neighboring solution (placements only)
 */
function generateNeighbor(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  rowYPositions: number[],
  random: () => number
): PedalPlacement[] | null {
  const moveType = random();

  if (moveType < 0.4) {
    // Swap positions (40%)
    return trySwap(placements, random);
  } else if (moveType < 0.8) {
    // Nudge (40%)
    return tryNudge(placements, board, random);
  } else {
    // Row change (20%)
    return tryRowChange(placements, placedPedals, pedalsById, board, rowYPositions, random);
  }
}

/**
 * Try to swap two pedals within the same swappable group in the chain order.
 * This changes which pedals are connected, potentially shortening cable routes.
 */
function tryChainSwap(
  chainOrder: string[],
  swappableGroups: SwappableGroup[],
  random: () => number
): string[] | null {
  if (swappableGroups.length === 0) return null;

  // Pick a random swappable group
  const groupIdx = Math.floor(random() * swappableGroups.length);
  const group = swappableGroups[groupIdx];

  if (group.pedalIds.length < 2) return null;

  // Pick two different pedals within the group
  const i = Math.floor(random() * group.pedalIds.length);
  let j = Math.floor(random() * group.pedalIds.length);
  while (j === i) {
    j = Math.floor(random() * group.pedalIds.length);
  }

  const pedalA = group.pedalIds[i];
  const pedalB = group.pedalIds[j];

  // Find their positions in the chain order
  const posA = chainOrder.indexOf(pedalA);
  const posB = chainOrder.indexOf(pedalB);

  if (posA === -1 || posB === -1) return null;

  // Swap them in the chain order
  const newOrder = [...chainOrder];
  newOrder[posA] = pedalB;
  newOrder[posB] = pedalA;

  return newOrder;
}

/**
 * Swap positions of two random pedals
 */
function trySwap(placements: PedalPlacement[], random: () => number): PedalPlacement[] | null {
  if (placements.length < 2) return null;

  const i = Math.floor(random() * placements.length);
  let j = Math.floor(random() * placements.length);
  while (j === i) {
    j = Math.floor(random() * placements.length);
  }

  const result = [...placements];
  result[i] = { ...placements[i], x: placements[j].x, y: placements[j].y };
  result[j] = { ...placements[j], x: placements[i].x, y: placements[i].y };

  return result;
}

/**
 * Nudge a random pedal by a small amount in a random direction
 */
function tryNudge(placements: PedalPlacement[], board: Board, random: () => number): PedalPlacement[] | null {
  const idx = Math.floor(random() * placements.length);
  const original = placements[idx];

  // Random nudge amount (0.25 to 1.0 inches)
  const nudgeAmount = 0.25 + random() * 0.75;

  // Random direction
  const directions = [
    { dx: nudgeAmount, dy: 0 },
    { dx: -nudgeAmount, dy: 0 },
    { dx: 0, dy: nudgeAmount },
    { dx: 0, dy: -nudgeAmount },
    { dx: nudgeAmount * 0.7, dy: nudgeAmount * 0.7 },
    { dx: -nudgeAmount * 0.7, dy: nudgeAmount * 0.7 },
    { dx: nudgeAmount * 0.7, dy: -nudgeAmount * 0.7 },
    { dx: -nudgeAmount * 0.7, dy: -nudgeAmount * 0.7 },
  ];

  const dir = directions[Math.floor(random() * directions.length)];

  const newX = original.x + dir.dx;
  const newY = original.y + dir.dy;

  // Check bounds (rough check)
  if (newX < 0 || newX > board.widthInches - 1) return null;
  if (newY < 0 || newY > board.depthInches - 1) return null;

  const result = [...placements];
  result[idx] = { ...original, x: newX, y: newY };

  return result;
}

/**
 * Move a random pedal to a different row
 */
function tryRowChange(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  rowYPositions: number[],
  random: () => number
): PedalPlacement[] | null {
  if (rowYPositions.length < 2) return null;

  const idx = Math.floor(random() * placements.length);
  const original = placements[idx];
  const placed = placedPedals.find(p => p.id === original.id);
  if (!placed) return null;

  const pedal = pedalsById[placed.pedalId] || placed.pedal;
  if (!pedal) return null;

  const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
  const depth = isRotated ? pedal.widthInches : pedal.depthInches;

  // Find current row
  const currentRowIdx = findNearestRowIndex(original.y, rowYPositions);

  // Pick a different row
  let newRowIdx = Math.floor(random() * rowYPositions.length);
  while (newRowIdx === currentRowIdx && rowYPositions.length > 1) {
    newRowIdx = Math.floor(random() * rowYPositions.length);
  }

  const newY = Math.min(rowYPositions[newRowIdx], board.depthInches - depth);
  if (newY < 0) return null;

  const result = [...placements];
  result[idx] = { ...original, y: newY };

  return result;
}

/**
 * Find the index of the nearest row to a given Y position
 */
function findNearestRowIndex(y: number, rowYPositions: number[]): number {
  let nearestIdx = 0;
  let nearestDist = Math.abs(y - rowYPositions[0]);

  for (let i = 1; i < rowYPositions.length; i++) {
    const dist = Math.abs(y - rowYPositions[i]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  return nearestIdx;
}

/**
 * Check if any pedals in the placements array collide.
 */
function hasAnyCollision(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): boolean {
  const boxes: PlacedBox[] = [];

  for (const placement of placements) {
    const placed = placedPedals.find((p) => p.id === placement.id);
    if (!placed) continue;

    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const width = isRotated ? pedal.depthInches : pedal.widthInches;
    const height = isRotated ? pedal.widthInches : pedal.depthInches;

    const box: PlacedBox = {
      x: placement.x,
      y: placement.y,
      width: width || 3,
      height: height || 5,
    };

    // Check bounds
    if (box.x < 0 || box.x + box.width > board.widthInches) return true;
    if (box.y < 0 || box.y + box.height > board.depthInches) return true;

    // Check collision with existing boxes
    for (const existing of boxes) {
      if (boxesOverlap(box, existing, MIN_SPACING)) return true;
    }

    boxes.push(box);
  }

  return false;
}

function boxesOverlap(a: PlacedBox, b: PlacedBox, spacing: number = 0): boolean {
  return !(
    a.x + a.width + spacing <= b.x ||
    b.x + b.width + spacing <= a.x ||
    a.y + a.height + spacing <= b.y ||
    b.y + b.height + spacing <= a.y
  );
}
