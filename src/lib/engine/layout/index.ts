import type { Board, Pedal, PlacedPedal, RoutingConfig, JointOptimizationResult, PedalPlacement, SwappableGroup } from '@/types';
import { calculateRoutingCost } from './routing-cost';
import { identifySwappableGroups } from '../signal-chain';
import { COLLISION_SPACING } from '../collision';
import { AMP_RETURN_Y_FRACTION, AMP_SEND_Y_FRACTION } from '../cables/endpoints';

interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculate greedy initial placement for pedals using SNAKE PATTERN.
 * Signal flows right-to-left: Guitar (right) → Pedals → Amp (left)
 *
 * Snake pattern minimizes cable length between rows:
 * - Row 1 (front/bottom): Right → Left
 * - Row 2 (back/top): Left → Right (continues from where row 1 ended)
 * - Row 3: Right → Left (continues from where row 2 ended)
 *
 * This ensures pedals that are adjacent in the chain are also adjacent physically.
 */
export function calculateGreedyPlacement(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): PedalPlacement[] {
  if (placedPedals.length === 0) {
    return [];
  }

  // Split pedals by location for zone-based placement
  // IMPORTANT: When effects loop is disabled, ALL pedals are front-of-amp regardless of location property
  const useEffectsLoop = routingConfig?.useEffectsLoop ?? false;
  const frontOfAmpPedals = useEffectsLoop
    ? placedPedals.filter(p => p.location !== 'effects_loop')
    : [...placedPedals]; // ALL pedals when effects loop is disabled
  const effectsLoopPedals = useEffectsLoop
    ? placedPedals.filter(p => p.location === 'effects_loop')
    : [];

  // Get rail Y positions (sorted front to back - higher Y values first)
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  let rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05]; // Default: 2 rows (front, back)

  // If rails are too close for the largest pedal depth, fall back to safe row positions.
  const maxDepth = placedPedals.reduce((max, placed) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return max;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const depth = isRotated ? pedal.widthInches : pedal.depthInches;
    return Math.max(max, depth);
  }, 0);

  if (rowYPositions.length >= 2 && maxDepth > 0) {
    // Evaluate the gap between the rows as pedals would actually OCCUPY
    // them: rows get clamped so pedals fit the board depth, which can
    // silently shrink the real gap (e.g., rail 8 on a 12.5" board clamps to
    // 7.42 for 5.08" pedals, leaving 0.34" to a row at 2). Fall back to safe
    // rows whenever any adjacent pair of occupied bands violates spacing.
    const clamped = rowYPositions
      .map((r) => Math.max(0, Math.min(r, board.depthInches - maxDepth)))
      .sort((a, b) => b - a);
    let tooClose = false;
    for (let i = 0; i < clamped.length - 1; i++) {
      const bandGap = clamped[i] - (clamped[i + 1] + maxDepth);
      if (bandGap < COLLISION_SPACING - 1e-6) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      rowYPositions = [
        Math.max(0, board.depthInches - maxDepth),
        0,
      ];
      console.warn('[GREEDY] Rails too close for pedal depth; using safe row positions');
    }
  }

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];

  // Debug logging
  const DEBUG_PLACEMENT = typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug');

  // Calculate zone boundaries if effects loop is active
  // Use dynamic sizing so loop zone can actually fit its pedals
  let ampZoneBoundary = 0;
  let zonesOverlap = false;
  if (useEffectsLoop && effectsLoopPedals.length > 0) {
    const boardWidth = board.widthInches;
    const getWidth = (placed: PlacedPedal): number => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      return pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87;
    };

    const frontWidths = frontOfAmpPedals.map(getWidth);
    const loopWidths = effectsLoopPedals.map(getWidth);
    const maxFrontWidth = frontWidths.length > 0 ? Math.max(...frontWidths) : 0;
    const maxLoopWidth = loopWidths.length > 0 ? Math.max(...loopWidths) : 0;

    const frontRequired = frontWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, frontWidths.length - 1) * COLLISION_SPACING;
    const loopRequired = loopWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, loopWidths.length - 1) * COLLISION_SPACING;

    const minFront = Math.max(maxFrontWidth + COLLISION_SPACING, boardWidth * 0.3);
    const minLoop = Math.max(maxLoopWidth + COLLISION_SPACING, boardWidth * 0.3);

    const maxLoop = Math.max(0, boardWidth - minFront);
    if (maxLoop < minLoop) {
      zonesOverlap = true;
      ampZoneBoundary = Math.max(minLoop, boardWidth * 0.35);
      ampZoneBoundary = Math.min(ampZoneBoundary, boardWidth);
      console.warn('[GREEDY] FX loop zone overlaps front zone due to limited width');
    } else {
      ampZoneBoundary = Math.max(minLoop, Math.min(loopRequired, maxLoop));
    }

    const frontZoneWidth = boardWidth - ampZoneBoundary;
    if (frontRequired > frontZoneWidth + 0.01 || loopRequired > ampZoneBoundary + 0.01) {
      zonesOverlap = true;
      console.warn('[GREEDY] FX loop/front zone overlap enabled to fit pedal widths');
    }

    if (DEBUG_PLACEMENT) {
      console.log('[GREEDY] Zone sizing', {
        boardWidth,
        frontRequired,
        loopRequired,
        minFront,
        minLoop,
        ampZoneBoundary,
        zonesOverlap,
      });
    }
  }

  // Place front-of-amp pedals using SNAKE PATTERN
  const frontSorted = [...frontOfAmpPedals].sort((a, b) => a.chainPosition - b.chainPosition);
  const frontZoneMin = zonesOverlap ? 0 : ampZoneBoundary;
  const loopZoneMax = zonesOverlap ? board.widthInches : ampZoneBoundary;

  if (DEBUG_PLACEMENT) {
    console.log('[GREEDY] Starting snake placement');
    console.log('[GREEDY] Row Y positions:', rowYPositions);
    console.log('[GREEDY] Pedals to place:', frontSorted.map(p => `${p.chainPosition}:${pedalsById[p.pedalId]?.name || 'Unknown'}`));
  }

  // === PLACE EFFECTS LOOP PEDALS FIRST ===
  // They get priority on the amp-side corner of the row nearest the amp's
  // send/return jacks (upper half of the amp panel), so the loop reads as a
  // tight cluster next to SND/RTN. The front chain places afterwards and
  // slides in around them.
  if (effectsLoopPedals.length > 0) {
    if (DEBUG_PLACEMENT) {
      console.log(`[GREEDY] Placing ${effectsLoopPedals.length} effects loop pedals in zone 0-${ampZoneBoundary.toFixed(2)}`);
    }
    const loopSorted = [...effectsLoopPedals].sort((a, b) => a.chainPosition - b.chainPosition);

    const getLoopWidth = (placed: PlacedPedal): number => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      return pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87;
    };

    // Loop pedals flow right-to-left like the front chain (inputs are on
    // the right edge, outputs on the left; amp send/return are both at the
    // LEFT edge). Pack the whole loop chain against the amp side so the
    // last pedal (into amp return) lands at x=0.
    // Returns the desired left edge for the pedal at startIdx.
    const getLoopDepth = (placed: PlacedPedal): number => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      return pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12;
    };
    const packedLoopStartX = (startIdx: number, rowY: number): number => {
      let total = 0;
      let depthNeeded = 0;
      for (let j = startIdx; j < loopSorted.length; j++) {
        total += getLoopWidth(loopSorted[j]) + (j > startIdx ? COLLISION_SPACING : 0);
        depthNeeded = Math.max(depthNeeded, getLoopDepth(loopSorted[j]));
      }
      const firstWidth = getLoopWidth(loopSorted[startIdx]);
      const stripX = findStripStart(total, depthNeeded, rowY, placedBoxes, board, 0);
      if (stripX !== null) {
        return Math.min(loopZoneMax - firstWidth, stripX + total - firstWidth);
      }
      return Math.max(0, Math.min(loopZoneMax - firstWidth, total - firstWidth));
    };

    // Prefer the row whose pedal centers sit closest to the send/return
    // jacks (upper half of the board edge)
    const maxLoopDepth = loopSorted.reduce((max, lp) => {
      const pedal = pedalsById[lp.pedalId] || lp.pedal;
      const isRotated = lp.rotationDegrees === 90 || lp.rotationDegrees === 270;
      return Math.max(max, pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12);
    }, 0);
    const loopAnchorY = board.depthInches * (AMP_RETURN_Y_FRACTION + AMP_SEND_Y_FRACTION) / 2;
    const loopRowOrder = rowYPositions
      .map((rowY, index) => ({ index, dist: Math.abs(Math.min(rowY, board.depthInches - maxLoopDepth) + maxLoopDepth / 2 - loopAnchorY) }))
      .sort((a, b) => a.dist - b.dist)
      .map((r) => r.index);

    let loopRowPos = 0; // position within loopRowOrder
    let loopX = packedLoopStartX(0, rowYPositions[loopRowOrder[0]] ?? board.depthInches * 0.5);

    for (let loopIdx = 0; loopIdx < loopSorted.length; loopIdx++) {
      const placed = loopSorted[loopIdx];
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      const width = pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87;
      const depth = pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12;

      const loopRowY = rowYPositions[loopRowOrder[loopRowPos]] ?? board.depthInches * 0.5;
      let spot = findValidPositionInRowStartingFrom(
        width, depth, placedBoxes, board, loopRowY,
        0, loopZoneMax,
        loopIdx === 0 ? loopX : loopX - width,
        'right-to-left',
        false
      );

      if (!spot && loopRowPos < loopRowOrder.length - 1) {
        loopRowPos++;
        const nextLoopRowY = rowYPositions[loopRowOrder[loopRowPos]] ?? board.depthInches * 0.5;
        loopX = packedLoopStartX(loopIdx, nextLoopRowY);
        spot = findValidPositionInRowStartingFrom(
          width, depth, placedBoxes, board, nextLoopRowY,
          0, loopZoneMax,
          loopX,
          'right-to-left',
          false
        );
      }

      // Relax order constraint with a warning if we still can't place
      if (!spot) {
        console.warn(`[GREEDY] FX loop order relaxed for ${pedal?.name || placed.id} - no space without breaking chain order`);
        for (let tryRowPos = loopRowPos; tryRowPos < loopRowOrder.length && !spot; tryRowPos++) {
          const tryRowY = rowYPositions[loopRowOrder[tryRowPos]] ?? board.depthInches * 0.5;
          spot = findValidPositionInRowStartingFrom(
            width, depth, placedBoxes, board, tryRowY,
            0, loopZoneMax,
            packedLoopStartX(loopIdx, tryRowY),
            'right-to-left',
            true
          );
        }
      }

      // Ultimate fallback if still no space
      if (!spot) {
        console.warn(`[GREEDY] FX loop fallback placement for ${pedal?.name || placed.id} - no valid spot in zone`);
        spot = findValidPositionInZone(
          width, depth, placedBoxes, board, rowYPositions,
          0, loopZoneMax,
          'right-to-left'
        );
      }

      if (DEBUG_PLACEMENT) {
        console.log(`[GREEDY] FX Loop: ${placed.chainPosition}:${pedal?.name} at (${spot.x.toFixed(2)}, ${spot.y.toFixed(2)})`);
      }

      placements.push({ id: placed.id, x: spot.x, y: spot.y });
      placedBoxes.push({ x: spot.x, y: spot.y, width, height: depth });

      // Update cursor to preserve right-to-left ordering
      loopX = spot.x - COLLISION_SPACING;
    }

    // Inflate the loop cluster's boxes before the front chain places around
    // it: the loop's send/return cables need a corridor next to the cluster
    // (both jacks often face the adjacent front pedal), and the minimum
    // pedal spacing (0.5") only fits ONE cable lane. The extra 0.7" gives
    // the gap room for up to three separated lanes (loop send/return plus a
    // front chain hop routinely share this corridor). Recorded placements
    // keep the real coordinates - this only affects collision checks.
    const LOOP_CABLE_CLEARANCE = 0.7;
    for (let b = 0; b < placedBoxes.length; b++) {
      placedBoxes[b] = {
        x: placedBoxes[b].x - LOOP_CABLE_CLEARANCE,
        y: placedBoxes[b].y - LOOP_CABLE_CLEARANCE,
        width: placedBoxes[b].width + LOOP_CABLE_CLEARANCE * 2,
        height: placedBoxes[b].height + LOOP_CABLE_CLEARANCE * 2,
      };
    }
  }

  // Track current row and cursor position
  // Always place right-to-left so later pedals stay closer to the amp (left)
  let currentRowIndex = 0;
  let currentX = board.widthInches;

  const getFrontWidth = (placed: PlacedPedal): number => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87;
  };
  const getFrontDepth = (placed: PlacedPedal): number => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12;
  };

  // When overflowing to a new row, the remaining chain pedals should pack
  // against the LEFT (amp-side) edge of the row in right-to-left chain
  // order, so the last pedal of the chain ends up closest to the amp.
  // Strip-aware: existing boxes on the row (e.g., the FX loop cluster)
  // shift the pack start so the whole remaining chain still fits as one
  // contiguous run instead of scattering.
  // Returns the desired left edge for the pedal at startIdx.
  const packedOverflowStartX = (startIdx: number, rowY: number): number => {
    let total = 0;
    let depthNeeded = 0;
    for (let j = startIdx; j < frontSorted.length; j++) {
      total += getFrontWidth(frontSorted[j]) + (j > startIdx ? COLLISION_SPACING : 0);
      depthNeeded = Math.max(depthNeeded, getFrontDepth(frontSorted[j]));
    }
    const firstWidth = getFrontWidth(frontSorted[startIdx]);
    const stripX = findStripStart(total, depthNeeded, rowY, placedBoxes, board, frontZoneMin);
    if (stripX !== null) {
      return stripX + total - firstWidth;
    }
    return Math.min(board.widthInches - firstWidth, frontZoneMin + total - firstWidth);
  };

  for (let pedalIdx = 0; pedalIdx < frontSorted.length; pedalIdx++) {
    const placed = frontSorted[pedalIdx];
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const width = pedal ? (isRotated ? pedal.depthInches : pedal.widthInches) : 2.87;
    const depth = pedal ? (isRotated ? pedal.widthInches : pedal.depthInches) : 5.12;

    // Try to place in current row. The desired left edge is EXACTLY tight
    // against the previous pedal (cursor - width): the search tries it
    // before grid-stepping, so packed rows don't leak up to 0.25" per pedal
    // (which starved the last pedal of its slot on full rows).
    const rowY = rowYPositions[currentRowIndex] ?? board.depthInches * 0.5;
    let spot = findValidPositionInRowStartingFrom(
      width, depth, placedBoxes, board,
      rowY,
      frontZoneMin, board.widthInches,
      currentX - width,
      'right-to-left',
      false
    );

    // If no space in current row, move to next row: pack the remaining
    // chain against the amp-side edge so the LAST pedal lands closest to
    // the amp (e.g., [.., BF-3, RC-1] -> BF-3 right of RC-1, RC-1 at x=0)
    if (!spot && currentRowIndex < rowYPositions.length - 1) {
      currentRowIndex++;
      const nextRowY = rowYPositions[currentRowIndex] ?? board.depthInches * 0.5;
      currentX = packedOverflowStartX(pedalIdx, nextRowY);
      if (DEBUG_PLACEMENT) {
        console.log(`[GREEDY] Moving to row ${currentRowIndex}, packed startX=${currentX.toFixed(2)}`);
      }
      spot = findValidPositionInRowStartingFrom(
        width, depth, placedBoxes, board,
        nextRowY,
        frontZoneMin, board.widthInches,
        currentX,
        'right-to-left',
        true // packed spot may be held by a loop pedal - slide right of it
      );
    }

    // If still no space, try remaining rows
    if (!spot) {
      for (let tryRowIdx = currentRowIndex + 1; tryRowIdx < rowYPositions.length && !spot; tryRowIdx++) {
        currentRowIndex = tryRowIdx;
        const tryRowY = rowYPositions[tryRowIdx] ?? board.depthInches * 0.5;
        currentX = packedOverflowStartX(pedalIdx, tryRowY);
        if (DEBUG_PLACEMENT) {
          console.log(`[GREEDY] Trying row ${tryRowIdx}`);
        }
        spot = findValidPositionInRowStartingFrom(
          width, depth, placedBoxes, board,
          tryRowY,
          frontZoneMin, board.widthInches,
          currentX,
          'right-to-left',
          true
        );
      }
    }

    // Relax order constraint with a warning if we still can't place
    if (!spot) {
      console.warn(`[GREEDY] Order relaxed for ${pedal?.name || placed.id} - no space without breaking chain order`);
      for (let tryRowIdx = currentRowIndex; tryRowIdx < rowYPositions.length && !spot; tryRowIdx++) {
        const tryRowY = rowYPositions[tryRowIdx] ?? board.depthInches * 0.5;
        spot = findValidPositionInRowStartingFrom(
          width, depth, placedBoxes, board,
          tryRowY,
          frontZoneMin, board.widthInches,
          currentX,
          'right-to-left',
          true
        );
      }
    }

    // Ultimate fallback if still no space
    if (!spot) {
      console.warn(`[GREEDY] Fallback placement for ${pedal?.name || placed.id} - no valid spot in zone`);
      spot = findValidPositionInZone(
        width, depth, placedBoxes, board, rowYPositions,
        frontZoneMin, board.widthInches,
        'right-to-left'
      );
    }

    if (DEBUG_PLACEMENT) {
      console.log(`[GREEDY] Placed ${placed.chainPosition}:${pedal?.name} at (${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}) row=${currentRowIndex}`);
    }

    placements.push({ id: placed.id, x: spot.x, y: spot.y });
    placedBoxes.push({ x: spot.x, y: spot.y, width, height: depth });

    // Update cursor to preserve right-to-left ordering
    currentX = spot.x - COLLISION_SPACING;
  }

  return placements;
}

/**
 * Find a valid position in a row, starting near a specific X position.
 * Searches outward from startX, preferring positions to the LEFT (toward amp).
 * This minimizes cable length from the previous pedal.
 */
function findValidPositionInRowStartingFrom(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board,
  rowY: number,
  zoneMinX: number,
  zoneMaxX: number,
  startX: number,
  direction: 'right-to-left' | 'left-to-right',
  allowOpposite: boolean = false
): { x: number; y: number } | null {
  const STEP = 0.25;
  const y = Math.min(rowY, board.depthInches - depth);
  if (y < 0) return null;

  // Clamp startX to valid range based on direction
  // startX is treated as the desired LEFT edge for the next pedal
  const clampedStartX = Math.max(zoneMinX, Math.min(startX, zoneMaxX - width));

  if (direction === 'right-to-left') {
    // Only move left to preserve chain order unless allowOpposite is true
    for (let x = clampedStartX; x >= zoneMinX; x -= STEP) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      if (isValidPlacement(candidate, placedBoxes, board)) {
        return { x, y };
      }
    }
    // The stepped scan can miss the exact zone edge (startX may not be
    // grid-aligned) - try it explicitly so tight packs against the amp
    // side succeed
    if (isValidPlacement({ x: zoneMinX, y, width, height: depth }, placedBoxes, board)) {
      return { x: zoneMinX, y };
    }
    if (allowOpposite) {
      for (let x = clampedStartX + STEP; x <= zoneMaxX - width; x += STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    }
  } else {
    // left-to-right
    for (let x = clampedStartX; x <= zoneMaxX - width; x += STEP) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      if (isValidPlacement(candidate, placedBoxes, board)) {
        return { x, y };
      }
    }
    if (allowOpposite) {
      for (let x = clampedStartX - STEP; x >= zoneMinX; x -= STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    }
  }

  return null;
}

/**
 * Find the leftmost x where a contiguous strip of the given total width fits
 * on the row, respecting existing boxes. Used by packed placement so a chain
 * segment lands as one tight run even when other clusters (e.g., the FX loop)
 * already occupy part of the row. Returns null when the row can't hold the
 * whole strip.
 */
function findStripStart(
  totalWidth: number,
  depth: number,
  rowY: number,
  placedBoxes: PlacedBox[],
  board: Board,
  zoneMinX: number
): number | null {
  const STEP = 0.25;
  const y = Math.max(0, Math.min(rowY, board.depthInches - depth));
  for (let x = Math.max(0, zoneMinX); x + totalWidth <= board.widthInches + 1e-6; x += STEP) {
    const strip: PlacedBox = { x, y, width: totalWidth, height: depth };
    if (isValidPlacement(strip, placedBoxes, board)) {
      return x;
    }
  }
  return null;
}

/**
 * Absolute fallback: any free spot on the board, relaxing the spacing
 * requirement progressively (0.5" -> 0.25" -> touching) before giving up.
 * Prevents the pedal-stacking failure mode where multiple pedals land on
 * the same clamped coordinate.
 */
function findAnyFreeSpot(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board
): { x: number; y: number } | null {
  const STEP = 0.25;
  for (const spacing of [COLLISION_SPACING, 0.25, 0]) {
    for (let y = 0; y <= board.depthInches - depth + 1e-6; y += STEP) {
      for (let x = 0; x <= board.widthInches - width + 1e-6; x += STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (
          !placedBoxes.some((box) => boxesOverlap(candidate, box, spacing))
        ) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

/**
 * Find a valid position within a specific zone of the board
 */
function findValidPositionInZone(
  width: number,
  depth: number,
  placedBoxes: PlacedBox[],
  board: Board,
  rowYPositions: number[],
  zoneMinX: number,
  zoneMaxX: number,
  direction: 'left-to-right' | 'right-to-left'
): { x: number; y: number } {
  const STEP = 0.25;
  const safeMinX = Math.max(0, zoneMinX);
  const safeMaxX = Math.min(board.widthInches, zoneMaxX);
  const maxXForWidth = safeMaxX - width;

  if (maxXForWidth < safeMinX) {
    return { x: Math.max(0, Math.min(board.widthInches - width, safeMinX)), y: 0 };
  }

  // Try each row
  for (const rowY of rowYPositions) {
    const y = Math.min(rowY, board.depthInches - depth);
    if (y < 0) continue;

    if (direction === 'right-to-left') {
      // Scan from right to left within zone
      for (let x = maxXForWidth; x >= safeMinX; x -= STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    } else {
      // Scan from left to right within zone
      for (let x = safeMinX; x <= maxXForWidth; x += STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    }
  }

  // Fallback: scan entire zone
  for (let y = 0; y <= board.depthInches - depth; y += STEP) {
    if (direction === 'right-to-left') {
      for (let x = maxXForWidth; x >= safeMinX; x -= STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    } else {
      for (let x = safeMinX; x <= maxXForWidth; x += STEP) {
        const candidate: PlacedBox = { x, y, width, height: depth };
        if (isValidPlacement(candidate, placedBoxes, board)) {
          return { x, y };
        }
      }
    }
  }

  // Any free spot anywhere on the board (progressively relaxed spacing)
  const anywhere = findAnyFreeSpot(width, depth, placedBoxes, board);
  if (anywhere) return anywhere;

  // Truly full board - clamp within bounds (will show as a collision)
  const fallbackX = Math.max(0, Math.min(board.widthInches - width, direction === 'right-to-left' ? maxXForWidth : safeMinX));
  const fallbackY = Math.max(0, Math.min(board.depthInches - depth, 0));
  return { x: fallbackX, y: fallbackY };
}

/**
 * Check if a placement is valid (within bounds and no collisions)
 */
function isValidPlacement(candidate: PlacedBox, placedBoxes: PlacedBox[], board: Board): boolean {
  // Check bounds
  if (candidate.x < 0 || candidate.x + candidate.width > board.widthInches) return false;
  if (candidate.y < 0 || candidate.y + candidate.height > board.depthInches) return false;

  // Check collisions
  return !placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
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
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // If no row position works, scan entire board
  for (let y = 0; y <= board.depthInches - depth; y += STEP) {
    for (let x = board.widthInches - width; x >= 0; x -= STEP) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
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
  const minFrontY = backRowBottom + COLLISION_SPACING;
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
    xCursor = pos.x - COLLISION_SPACING;
  }

  // Calculate spacing for normal back row pedals
  const normalBackAvailableWidth = xCursor - EDGE_MARGIN;
  const effectiveNormalBackWidth = effectiveNormalBackInfos.reduce((s, p) => s + p.width, 0);
  const normalBackSpacing = effectiveNormalBackInfos.length > 1
    ? Math.max(COLLISION_SPACING, (normalBackAvailableWidth - effectiveNormalBackWidth) / (effectiveNormalBackInfos.length - 1))
    : COLLISION_SPACING;

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
      maxFrontX = Math.min(maxFrontX, box.x - COLLISION_SPACING);
    }
  }

  // Front row pedals stay close together on the left (minimal spacing)
  // This creates shorter cable runs from the back row
  const frontSpacing = COLLISION_SPACING;

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
  const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));

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
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
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
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Try expanding into lower Y values (toward back of board) with normal spacing
  for (let y = minRailY - 0.5; y >= 0; y -= 0.5) {
    for (let x = 0; x <= board.widthInches - width; x += 0.5) {
      const candidate: PlacedBox = { x, y, width, height: depth };
      const hasCollision = placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING));
      if (!hasCollision) {
        return { x, y };
      }
    }
  }

  // Final fallback - no valid position found with COLLISION_SPACING
  // Try with half the spacing as a compromise
  const reducedSpacing = COLLISION_SPACING / 2;

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
  // Small epsilon so pedals packed at EXACTLY the required spacing
  // (accumulated float arithmetic) don't register as colliding
  const EPSILON = 1e-6;
  return !(
    a.x + a.width + spacing <= b.x + EPSILON ||
    b.x + b.width + spacing <= a.x + EPSILON ||
    a.y + a.height + spacing <= b.y + EPSILON ||
    b.y + b.height + spacing <= a.y + EPSILON
  );
}

/**
 * Calculate optimal layout with joint topology + geometry optimization.
 *
 * This is the recommended function for optimize layout - it:
 * 1. Creates signal-flow layout (pedals in chain order, right-to-left)
 * 2. Detects swappable groups (consecutive pedals of same category)
 * 3. Tries different orderings within swappable groups to minimize cable length
 * 4. Returns optimized placements AND optimized signal chain order
 *
 * The approach is CONSERVATIVE - it maintains the signal-flow layout structure
 * and only optimizes within swappable groups.
 */
export function calculateOptimalLayoutJoint(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): JointOptimizationResult {
  if (placedPedals.length === 0) {
    return {
      placements: [],
      chainOrder: [],
      swappableGroups: [],
    };
  }

  // Identify swappable groups (consecutive pedals of same category)
  const sortedPedals = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);
  const swappableGroups = identifySwappableGroups(sortedPedals, pedalsById);

  // Get initial chain order
  const initialChainOrder = sortedPedals.map(p => p.id);

  // Extract routing config flags
  const useEffectsLoop = routingConfig?.useEffectsLoop ?? false;
  const use4CableMethod = routingConfig?.use4CableMethod ?? false;

  // If no swappable groups, just use greedy placement (no optimization needed)
  if (swappableGroups.length === 0 || swappableGroups.every(g => g.pedalIds.length < 2)) {
    const placements = calculateGreedyPlacement(placedPedals, pedalsById, board, routingConfig);
    return {
      placements,
      chainOrder: initialChainOrder,
      swappableGroups,
    };
  }

  // Deterministic topology search: enumerate chain orders within swappable
  // groups, run the greedy placer for EACH candidate order, score with the
  // routing cost, and keep the best. Every candidate is a coherent
  // greedy-placed layout by construction - unlike the previous simulated
  // annealing pass, which nudged positions independently of the placer and
  // regularly degraded its layouts.
  const pedalById = new Map(placedPedals.map(p => [p.id, p]));
  const candidateOrders = enumerateChainOrders(initialChainOrder, swappableGroups, 48);

  let best: JointOptimizationResult | null = null;
  let bestScore = Infinity;

  for (const order of candidateOrders) {
    // Rebuild placedPedals with this candidate's chain positions
    const reordered = order.map((id, index) => ({
      ...pedalById.get(id)!,
      chainPosition: index + 1,
    }));

    const placements = calculateGreedyPlacement(reordered, pedalsById, board, routingConfig);
    const cost = calculateRoutingCost(
      placements, reordered, pedalsById, board, undefined, useEffectsLoop, use4CableMethod
    );

    if (cost.totalScore < bestScore) {
      bestScore = cost.totalScore;
      best = { placements, chainOrder: order, swappableGroups };
    }
  }

  return best ?? {
    placements: calculateGreedyPlacement(placedPedals, pedalsById, board, routingConfig),
    chainOrder: initialChainOrder,
    swappableGroups,
  };
}

/**
 * Enumerate chain orders by permuting pedals WITHIN each swappable group
 * (consecutive same-category pedals). Order across groups and all
 * non-swappable pedals is fixed. Capped to avoid combinatorial blowups -
 * groups are typically 2-3 pedals, so full enumeration is a handful of
 * candidates.
 */
function enumerateChainOrders(
  initialOrder: string[],
  swappableGroups: SwappableGroup[],
  cap: number
): string[][] {
  const permutations = (ids: string[]): string[][] => {
    if (ids.length <= 1) return [ids];
    const result: string[][] = [];
    for (let i = 0; i < ids.length; i++) {
      const rest = [...ids.slice(0, i), ...ids.slice(i + 1)];
      for (const perm of permutations(rest)) {
        result.push([ids[i], ...perm]);
      }
    }
    return result;
  };

  let candidates: string[][] = [initialOrder];

  for (const group of swappableGroups) {
    if (group.pedalIds.length < 2) continue;

    const groupPerms = permutations(group.pedalIds);
    const next: string[][] = [];

    for (const candidate of candidates) {
      // The group's pedals occupy fixed slots in the order; substitute
      // each permutation into those slots
      const slots = candidate
        .map((id, index) => (group.pedalIds.includes(id) ? index : -1))
        .filter((index) => index >= 0);

      for (const perm of groupPerms) {
        const variant = [...candidate];
        slots.forEach((slot, i) => {
          variant[slot] = perm[i];
        });
        next.push(variant);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }

    candidates = next;
  }

  return candidates;
}
