/**
 * Obstacle Service Module
 *
 * Single source of truth for obstacle data used by:
 * - Cable routing (routeCablePath)
 * - Cost function (calculateRoutingCost)
 * - Path validation (validateCablePath)
 *
 * CRITICAL: All obstacle generation must go through this module to ensure
 * consistency between what the optimizer predicts and what the renderer draws.
 */

import type { PlacedPedal, Pedal, Board } from '@/types';
import type { Box, Point } from '../geometry';

// Re-export types for convenience
export type { Box, Point };

// Default scale: 40 pixels per inch
const DEFAULT_SCALE = 40;

// Single source of truth for the cable clearance margin lives in ../geometry
export { OBSTACLE_MARGIN } from '../geometry';

/**
 * Board bounds in pixels
 */
export interface BoardBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Complete obstacle data for cable routing
 *
 * This is the SINGLE SOURCE OF TRUTH for obstacles.
 * Both the cost function and renderer must use this same data.
 */
export interface ObstacleSet {
  /** All pedal bounding boxes in pixels */
  boxes: Box[];

  /** Map from box index to placed pedal ID */
  boxToPedalId: Map<number, string>;

  /** Map from placed pedal ID to box index */
  pedalIdToBox: Map<string, number>;

  /** Board boundaries in pixels */
  boardBounds: BoardBounds;

  /** Scale factor used (pixels per inch) */
  scale: number;
}

/**
 * Generate obstacle data from placed pedals
 *
 * @param placedPedals - Array of placed pedals
 * @param pedalsById - Map of pedal definitions by ID
 * @param board - Board configuration
 * @param scale - Pixels per inch (default: 40)
 * @returns ObstacleSet with all obstacle data
 */
export function generateObstacles(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  scale: number = DEFAULT_SCALE
): ObstacleSet {
  const boxes: Box[] = [];
  const boxToPedalId = new Map<number, string>();
  const pedalIdToBox = new Map<string, number>();

  for (const placed of placedPedals) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    // Handle rotation: 90 or 270 swaps width and depth
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const widthInches = isRotated ? pedal.depthInches : pedal.widthInches;
    const depthInches = isRotated ? pedal.widthInches : pedal.depthInches;

    // Convert to pixels
    const box: Box = {
      x: placed.xInches * scale,
      y: placed.yInches * scale,
      width: widthInches * scale,
      height: depthInches * scale,
    };

    const index = boxes.length;
    boxes.push(box);
    boxToPedalId.set(index, placed.id);
    pedalIdToBox.set(placed.id, index);
  }

  // Board bounds in pixels
  const boardBounds: BoardBounds = {
    minX: 0,
    maxX: board.widthInches * scale,
    minY: 0,
    maxY: board.depthInches * scale,
  };

  return {
    boxes,
    boxToPedalId,
    pedalIdToBox,
    boardBounds,
    scale,
  };
}

/**
 * Convert exclude pedal IDs to exclude box indices
 */
export function pedalIdsToBoxIndices(
  excludePedalIds: Set<string>,
  obstacles: ObstacleSet
): Set<number> {
  const indices = new Set<number>();
  for (const pedalId of excludePedalIds) {
    const index = obstacles.pedalIdToBox.get(pedalId);
    if (index !== undefined) {
      indices.add(index);
    }
  }
  return indices;
}

/**
 * Get the box for a specific placed pedal
 */
export function getBoxForPedal(pedalId: string, obstacles: ObstacleSet): Box | null {
  const index = obstacles.pedalIdToBox.get(pedalId);
  if (index === undefined) return null;
  return obstacles.boxes[index] ?? null;
}
