import type { Board, Pedal, PlacedPedal, RoutingConfig } from '@/types';
import { optimizeForCableLength } from './optimizer';

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

const MIN_SPACING = 0.5; // minimum inches between pedals (for cable access)

/**
 * Calculate optimal layout positions for all pedals based on signal chain order
 * Signal flows right-to-left: Guitar (right) → Pedals → Amp (left)
 *
 * Simple approach: place each pedal in the first valid position found,
 * scanning the board systematically with proper collision detection.
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

  // Build pedal info with dimensions
  const pedalInfos = sortedPedals.map(placed => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return {
      id: placed.id,
      width: pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87,
      depth: pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12,
    };
  });

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];

  // Get rail Y positions (sorted front to back - higher Y = front of board = bottom of canvas)
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  const rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05]; // Default: 2 rows

  // Place each pedal
  for (const info of pedalInfos) {
    const spot = findValidPosition(info.width, info.depth, placedBoxes, board, rowYPositions);

    placements.push({ id: info.id, x: spot.x, y: spot.y });
    placedBoxes.push({ x: spot.x, y: spot.y, width: info.width, height: info.depth });
  }

  return placements;
}

/**
 * Find a valid position for a pedal that doesn't collide with existing placements
 */
function findValidPosition(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board,
  rowYPositions: number[]
): { x: number; y: number } {
  const STEP = 0.25;

  // Try each row, placing from right to left (signal flows right to left)
  for (const rowY of rowYPositions) {
    // Clamp Y so pedal fits within board depth
    const y = Math.min(rowY, board.depthInches - depth);
    if (y < 0) continue;

    // Scan from right to left
    for (let x = board.widthInches - width; x >= 0; x -= STEP) {
      const candidate: PlacedBox = { x, y, width, height: depth };

      // Check bounds
      if (x < 0 || x + width > board.widthInches) continue;
      if (y < 0 || y + depth > board.depthInches) continue;

      // Check collision with all existing placements
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // If no row position works, scan entire board
  for (let y = 0; y <= board.depthInches - depth; y += STEP) {
    for (let x = board.widthInches - width; x >= 0; x -= STEP) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Last resort: return origin (will show collision)
  return { x: 0, y: 0 };
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
      name: pedal?.name || 'Unknown',
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

  // Y positions - use rail positions if available, otherwise use board edges
  // railYPositions are sorted front-to-back (higher values first = closer to front)
  // When only 1 rail is passed, use it for the back row and calculate front row from it
  const backY = railYPositions.length > 0
    ? railYPositions[railYPositions.length - 1]  // Last rail = back position for this group
    : 0;
  const backRowMaxDepth = Math.max(...backRowInfos.map(p => p.depth), 0);
  const frontRowDepth = Math.max(...frontRowInfos.map(p => p.depth), 5);

  // Calculate where back row ends (Y position + depth)
  const backRowBottom = backY + backRowMaxDepth;

  // Check if front row can fit below back row
  const minFrontY = backRowBottom + MIN_SPACING;
  const maxFrontY = board.depthInches - frontRowDepth;
  const canFitFrontRow = minFrontY <= maxFrontY;

  // If front row can't fit, merge everything into back row
  let effectiveBackRowInfos = backRowInfos;
  let effectiveFrontRowInfos = frontRowInfos;

  if (!canFitFrontRow && frontRowInfos.length > 0) {
    effectiveBackRowInfos = [...pedalInfos];
    effectiveFrontRowInfos = [];
  }

  const frontY = canFitFrontRow
    ? (railYPositions.length > 1
        ? Math.min(railYPositions[0], maxFrontY)
        : Math.min(minFrontY, maxFrontY))
    : backY; // Won't be used if front row is empty

  // Recalculate deep/normal split with effective rows
  const effectiveDeepBackInfos = effectiveBackRowInfos.filter(p => p.depth > deepThreshold);
  const effectiveNormalBackInfos = effectiveBackRowInfos.filter(p => p.depth <= deepThreshold);


  // === BACK ROW: Place from right to left ===
  // 1. Deep pedals on far right
  // 2. Normal back row pedals spread across remaining width

  let xCursor = board.widthInches - EDGE_MARGIN;

  // Place deep pedals (rightmost) with collision checking
  for (const info of effectiveDeepBackInfos) {
    const candidateX = xCursor - info.width;
    const pos = tryPlaceAtPosition(candidateX, backY, info.width, info.depth, placedBoxes, board)
      ?? findAnyValidPosition(info.width, info.depth, placedBoxes, board, railYPositions, candidateX);
    placements.push({ id: info.id, x: pos.x, y: pos.y });
    placedBoxes.push({ x: pos.x, y: pos.y, width: info.width, height: info.depth });
    xCursor = pos.x - MIN_SPACING;
  }

  // Calculate spacing for normal back row pedals
  const normalBackAvailableWidth = xCursor - EDGE_MARGIN;
  const effectiveNormalBackWidth = effectiveNormalBackInfos.reduce((s, p) => s + p.width, 0);
  const normalBackSpacing = effectiveNormalBackInfos.length > 1
    ? Math.max(MIN_SPACING, (normalBackAvailableWidth - effectiveNormalBackWidth) / (effectiveNormalBackInfos.length - 1))
    : MIN_SPACING;

  // Place normal back row pedals (spread from right to left) with collision checking
  for (const info of effectiveNormalBackInfos) {
    const candidateX = Math.max(EDGE_MARGIN, xCursor - info.width);
    // First try preferred position, then try all rails in this group
    let pos = tryPlaceAtPosition(candidateX, backY, info.width, info.depth, placedBoxes, board);
    if (!pos) {
      // Try other rails in the group at the same X
      for (const railY of railYPositions) {
        if (railY !== backY) {
          pos = tryPlaceAtPosition(candidateX, railY, info.width, info.depth, placedBoxes, board);
          if (pos) break;
        }
      }
    }
    // Final fallback: search entire group area
    if (!pos) {
      pos = findAnyValidPosition(info.width, info.depth, placedBoxes, board, railYPositions, board.widthInches);
    }
    placements.push({ id: info.id, x: pos.x, y: pos.y });
    placedBoxes.push({ x: pos.x, y: pos.y, width: info.width, height: info.depth });
    xCursor = pos.x - normalBackSpacing;
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
  const reversedFrontRow = [...effectiveFrontRowInfos].reverse();
  for (const info of reversedFrontRow) {
    const candidateX = xCursor;
    const pos = tryPlaceAtPosition(candidateX, frontY, info.width, info.depth, placedBoxes, board)
      ?? findAnyValidPosition(info.width, info.depth, placedBoxes, board, railYPositions, maxFrontX);
    placements.push({ id: info.id, x: pos.x, y: pos.y });
    placedBoxes.push({ x: pos.x, y: pos.y, width: info.width, height: info.depth });
    xCursor = pos.x + info.width + frontSpacing;
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
 * Stays within the Y range defined by railYPositions to avoid placing in wrong area
 */
function findAnyValidPosition(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board,
  railYPositions: number[],
  maxX: number
): { x: number; y: number } {
  // Determine Y range from rails (stay within this group's area)
  const minRailY = railYPositions.length > 0 ? Math.min(...railYPositions) : 0;
  const maxRailY = railYPositions.length > 0 ? Math.max(...railYPositions) : board.depthInches;

  // Try each rail, searching from left to right to find leftmost valid position
  // railY is positionFromBackInches which equals the Y coordinate (Y=0 is back of board)
  for (const railY of railYPositions) {
    // Place pedal so its top edge aligns with the rail position
    let y = Math.max(0, railY);
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

  // Search the full board for valid positions
  // Start from the group's preferred area but expand if needed
  const yEnd = board.depthInches - depth;

  // First try within the group's rail area with normal spacing
  for (let y = minRailY; y <= yEnd; y += 0.5) {
    for (let x = 0; x <= board.widthInches - width; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Try expanding into lower Y values (toward back of board) with normal spacing
  for (let y = minRailY - 0.5; y >= 0; y -= 0.5) {
    for (let x = 0; x <= board.widthInches - width; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, MIN_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Final fallback - no valid position found with MIN_SPACING
  // Try with half the spacing as a compromise
  const reducedSpacing = MIN_SPACING / 2;

  for (let y = 0; y <= yEnd; y += 0.5) {
    for (let x = 0; x <= board.widthInches - width; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, reducedSpacing));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Last resort: place at origin (will show collision warning to user)
  return { x: 0, y: 0 };
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
