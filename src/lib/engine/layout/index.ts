import type { Board, Pedal, PlacedPedal, RoutingConfig } from '@/types';

interface PedalPlacement {
  id: string;
  x: number;
  y: number;
}

interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SPACING = 0.5; // minimum inches between pedals
const IDEAL_SPACING = 1.0; // ideal inches between pedals when space allows

/**
 * Calculate optimal layout positions for all pedals based on signal chain order
 * Signal flows right-to-left: Guitar (right) → Pedals → Amp (left)
 *
 * Strategy: Fill each row from right to left following signal chain order.
 * When a row is full, continue on the next row from where we left off (left side).
 * This creates a snake pattern that minimizes cable lengths.
 */
export function calculateOptimalLayout(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): PedalPlacement[] {
  if (placedPedals.length === 0) {
    return [];
  }

  // Sort pedals by chain position
  const sortedPedals = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);

  // Get rail Y positions for snapping
  // Sort by positionFromBackInches DESCENDING so front rails (higher values = closer to front) are tried first
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  const railYPositions = rails.map(r => r.positionFromBackInches);

  // If no rails, create virtual rows based on pedal count
  if (railYPositions.length === 0) {
    const numRows = Math.max(2, Math.ceil(sortedPedals.length / 5));
    for (let i = 0; i < numRows; i++) {
      railYPositions.push(board.depthInches * (i + 1) / (numRows + 1));
    }
  }

  // Check if effects loop routing is actually enabled
  const effectsLoopEnabled = routingConfig?.useEffectsLoop === true;

  // Separate front-of-amp and effects loop pedals ONLY if effects loop is enabled
  // Otherwise, treat all pedals as front-of-amp for layout purposes
  let frontOfAmpPedals: PlacedPedal[];
  let effectsLoopPedals: PlacedPedal[];

  if (effectsLoopEnabled) {
    frontOfAmpPedals = sortedPedals.filter(p => p.location !== 'effects_loop');
    effectsLoopPedals = sortedPedals.filter(p => p.location === 'effects_loop');
  } else {
    // Effects loop not enabled - treat ALL pedals as front-of-amp
    frontOfAmpPedals = sortedPedals;
    effectsLoopPedals = [];
  }


  // Determine which rows to use for each group
  // If no effects loop pedals, use ALL rails for front-of-amp pedals
  let frontRails: number[];
  let backRails: number[];

  if (effectsLoopPedals.length === 0) {
    frontRails = railYPositions;
    backRails = [];
  } else {
    const numRails = railYPositions.length;
    frontRails = railYPositions.slice(0, Math.max(1, Math.ceil(numRails / 2)));
    backRails = railYPositions.slice(Math.floor(numRails / 2));
  }

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];

  // Place front-of-amp pedals
  placePedalGroupSnake(
    frontOfAmpPedals,
    pedalsById,
    board,
    frontRails.length > 0 ? frontRails : railYPositions,
    placements,
    placedBoxes
  );

  // Place effects loop pedals
  if (effectsLoopPedals.length > 0) {
    placePedalGroupSnake(
      effectsLoopPedals,
      pedalsById,
      board,
      backRails.length > 0 ? backRails : railYPositions,
      placements,
      placedBoxes
    );
  }

  return placements;
}

/**
 * Place pedals to fill the board while optimizing cable lengths.
 *
 * Layout strategy:
 * - Signal flows RIGHT to LEFT (Guitar → Pedals → Amp)
 * - Back row (y=0, top): First 2/3 of signal chain, spread across full width
 * - Front row (y=front, bottom): Last 1/3 of signal chain, on LEFT side
 * - Deep pedals (like wah) go on far right at y=0
 *
 * Coordinate system:
 * - y=0 is BACK of board (top of canvas)
 * - y=boardDepth is FRONT of board (bottom of canvas, near amp)
 */
function placePedalGroupSnake(
  pedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  railYPositions: number[],
  placements: PedalPlacement[],
  placedBoxes: PlacedBox[]
): void {
  if (pedals.length === 0) return;

  const EDGE_MARGIN = 0.5;

  // Build pedal info with dimensions
  const pedalInfos = pedals.map(placed => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return {
      id: placed.id,
      chainPosition: placed.chainPosition,
      width: pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87,
      depth: pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12,
    };
  });

  // Sort by chainPosition to ensure correct order
  pedalInfos.sort((a, b) => a.chainPosition - b.chainPosition);

  // Row split: last 1/3 of chain goes to front row
  const frontRowCount = Math.max(1, Math.floor(pedalInfos.length / 3));
  const backRowCount = pedalInfos.length - frontRowCount;

  // Split into rows by sorted index
  const backRowInfos = pedalInfos.slice(0, backRowCount);
  const frontRowInfos = pedalInfos.slice(backRowCount);


  // Deep threshold for pedals that span most of board depth
  const deepThreshold = board.depthInches * 0.6;

  // Identify deep pedals in back row (will be placed on right side)
  const deepBackInfos = backRowInfos.filter(p => p.depth > deepThreshold);
  const normalBackInfos = backRowInfos.filter(p => p.depth <= deepThreshold);

  // Calculate total widths
  const deepWidth = deepBackInfos.reduce((s, p) => s + p.width, 0);
  const normalBackWidth = normalBackInfos.reduce((s, p) => s + p.width, 0);
  const frontWidth = frontRowInfos.reduce((s, p) => s + p.width, 0);

  const usableWidth = board.widthInches - 2 * EDGE_MARGIN;

  // Y positions
  const backY = 0;
  const frontRowDepth = Math.max(...frontRowInfos.map(p => p.depth), 5);
  const frontY = board.depthInches - frontRowDepth;

  // === BACK ROW: Place from right to left ===
  // 1. Deep pedals on far right
  // 2. Normal back row pedals spread across remaining width

  let xCursor = board.widthInches - EDGE_MARGIN;

  // Place deep pedals (rightmost)
  for (const info of deepBackInfos) {
    const x = xCursor - info.width;
    placements.push({ id: info.id, x, y: backY });
    placedBoxes.push({ x, y: backY, width: info.width, height: info.depth });
    xCursor = x - MIN_SPACING;
  }

  // Calculate spacing for normal back row pedals
  const normalBackAvailableWidth = xCursor - EDGE_MARGIN;
  const normalBackSpacing = normalBackInfos.length > 1
    ? Math.max(MIN_SPACING, (normalBackAvailableWidth - normalBackWidth) / (normalBackInfos.length - 1))
    : 0;

  // Place normal back row pedals (spread from right to left)
  for (const info of normalBackInfos) {
    const x = Math.max(EDGE_MARGIN, xCursor - info.width);
    placements.push({ id: info.id, x, y: backY });
    placedBoxes.push({ x, y: backY, width: info.width, height: info.depth });
    xCursor = x - normalBackSpacing;
  }

  // === FRONT ROW: Place on LEFT side from left to right ===
  // Find rightmost X that doesn't collide with deep pedals at front Y level
  let maxFrontX = board.widthInches - EDGE_MARGIN;
  for (const box of placedBoxes) {
    const boxBottom = box.y + box.height;
    // Check if this box extends into front row Y range
    if (boxBottom > frontY) {
      maxFrontX = Math.min(maxFrontX, box.x - MIN_SPACING);
    }
  }

  // Front row pedals stay close together on the left (minimal spacing)
  // This creates shorter cable runs from the back row
  const frontSpacing = MIN_SPACING;

  // Place front row pedals from left edge, in REVERSE order
  // so that higher chain positions (closer to amp) are on the left
  xCursor = EDGE_MARGIN;
  const reversedFrontRow = [...frontRowInfos].reverse();
  for (const info of reversedFrontRow) {
    placements.push({ id: info.id, x: xCursor, y: frontY });
    placedBoxes.push({ x: xCursor, y: frontY, width: info.width, height: info.depth });
    xCursor += info.width + frontSpacing;
  }
}

/**
 * Try to place a pedal at a specific position (exact placement, no searching)
 */
function tryPlaceAtPosition(
  x: number,
  y: number,
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board
): { x: number; y: number } | null {
  // Check bounds
  if (x < 0 || x + width > board.widthInches) return null;
  if (y < 0 || y + depth > board.depthInches) return null;

  const candidate: PlacedBox = { x, y, width, height: depth };
  const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));

  if (!hasCollision) {
    return { x, y };
  }

  return null;
}

/**
 * Find any valid position as a last resort
 * maxX limits the search to positions LEFT of the given X (to maintain signal chain order)
 */
function findAnyValidPosition(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board,
  railYPositions: number[],
  maxX: number
): { x: number; y: number } {
  // Try each rail, searching from left to right to find leftmost valid position
  for (const railY of railYPositions) {
    const yFromFront = board.depthInches - railY;
    let y = Math.max(0, yFromFront - depth / 2);
    y = Math.min(y, board.depthInches - depth);

    // Search from x=0 (closest to amp) up to maxX
    const searchLimit = Math.min(maxX, board.widthInches - width);
    for (let x = 0; x <= searchLimit; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // If restricted search failed, search the full board (sacrificing signal chain order to avoid collision)
  for (const railY of railYPositions) {
    const yFromFront = board.depthInches - railY;
    let y = Math.max(0, yFromFront - depth / 2);
    y = Math.min(y, board.depthInches - depth);

    for (let x = 0; x <= board.widthInches - width; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Absolute fallback - place at center
  return {
    x: 0,
    y: Math.max(0, board.depthInches / 2 - depth / 2)
  };
}

/**
 * Check if two boxes overlap (with optional spacing)
 */
function boxesOverlap(a: PlacedBox, b: PlacedBox, spacing: number = 0): boolean {
  return !(
    a.x + a.width + spacing <= b.x ||
    b.x + b.width + spacing <= a.x ||
    a.y + a.height + spacing <= b.y ||
    b.y + b.height + spacing <= a.y
  );
}

/**
 * Simple single-row layout (fallback)
 */
export function calculateSimpleLayout(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): PedalPlacement[] {
  if (placedPedals.length === 0) return [];

  const sorted = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);
  const placements: PedalPlacement[] = [];
  let currentX = board.widthInches;
  const centerY = board.depthInches / 2;

  for (const placed of sorted) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const width = isRotated ? pedal.depthInches : pedal.widthInches;
    const depth = isRotated ? pedal.widthInches : pedal.depthInches;

    currentX -= width + MIN_SPACING;
    currentX = Math.max(0, currentX);

    placements.push({
      id: placed.id,
      x: currentX,
      y: Math.max(0, Math.min(centerY - depth / 2, board.depthInches - depth)),
    });
  }

  return placements;
}
