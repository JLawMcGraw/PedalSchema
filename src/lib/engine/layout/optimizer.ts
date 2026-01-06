import type { Board, Pedal, PlacedPedal } from '@/types';
import { getJackPosition } from '../cables';

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

const MIN_SPACING = 0.5;

/**
 * Optimize pedal placements to minimize total cable length.
 * Uses local search: tries swapping positions and nudging pedals.
 * Respects signal chain order (chainPosition is not changed).
 */
export function optimizeForCableLength(
  initialPlacements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  maxIterations: number = 30
): PedalPlacement[] {
  if (initialPlacements.length <= 1) {
    return initialPlacements;
  }

  let current = [...initialPlacements];
  let currentScore = calculateTotalCableDistance(current, placedPedals, pedalsById, board);

  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;

    // Try swapping pairs of pedal positions
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const swapped = swapPositions(current, i, j);

        // Check for collisions after swap
        if (hasAnyCollision(swapped, placedPedals, pedalsById, board)) continue;

        const newScore = calculateTotalCableDistance(swapped, placedPedals, pedalsById, board);
        if (newScore < currentScore - 0.1) {
          // Require meaningful improvement
          current = swapped;
          currentScore = newScore;
          improved = true;
        }
      }
    }

    // Try nudging each pedal slightly
    const nudgeAmount = 0.5; // inches
    for (let i = 0; i < current.length; i++) {
      const nudges = [
        { dx: nudgeAmount, dy: 0 },
        { dx: -nudgeAmount, dy: 0 },
        { dx: 0, dy: nudgeAmount },
        { dx: 0, dy: -nudgeAmount },
      ];

      for (const nudge of nudges) {
        const nudged = nudgePosition(current, i, nudge.dx, nudge.dy, board);
        if (!nudged) continue;

        if (hasAnyCollision(nudged, placedPedals, pedalsById, board)) continue;

        const newScore = calculateTotalCableDistance(nudged, placedPedals, pedalsById, board);
        if (newScore < currentScore - 0.1) {
          current = nudged;
          currentScore = newScore;
          improved = true;
        }
      }
    }

    if (!improved) break; // Local optimum reached
  }

  return current;
}

/**
 * Calculate total cable distance for a layout.
 * Uses jack positions to calculate actual distances between connected pedals.
 */
function calculateTotalCableDistance(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): number {
  // Create a map of id -> placement for quick lookup
  const placementMap = new Map(placements.map((p) => [p.id, p]));

  // Sort pedals by chain position to find adjacent connections
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

    // Create a temporary placed pedal with the new position
    const tempPlaced: PlacedPedal = {
      ...placed,
      xInches: placement.x,
      yInches: placement.y,
    };

    // Find input jack position
    const inputJack = pedal.jacks?.find((j) => j.jackType === 'input');
    const inputPos = inputJack
      ? getJackPosition(tempPlaced, inputJack, pedal)
      : { x: placement.x + (pedal.widthInches || 3), y: placement.y + (pedal.depthInches || 5) / 2 };

    // Find output jack position
    const outputJack = pedal.jacks?.find((j) => j.jackType === 'output');
    const outputPos = outputJack
      ? getJackPosition(tempPlaced, outputJack, pedal)
      : { x: placement.x, y: placement.y + (pedal.depthInches || 5) / 2 };

    if (i === 0) {
      // First pedal: distance from guitar to input
      totalDistance += distance(guitarX, guitarY, inputPos.x, inputPos.y);
    } else {
      // Middle pedals: distance from previous output to this input
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
          const prevOutputJack = prevPedal.jacks?.find((j) => j.jackType === 'output');
          const prevOutputPos = prevOutputJack
            ? getJackPosition(prevTempPlaced, prevOutputJack, prevPedal)
            : { x: prevPlacement.x, y: prevPlacement.y + (prevPedal.depthInches || 5) / 2 };

          totalDistance += distance(prevOutputPos.x, prevOutputPos.y, inputPos.x, inputPos.y);
        }
      }
    }

    if (i === sortedPedals.length - 1) {
      // Last pedal: distance from output to amp
      totalDistance += distance(outputPos.x, outputPos.y, ampX, ampY);
    }
  }

  return totalDistance;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Swap positions of two pedals in the placements array.
 */
function swapPositions(placements: PedalPlacement[], i: number, j: number): PedalPlacement[] {
  const result = [...placements];
  result[i] = { ...placements[i], x: placements[j].x, y: placements[j].y };
  result[j] = { ...placements[j], x: placements[i].x, y: placements[i].y };
  return result;
}

/**
 * Nudge a pedal position by a small amount.
 */
function nudgePosition(
  placements: PedalPlacement[],
  index: number,
  dx: number,
  dy: number,
  board: Board
): PedalPlacement[] | null {
  const original = placements[index];
  const newX = original.x + dx;
  const newY = original.y + dy;

  // Check bounds (rough check, actual pedal size not considered here)
  if (newX < 0 || newX > board.widthInches - 1) return null;
  if (newY < 0 || newY > board.depthInches - 1) return null;

  const result = [...placements];
  result[index] = { ...original, x: newX, y: newY };
  return result;
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
