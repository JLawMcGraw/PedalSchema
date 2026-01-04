import type { Board, Pedal, PlacedPedal, Collision, BoundingBox } from '@/types';

/**
 * Get the bounding box for a placed pedal, accounting for rotation
 */
export function getPedalBoundingBox(
  placed: PlacedPedal,
  pedal: Pedal
): BoundingBox {
  const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;

  return {
    x: placed.xInches,
    y: placed.yInches,
    width: isRotated ? pedal.depthInches : pedal.widthInches,
    height: isRotated ? pedal.widthInches : pedal.depthInches,
  };
}

/**
 * Check if two bounding boxes overlap
 */
export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Check if a pedal is within board bounds
 */
export function isWithinBounds(box: BoundingBox, board: Board): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= board.widthInches &&
    box.y + box.height <= board.depthInches
  );
}

/**
 * Calculate the overlap area between two boxes (for severity)
 */
export function getOverlapArea(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return xOverlap * yOverlap;
}

/**
 * Detect all collisions between placed pedals
 */
export function detectCollisions(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): Collision[] {
  const collisions: Collision[] = [];
  const boundingBoxes: Map<string, BoundingBox> = new Map();

  // Calculate bounding boxes for all pedals
  for (const placed of placedPedals) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (pedal) {
      boundingBoxes.set(placed.id, getPedalBoundingBox(placed, pedal));
    }
  }

  // Check each pair for collision
  for (let i = 0; i < placedPedals.length; i++) {
    for (let j = i + 1; j < placedPedals.length; j++) {
      const boxA = boundingBoxes.get(placedPedals[i].id);
      const boxB = boundingBoxes.get(placedPedals[j].id);

      if (boxA && boxB && boxesOverlap(boxA, boxB)) {
        const overlapArea = getOverlapArea(boxA, boxB);
        const severity: Collision['severity'] =
          overlapArea > 0.5 ? 'overlap' : 'clearance';

        collisions.push({
          pedalIds: [placedPedals[i].id, placedPedals[j].id],
          severity,
        });
      }
    }
  }

  return collisions;
}

/**
 * Check if a position is valid for placing a pedal
 */
export function isValidPlacement(
  position: { x: number; y: number },
  pedal: Pedal,
  rotation: number,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  excludePedalId?: string
): { valid: boolean; reason?: string } {
  const isRotated = rotation === 90 || rotation === 270;
  const newBox: BoundingBox = {
    x: position.x,
    y: position.y,
    width: isRotated ? pedal.depthInches : pedal.widthInches,
    height: isRotated ? pedal.widthInches : pedal.depthInches,
  };

  // Check board bounds
  if (!isWithinBounds(newBox, board)) {
    return { valid: false, reason: 'Pedal extends outside board bounds' };
  }

  // Check for collisions with other pedals
  for (const placed of placedPedals) {
    if (excludePedalId && placed.id === excludePedalId) continue;

    const existingPedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!existingPedal) continue;

    const existingBox = getPedalBoundingBox(placed, existingPedal);

    if (boxesOverlap(newBox, existingBox)) {
      return { valid: false, reason: `Overlaps with ${existingPedal.name}` };
    }
  }

  return { valid: true };
}

/**
 * Find the nearest valid position with snap-to-rail
 */
export function snapToRail(
  position: { x: number; y: number },
  pedalDepth: number,
  board: Board,
  snapThreshold: number = 0.5
): { x: number; y: number; snapped: boolean } {
  if (!board.rails || board.rails.length === 0) {
    return { ...position, snapped: false };
  }

  // Check each rail for snap
  for (const rail of board.rails) {
    const railY = rail.positionFromBackInches;
    if (Math.abs(position.y - railY) < snapThreshold) {
      return { x: position.x, y: railY, snapped: true };
    }
  }

  return { ...position, snapped: false };
}

/**
 * Find an optimal spot on the board for a new pedal based on signal chain position.
 * Signal flows right-to-left: Guitar (right) -> Pedals -> Amp (left)
 * Earlier chain positions go on the right, later positions on the left.
 */
export function findEmptySpot(
  pedal: Pedal,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  chainPosition?: number
): { x: number; y: number } | null {
  const step = 0.5; // Check every 0.5 inches

  // Sort rails front-to-back (front row first for most accessible pedals)
  const rails = [...(board.rails || [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // Determine target X position based on chain position
  // Chain position 1 = rightmost, higher positions move left
  const totalChainPositions = placedPedals.length + 1;
  const effectiveChainPos = chainPosition ?? totalChainPositions;

  // Calculate target X: rightmost for first in chain, leftmost for last
  // Normalize chain position to 0-1 range, then map to board width
  const chainRatio = Math.min(effectiveChainPos / Math.max(totalChainPositions, 1), 1);
  const targetX = board.widthInches * (1 - chainRatio); // Invert so lower chain = right side

  // Find optimal position considering chain order
  let bestSpot: { x: number; y: number } | null = null;
  let bestDistance = Infinity;

  // Try rails first (preferred placement)
  for (const rail of rails) {
    const y = rail.positionFromBackInches;

    for (let x = 0; x <= board.widthInches - pedal.widthInches; x += step) {
      const result = isValidPlacement(
        { x, y },
        pedal,
        0,
        placedPedals,
        pedalsById,
        board
      );

      if (result.valid) {
        // Calculate distance from ideal position
        const distance = Math.abs(x - targetX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSpot = { x, y };
        }
      }
    }
  }

  if (bestSpot) return bestSpot;

  // If no rail positions work, try anywhere on board
  for (let y = 0; y <= board.depthInches - pedal.depthInches; y += step) {
    for (let x = 0; x <= board.widthInches - pedal.widthInches; x += step) {
      const result = isValidPlacement(
        { x, y },
        pedal,
        0,
        placedPedals,
        pedalsById,
        board
      );

      if (result.valid) {
        const distance = Math.abs(x - targetX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSpot = { x, y };
        }
      }
    }
  }

  return bestSpot;
}
