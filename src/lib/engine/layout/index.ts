import type { Amp, Board, Pedal, PlacedPedal, RoutingConfig, JointOptimizationResult, PedalPlacement, SwappableGroup } from '@/types';
import { deriveSignalTopology, primaryChain, ampClusters, hubClusters } from '../topology';
import { calculateRoutingCost } from './routing-cost';
import { identifySwappableGroups } from '../signal-chain';
import { COLLISION_SPACING } from '../collision';
import { getExternalEndpointInches } from '../cables/endpoints';

interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Greedy placement driven by the signal TOPOLOGY (see ../topology).
 *
 * Placement groups, in order:
 * 1. AMP-SIDE CLUSTERS (amp effects loop, 4CM after-hub run): packed
 *    right-to-left against the amp edge on the row nearest their amp
 *    jacks, then inflated so their cables get a corridor.
 * 2. PRIMARY CHAIN (guitar -> ... -> amp input, hub pedal inline): placed
 *    right-to-left, row by row; overflow packs the remaining chain against
 *    the amp side (strip-aware around clusters already placed).
 * 3. HUB CLUSTERS (NS-2 pedal-loop members): packed on the row adjacent to
 *    the hub, right-aligned to the hub so send (right jack) and return
 *    (left jack) runs stay short.
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

  const useEffectsLoop = routingConfig?.useEffectsLoop ?? false;
  const use4CableMethod = routingConfig?.use4CableMethod ?? false;
  const pseudoAmp = useEffectsLoop ? ({ hasEffectsLoop: true } as Amp) : null;
  const topology = deriveSignalTopology(
    placedPedals, pedalsById, pseudoAmp, useEffectsLoop, use4CableMethod, routingConfig
  );

  const dims = (placed: PlacedPedal): { width: number; depth: number } => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    const rot = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return {
      width: pedal ? (rot ? pedal.depthInches : pedal.widthInches) : 2.87,
      depth: pedal ? (rot ? pedal.widthInches : pedal.depthInches) : 5.12,
    };
  };

  // --- Rows (clamp-aware: see Phase 1 findings) ------------------------------
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);
  let rowYPositions = rails.length > 0
    ? rails.map(r => r.positionFromBackInches)
    : [board.depthInches * 0.55, board.depthInches * 0.05];

  const maxDepth = placedPedals.reduce((max, placed) => Math.max(max, dims(placed).depth), 0);

  if (rowYPositions.length >= 2 && maxDepth > 0) {
    const clamped = rowYPositions
      .map((r) => Math.max(0, Math.min(r, board.depthInches - maxDepth)))
      .sort((a, b) => b - a);
    let tooClose = false;
    for (let i = 0; i < clamped.length - 1; i++) {
      if (clamped[i] - (clamped[i + 1] + maxDepth) < COLLISION_SPACING - 1e-6) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      rowYPositions = [Math.max(0, board.depthInches - maxDepth), 0];
      console.warn('[GREEDY] Rails too close for pedal depth; using safe row positions');
    }
  }

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];
  const DEBUG_PLACEMENT = typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug');

  // Set by placePackedChain when it has to fall back to order-relaxed or
  // anywhere-on-board placement - the signal to retry with less corridor
  let placementDegraded = false;

  /**
   * Place a chain of pedals right-to-left as one packed run:
   * the FIRST pedal at (packStart + total - firstWidth), subsequent pedals
   * tight to its left, the LAST pedal ending near packMinX. Rows are tried
   * in rowOrder; overflow re-packs the remainder strip-aware.
   */
  // The hub pedal (NS-2 style / 4CM wiring center) has up to four jacks
  // pulling cable runs into the corridors on BOTH its sides - it places
  // with extra padding so those corridors fit multiple lanes.
  // The hub pad does NOT degrade with the clearance tier: its four jacks
  // guarantee up to three cable runs per side, the highest corridor demand
  // on the board.
  const hubPad = (placed: PlacedPedal): number =>
    topology.hub && placed.id === topology.hub.id ? 0.5 : 0;

  const placePackedChain = (
    chain: PlacedPedal[],
    rowOrder: number[],
    packMinX: number,
    edgePad: number = 0
  ): void => {
    if (chain.length === 0) return;

    // Edge pedals of a padded chain (cluster) carry corridor clearance on
    // both sides; the hub pedal always does (four jacks worth of cables)
    const padOf = (placed: PlacedPedal): number => {
      const isEdge = placed.id === chain[0].id || placed.id === chain[chain.length - 1].id;
      return Math.max(hubPad(placed), isEdge ? edgePad : 0);
    };
    const effWidth = (placed: PlacedPedal): number => dims(placed).width + 2 * padOf(placed);

    const packedStartX = (startIdx: number, rowY: number): number => {
      let total = 0;
      let depthNeeded = 0;
      for (let j = startIdx; j < chain.length; j++) {
        total += effWidth(chain[j]) + (j > startIdx ? COLLISION_SPACING : 0);
        depthNeeded = Math.max(depthNeeded, dims(chain[j]).depth);
      }
      const firstWidth = effWidth(chain[startIdx]);
      const stripX = findStripStart(total, depthNeeded, rowY, placedBoxes, board, packMinX);
      if (stripX !== null) {
        return stripX + total - firstWidth;
      }
      return Math.min(board.widthInches - firstWidth, packMinX + total - firstWidth);
    };

    let rowPos = 0;
    let cursorX = packedStartX(0, rowYPositions[rowOrder[0]] ?? board.depthInches * 0.5);

    for (let idx = 0; idx < chain.length; idx++) {
      const placed = chain[idx];
      const { depth } = dims(placed);
      const pad = padOf(placed);
      const width = effWidth(placed); // padded footprint for hubs/cluster edges

      const rowY = rowYPositions[rowOrder[rowPos]] ?? board.depthInches * 0.5;
      let spot = findValidPositionInRowStartingFrom(
        width, depth, placedBoxes, board, rowY,
        packMinX, board.widthInches,
        idx === 0 ? cursorX : cursorX - width,
        'right-to-left',
        false
      );

      if (!spot && rowPos < rowOrder.length - 1) {
        rowPos++;
        const nextRowY = rowYPositions[rowOrder[rowPos]] ?? board.depthInches * 0.5;
        cursorX = packedStartX(idx, nextRowY);
        spot = findValidPositionInRowStartingFrom(
          width, depth, placedBoxes, board, nextRowY,
          packMinX, board.widthInches,
          cursorX,
          'right-to-left',
          true // packed spot may be held by a cluster - slide right of it
        );
      }

      if (!spot) {
        placementDegraded = true;
        console.warn(`[GREEDY] Order relaxed for ${placed.id} - no space without breaking chain order`);
        for (let tryPos = rowPos; tryPos < rowOrder.length && !spot; tryPos++) {
          const tryRowY = rowYPositions[rowOrder[tryPos]] ?? board.depthInches * 0.5;
          spot = findValidPositionInRowStartingFrom(
            width, depth, placedBoxes, board, tryRowY,
            packMinX, board.widthInches,
            packedStartX(idx, tryRowY),
            'right-to-left',
            true
          );
        }
      }

      if (!spot) {
        placementDegraded = true;
        console.warn(`[GREEDY] Fallback placement for ${placed.id} - no valid spot`);
        spot = findValidPositionInZone(
          width, depth, placedBoxes, board, rowYPositions,
          0, board.widthInches,
          'right-to-left'
        );
      }

      if (DEBUG_PLACEMENT) {
        console.log(`[GREEDY] Placed ${placed.chainPosition}:${placed.id} at (${(spot.x + pad).toFixed(2)}, ${spot.y.toFixed(2)})`);
      }
      // The recorded position excludes the pad; the collision box keeps it
      // so neighbors leave the corridor free
      placements.push({ id: placed.id, x: spot.x + pad, y: spot.y });
      placedBoxes.push({ x: spot.x, y: spot.y, width, height: depth });
      cursorX = spot.x - COLLISION_SPACING;
    }
  };

  /** Rows ordered by pedal-center proximity to an anchor Y */
  const rowsNearestY = (anchorY: number, clusterDepth: number): number[] =>
    rowYPositions
      .map((rowY, index) => ({
        index,
        dist: Math.abs(Math.min(rowY, board.depthInches - clusterDepth) + clusterDepth / 2 - anchorY),
      }))
      .sort((a, b) => a.dist - b.dist)
      .map((r) => r.index);

  /**
   * Cables around a cluster need a corridor: the minimum pedal spacing
   * (0.5") fits one lane; an extra 0.7" fits up to three (send/return plus
   * a passing chain hop routinely share it). Boards packed near capacity
   * can't afford the luxury - placement retries with tighter corridors
   * whenever a chain had to degrade (order relaxed / fallback spots).
   */
  const CLEARANCE_TIERS = [0.7, 0.35, 0.15];
  let CLUSTER_CABLE_CLEARANCE = CLEARANCE_TIERS[0];

  const attemptPlacement = (): void => {
  // === 1. AMP-SIDE CLUSTERS ===================================================
  // Packed against the amp edge, side by side, on the row nearest their amp
  // jacks. Their boxes are then inflated so cables get corridors.
  const clusterBoxIndices: number[] = [];
  let clusterPackMinX = 0;

  for (const cluster of ampClusters(topology)) {
    if (cluster.pedals.length === 0) continue;

    const clusterDepth = cluster.pedals.reduce((max, p) => Math.max(max, dims(p).depth), 0);
    // Row preference: average anchor height. Pedal anchors (the hub) have
    // no position yet - they contribute the amp-side default (0.35 x depth,
    // between the send and return jacks) so a hub-bound cluster still
    // gravitates to the amp's upper row.
    const anchorYs = [cluster.from, cluster.to].map((anchor) =>
      anchor.kind === 'external'
        ? getExternalEndpointInches(anchor.type, board, topology.effectsLoopEnabled).y
        : board.depthInches * 0.35
    );
    const anchorY = anchorYs.reduce((a, b) => a + b, 0) / anchorYs.length;

    const boxCountBefore = placedBoxes.length;
    placePackedChain(
      [...cluster.pedals],
      rowsNearestY(anchorY, clusterDepth),
      clusterPackMinX
    );
    for (let i = boxCountBefore; i < placedBoxes.length; i++) {
      clusterBoxIndices.push(i);
      clusterPackMinX = Math.max(clusterPackMinX, placedBoxes[i].x + placedBoxes[i].width + COLLISION_SPACING + CLUSTER_CABLE_CLEARANCE);
    }
  }

  // Inflate cluster boxes before the primary chain places around them
  for (const i of clusterBoxIndices) {
    placedBoxes[i] = {
      x: placedBoxes[i].x - CLUSTER_CABLE_CLEARANCE,
      y: placedBoxes[i].y - CLUSTER_CABLE_CLEARANCE,
      width: placedBoxes[i].width + CLUSTER_CABLE_CLEARANCE * 2,
      height: placedBoxes[i].height + CLUSTER_CABLE_CLEARANCE * 2,
    };
  }

  // === 2. PRIMARY CHAIN =======================================================
  // Rows in rail order (front row first), the classic right-to-left run
  placePackedChain(
    primaryChain(topology),
    rowYPositions.map((_, i) => i),
    0
  );

  // === 3. HUB CLUSTERS (NS-2 pedal-loop members) ==============================
  for (const cluster of hubClusters(topology)) {
    if (cluster.pedals.length === 0 || !topology.hub) continue;

    const hubPlacement = placements.find((p) => p.id === topology.hub!.id);
    if (!hubPlacement) continue;
    const hubDims = dims(topology.hub);
    const hubRight = hubPlacement.x + hubDims.width;

    const clusterDepth = cluster.pedals.reduce((max, p) => Math.max(max, dims(p).depth), 0);
    let total = 0;
    cluster.pedals.forEach((p, j) => {
      total += dims(p).width + (j > 0 ? COLLISION_SPACING : 0);
    });

    // Rows nearest the hub's own row, EXCLUDING the hub's row first choice
    // would be ideal, but simply sorting by proximity to the hub row and
    // letting collision checks resolve works: the hub occupies its own row.
    const hubRowCenter = hubPlacement.y + hubDims.depth / 2;
    const rowOrder = rowsNearestY(hubRowCenter, clusterDepth);

    // Right-align the member strip to the hub's right edge (send jack side):
    // first member above the send jack, last member ends near the return
    const packMinX = Math.max(0, Math.min(hubRight - total, board.widthInches - total));
    placePackedChain([...cluster.pedals], rowOrder, packMinX, CLUSTER_CABLE_CLEARANCE / 2);
  }
  };

  for (let tier = 0; tier < CLEARANCE_TIERS.length; tier++) {
    CLUSTER_CABLE_CLEARANCE = CLEARANCE_TIERS[tier];
    placementDegraded = false;
    placements.length = 0;
    placedBoxes.length = 0;
    attemptPlacement();
    if (!placementDegraded) break;
    if (tier < CLEARANCE_TIERS.length - 1 && DEBUG_PLACEMENT) {
      console.log(`[GREEDY] Placement degraded at clearance ${CLUSTER_CABLE_CLEARANCE}, retrying tighter`);
    }
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
      placements, reordered, pedalsById, board, undefined, useEffectsLoop, use4CableMethod, routingConfig
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
