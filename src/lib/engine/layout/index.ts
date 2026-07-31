import type { Amp, Board, Pedal, PlacedPedal, RoutingConfig, JointOptimizationResult, PedalPlacement, SwappableGroup } from '@/types';
import { deriveSignalTopology, primaryChain, ampClusters, hubClusters } from '../topology';
import { calculateRoutingCost, type RoutingCostResult } from './routing-cost';
import { identifySwappableGroups } from '../signal-chain';
import { COLLISION_SPACING } from '../collision';
import { rotateSide, rotatedFootprint } from '../geometry/rotation';

/**
 * Front-to-back clearance between pedals in ADJACENT ROWS, as opposed to the
 * side-to-side COLLISION_SPACING between neighbours in the same row.
 *
 * They are different quantities and conflating them cost a whole row. A cable
 * leaves a pedal through its side jacks, so the gap between two pedals sitting
 * beside each other must fit a cable run; the gap between rows carries the
 * corridor but does not have to admit a cable BETWEEN two specific pedals.
 * Requiring 0.5in in both axes meant a 32x16 board could hold only two rows of
 * 5.08in pedals (3 rows need 15.24in of pedal, leaving 0.38in per gap), so any
 * third row was unreachable: every candidate there collided with the row in
 * front of it, and the chain silently skipped that row and came back for it
 * later - which is what made a 20-pedal board read front -> back -> middle.
 */
const ROW_GAP = 0.35;

/**
 * The floor under ROW_GAP: the least front-to-back clearance a placement is
 * allowed to have. ROW_GAP is the corridor rows are DESIGNED for; this is what
 * makes a candidate legal, and they have to be separate numbers.
 *
 * A row band sometimes has to grow to house a deeper-than-typical pedal, and
 * that depth comes out of the corridors: three rows on a 16in board housing one
 * 5.43in pedal need 5.43 + 2x5.10 = 15.63in, which leaves 0.185in per corridor.
 * Demanding the full 0.35in there left EQ-200 with no legal row at all - it
 * straddled two bands instead, which pinned its x to the one column with
 * nothing above it, truncated the packed run to four pedals and wrapped the
 * tail of the chain back to the right-hand side, out of signal order.
 *
 * Do not raise this to a rounder 0.2 without redoing that arithmetic: the real
 * board clears it by 0.035in, and at 0.2 the budget does not close, the row
 * never grows, and the whole mechanism silently does nothing.
 */
const MIN_ROW_CLEARANCE = 0.15;
import { getExternalEndpointInches } from '../cables/endpoints';

interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One row of the board: where its pedals' back edges sit, and how deep the
 * band is. Rows are NOT all the same height - see deriveRows().
 */
interface RowBand {
  y: number;
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
    if (!pedal) return { width: 2.87, depth: 5.12 };
    const { widthInches, depthInches } = rotatedFootprint(pedal, placed.rotationDegrees);
    return { width: widthInches, depth: depthInches };
  };

  // --- Rows (clamp-aware: see Phase 1 findings) ------------------------------
  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);

  const maxDepth = placedPedals.reduce((max, placed) => Math.max(max, dims(placed).depth), 0);

  /**
   * How many rows of the deepest pedal actually fit, and where they sit.
   *
   * This used to be hardcoded to two rows at 55% and 5% of the board depth,
   * regardless of how deep the board was. On a Pedaltrain Classic Pro
   * (32x16in) that capped the board at 18 standard pedals and left 2.1in of
   * depth unused at the back - so a 20-pedal board could not be placed at
   * all, every candidate overlapped, and Optimize refused to do anything.
   * A real Classic Pro takes three rows.
   *
   * Rows are spaced COLLISION_SPACING apart when that fits; when tightening
   * to MIN_ROW_GAP buys another whole row, it is taken. Row gaps can be
   * tighter than side-by-side spacing because a cable leaves a pedal through
   * its side jacks, not its front or back edge, so the front-to-back gap
   * carries less cable traffic.
   */
  const MIN_ROW_GAP = ROW_GAP;

  /**
   * The depth rows are SIZED for - deliberately not the deepest pedal.
   *
   * Sizing every row for the single deepest pedal lets one outlier collapse
   * the whole board. A real 20-pedal Classic Pro config had eighteen 5.08in
   * pedals, one 5.43in and one 7.56in: sizing rows at 7.56in gave two rows
   * and no legal placement, while sizing at 5.1in gives three rows totalling
   * 15.94in of a 16in board, and the one deep pedal simply occupies two row
   * bands at one x - which is exactly what a person does by hand.
   *
   * The 80th percentile covers the ordinary pedals without letting one or two
   * tall ones dictate the geometry. Deeper pedals are not ignored: placement
   * still validates every box against the board and its neighbours, so an
   * outlier that cannot fit its row is relocated rather than overlapped.
   */
  const rowSizingDepth = (): number => {
    const depths = placedPedals.map((p) => dims(p).depth).sort((a, b) => a - b);
    if (depths.length === 0) return maxDepth;
    return depths[Math.min(depths.length - 1, Math.floor(depths.length * 0.8))];
  };

  /**
   * ROWS HAVE VARIABLE HEIGHTS. Uniform rows sized at the typical depth leave
   * a slightly-deeper pedal homeless, and a homeless pedal does far more damage
   * than its own misplacement.
   *
   * The real 20-pedal Classic Pro has fourteen 5.08in pedals, four 5.10in, one
   * 5.43in (EQ-200) and one 7.56in (PW-3). Rows sized at the typical 5.10in
   * fill a 16in board exactly (3 x 5.10 + 2 x 0.35 = 16.00), so EQ-200 fits no
   * band: it straddled two, which meant it could only sit where no row above it
   * had a pedal, and the packed run it started was cut off after four pedals
   * with the rest wrapping back to the right. Sizing the rows 5.43 / 5.10 /
   * 5.10 = 15.63in leaves 0.185in per corridor and gives every pedal a band.
   *
   * So: size every row for the typical depth, then grow rows deepest-first
   * while the budget still closes at MIN_ROW_CLEARANCE. Grown rows go at the
   * BACK, because the front row's depth is capped by the board edge - a pedal
   * there is clamped forward and eats the corridor behind it instead.
   */
  const deriveRows = (): RowBand[] => {
    const rowDepth = rowSizingDepth();
    if (maxDepth <= 0) {
      const h = board.depthInches * 0.4;
      return [
        { y: board.depthInches * 0.55, height: h },
        { y: board.depthInches * 0.05, height: h },
      ];
    }
    const rowsThatFit = (gap: number) =>
      Math.floor((board.depthInches + gap) / (rowDepth + gap));
    // Row COUNT is still derived at the designed corridor, never at the
    // clearance floor: buying an extra row by squeezing every corridor down to
    // MIN_ROW_CLEARANCE would starve the cable router across the whole board,
    // where a grown row only narrows the corridor above the one deep pedal.
    let gap = COLLISION_SPACING;
    let count = rowsThatFit(gap);
    if (rowsThatFit(MIN_ROW_GAP) > count) {
      gap = MIN_ROW_GAP;
      count = rowsThatFit(gap);
    }
    count = Math.max(1, count);

    // heights[0] is the BACK row, so growing from index 0 puts the deepest
    // band at the back. Each distinct oversize depth gets at most one band:
    // a row hosts many pedals, and a band grown to 5.43 houses every 5.43in
    // pedal that fits along it.
    const heights = Array.from({ length: count }, () => rowDepth);
    const oversize = [...new Set(placedPedals.map((p) => dims(p).depth))]
      .filter((d) => d > rowDepth + 1e-6)
      .sort((a, b) => b - a);
    const totalOf = (hs: number[]) => hs.reduce((sum, h) => sum + h, 0);
    let slot = 0;
    for (const depth of oversize) {
      if (slot >= count) break;
      const trial = [...heights];
      trial[slot] = depth;
      // A depth that will not close the budget is skipped, not fatal: the next
      // one down may still fit, and a pedal deeper than any band can be is
      // placed straddling two, exactly as before.
      if (totalOf(trial) + (count - 1) * MIN_ROW_CLEARANCE > board.depthInches + 1e-6) continue;
      heights[slot] = depth;
      slot++;
    }

    // Spend leftover depth on the CABLE CORRIDOR between rows, not on margins
    // at the board edges. Centring the rows instead was a real regression: on
    // a 22x12.5 board it left a 0.5in gap where the old rail positions gave
    // 0.9in, and the router could no longer fit a lane between the rows, so
    // cables came back invalid. The corridor has to carry cable runs; the
    // strip in front of the first row carries nothing.
    const EDGE_MARGIN = 0.1;
    const used = totalOf(heights);
    if (count > 1) {
      const spare = board.depthInches - used - 2 * EDGE_MARGIN;
      gap = Math.max(gap, spare / (count - 1));
      // A grown row eats into the corridors, so the designed gap can no longer
      // be assumed to fit: clamp it to what is left of the board, but never
      // below the clearance a placement in it would be judged against.
      gap = Math.max(MIN_ROW_CLEARANCE, Math.min(gap, (board.depthInches - used) / (count - 1)));
    } else {
      gap = 0;
    }

    const margin = Math.max(0, (board.depthInches - used - (count - 1) * gap) / 2);
    const rows: RowBand[] = [];
    let y = margin;
    for (const height of heights) {
      rows.push({ y, height });
      y += height + gap;
    }
    return rows.sort((a, b) => b.y - a.y); // front-to-back, matching the rails convention
  };

  /**
   * RAILS ARE NOT ROWS. This is the bug that made large boards unplaceable.
   *
   * A Pedaltrain Classic Pro has four rails at 0, 3.75, 7.5 and 11.25in. They
   * are mounting bars: a 5.08in-deep pedal sits ACROSS two of them. Treating
   * each rail as a row gave four rows at a 3.75in pitch, which is shallower
   * than any real pedal, so the "rails too close" guard collapsed the board to
   * TWO rows - and 20 pedals then had no legal placement. Every real board has
   * rails, so this path ran every time and the depth-derived row count never
   * did.
   *
   * Row pitch comes from pedal depth. Rails are kept only to snap a derived
   * row onto a real mounting bar when one is close enough that snapping does
   * not change how many rows fit.
   */
  let rows = deriveRows();

  if (rails.length > 0 && rows.length > 0) {
    const railYs = rails.map((r) => r.positionFromBackInches);
    const snapped = rows.map((row) => {
      const nearest = railYs.reduce((best, r) => (Math.abs(r - row.y) < Math.abs(best - row.y) ? r : best), railYs[0]);
      // Only snap when it neither pushes the row off the board nor moves it
      // far enough to close the gap to its neighbour.
      const moved = Math.abs(nearest - row.y);
      return moved <= MIN_ROW_GAP / 2 && nearest + maxDepth <= board.depthInches + 1e-6
        ? { ...row, y: nearest }
        : row;
    });
    // Reject the snap wholesale if it left any two BANDS closer than a
    // placement between them would be allowed to be
    const ok = [...snapped]
      .sort((a, b) => a.y - b.y)
      .every((row, i, arr) => i === 0 || row.y - (arr[i - 1].y + arr[i - 1].height) >= MIN_ROW_CLEARANCE - 1e-6);
    if (ok) rows = snapped;
  }

  const rowYPositions = rows.map((r) => r.y);

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];
  // Enabled by ?debug in the browser, or DEBUG_PLACEMENT=1 for offline replay
  // of a dumped store state (see .claude/scripts/dump-state.js).
  const DEBUG_PLACEMENT =
    (typeof window !== 'undefined' && new URLSearchParams(window.location?.search || '').has('debug')) ||
    (typeof process !== 'undefined' && !!process.env?.DEBUG_PLACEMENT);

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

  // Pedals whose input AND output land on the SAME edge (after rotation,
  // e.g. a rotated top-jack pedal) pull both cable runs into one gap -
  // give that gap corridor room for two lanes.
  const sameSideJackPad = (placed: PlacedPedal): number => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal?.jacks?.length) return 0;
    const effectiveSide = (jackType: 'input' | 'output'): string | null => {
      const jack = pedal.jacks!.find((j) => j.jackType === jackType);
      if (!jack) return null;
      return rotateSide(jack.side, placed.rotationDegrees);
    };
    const input = effectiveSide('input');
    const output = effectiveSide('output');
    // Only left/right shared sides pull cables into a narrow SIDE gap;
    // top/bottom shared sides feed the wide row channels, which have room
    const sharedSideGap = input !== null && input === output &&
      (input === 'left' || input === 'right');
    return sharedSideGap ? 0.35 : 0;
  };

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
      return Math.max(hubPad(placed), sameSideJackPad(placed), isEdge ? edgePad : 0);
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
      if (stripX !== null) return stripX + total - firstWidth;
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
      if (DEBUG_PLACEMENT) {
        console.log(
          `[ROW] chain${placed.chainPosition} w=${width.toFixed(2)} d=${depth.toFixed(2)} ` +
          `try row${rowPos}(y=${rowY.toFixed(2)}) cursorX=${cursorX.toFixed(2)}`
        );
      }
      let spot = findValidPositionInRowStartingFrom(
        width, depth, placedBoxes, board, rowY,
        packMinX, board.widthInches,
        idx === 0 ? cursorX : cursorX - width,
        'right-to-left',
        false
      );

      if (!spot && rowPos < rowOrder.length - 1) {
        if (DEBUG_PLACEMENT) console.log(`      row${rowPos} FULL -> advancing`);
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
        // packedStartX aims at where the WHOLE remaining run would start. When
        // the run is wider than the board that lands near the right edge, and
        // if something straddles there (a deep pedal occupying two row bands)
        // the slide-right retry has nowhere to go and the row gets abandoned -
        // the chain then skips a row entirely and comes back for it later,
        // which is what made a 3-row board read out of order. Rescan the row
        // from its right edge before giving up on it.
        if (!spot) {
          cursorX = board.widthInches - width;
          spot = findValidPositionInRowStartingFrom(
            width, depth, placedBoxes, board, nextRowY,
            packMinX, board.widthInches,
            cursorX,
            'right-to-left',
            true
          );
        }
      }

      if (!spot) {
        placementDegraded = true;
        if (DEBUG_PLACEMENT) console.log(`      advance FAILED too -> order-relax scan`);
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
        console.log(`   -> chain${placed.chainPosition} PLACED at (${(spot.x + pad).toFixed(2)}, ${spot.y.toFixed(2)}) row${rowPos}`);
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

  // Check collisions. Front-to-back uses the CLEARANCE FLOOR, not the designed
  // ROW_GAP: rows whose band had to grow sit closer than the designed corridor,
  // and judging their pedals against 0.35in rejected every candidate in them.
  return !placedBoxes.some(box => boxesOverlap(candidate, box, COLLISION_SPACING, MIN_ROW_CLEARANCE));
}

/**
 * Check if two boxes overlap (with optional spacing)
 */
function boxesOverlap(
  a: PlacedBox,
  b: PlacedBox,
  spacing: number = 0,
  /** Front-to-back clearance; defaults to the same value as side-to-side. */
  spacingY: number = spacing
): boolean {
  // Small epsilon so pedals packed at EXACTLY the required spacing
  // (accumulated float arithmetic) don't register as colliding
  const EPSILON = 1e-6;
  return !(
    a.x + a.width + spacing <= b.x + EPSILON ||
    b.x + b.width + spacing <= a.x + EPSILON ||
    a.y + a.height + spacingY <= b.y + EPSILON ||
    b.y + b.height + spacingY <= a.y + EPSILON
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
/**
 * The joint result plus the scores behind it. Kept here rather than on the
 * shared JointOptimizationResult because RoutingCostResult belongs to the
 * engine, and @/types must not depend on the engine (it is the base layer
 * the engine imports from).
 */
export interface ScoredJointOptimizationResult extends JointOptimizationResult {
  /**
   * Score of the layout the user actually had before optimizing - their real
   * pedal positions, not a re-placed version of them - and of the layout
   * returned. The optimizer already computes these to make its choice;
   * dropping them at this boundary is what made Optimize unexplainable.
   * Both undefined when there was nothing to optimize.
   */
  baselineCost?: RoutingCostResult;
  cost?: RoutingCostResult;
  /**
   * True when EVERY candidate arrangement the search tried was illegal
   * (pedals overlapping or off the board), so the user's own layout was kept
   * by default. This is not "already optimal" - it is "we could not place
   * these pedals on this board at all" - and the UI must not conflate them.
   * Currently reachable with ~20+ pedals, where greedy placement overlaps.
   */
  noLegalCandidate?: boolean;
}

export function calculateOptimalLayoutJoint(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): ScoredJointOptimizationResult {
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

  const pedalById = new Map(placedPedals.map(p => [p.id, p]));

  // The honest "before": the board exactly as the user left it. NOT
  // evaluate(initialChainOrder), which greedily re-places everything and so
  // would compare an optimized layout against another optimized layout.
  const currentPlacements = placedPedals.map((p) => ({ id: p.id, x: p.xInches, y: p.yInches }));
  const baselineCost = calculateRoutingCost(
    currentPlacements, placedPedals, pedalsById, board, undefined,
    useEffectsLoop, use4CableMethod, routingConfig
  );

  /**
   * The user's own layout is the incumbent the search has to beat - but only
   * if it is legal. A hand-arranged board with overlapping pedals is exactly
   * what someone clicks Optimize to fix, so a colliding baseline is not
   * eligible to be kept no matter how well it scores (the routing cost has no
   * overlap term, so a collapsed pile scores wonderfully).
   */
  const baselineEligible = !hasPlacementCollision(
    currentPlacements, placedPedals, pedalsById, board
  );
  const baselineCandidate = {
    placements: currentPlacements,
    score: baselineEligible ? baselineCost.totalScore : Infinity,
    cost: baselineCost,
  };

  // Pedals where rotation changes jack FACING (input/output on top/bottom
  // edges, e.g. EQ-200) - the only ones worth searching rotations for
  const rotatableIds = placedPedals
    .filter((p) => {
      const pedal = pedalsById[p.pedalId] || p.pedal;
      return pedal?.jacks?.some(
        (j) =>
          (j.jackType === 'input' || j.jackType === 'output') &&
          (j.side === 'top' || j.side === 'bottom')
      );
    })
    .map((p) => p.id);

  const hasOrderSearch =
    swappableGroups.length > 0 && swappableGroups.some(g => g.pedalIds.length >= 2);

  // Nothing to search: greedy placement, kept only if it beats what's there
  if (!hasOrderSearch && rotatableIds.length === 0) {
    const placements = calculateGreedyPlacement(placedPedals, pedalsById, board, routingConfig);
    const greedyCost = calculateRoutingCost(
      placements, placedPedals, pedalsById, board, undefined,
      useEffectsLoop, use4CableMethod, routingConfig
    );
    // The SAME hard collision guard evaluate() applies. Without it this path
    // returned greedy unconditionally, and a greedy layout that overlaps or
    // overflows scores *better* than a legal one - the routing cost has no
    // overlap term, so a pile of stacked pedals has wonderfully short cables.
    // Observed on tight boards: a legal 8-pedal input at 2478.5 was replaced
    // by an overlapping layout at 1301.6.
    const greedyScore = hasPlacementCollision(placements, placedPedals, pedalsById, board)
      ? Infinity
      : greedyCost.totalScore;
    // Ties keep the baseline, and if BOTH are illegal we keep the user's board
    // rather than replacing it with a different broken one.
    const keepBaseline = baselineCandidate.score <= greedyScore + 1e-9;
    const noLegalCandidate = !Number.isFinite(greedyScore) && !Number.isFinite(baselineCandidate.score);
    return {
      placements: keepBaseline ? currentPlacements : placements,
      chainOrder: initialChainOrder,
      swappableGroups,
      baselineCost,
      cost: keepBaseline ? baselineCost : greedyCost,
      noLegalCandidate: !Number.isFinite(greedyScore),
    };
  }

  // Deterministic search over chain orders (within swappable groups) and
  // pedal rotations (for jack-facing changes), scored by the routing cost.
  // Every candidate is a coherent greedy-placed layout by construction.
  const MAX_EVALUATIONS = 200;
  let evaluations = 0;

  const evaluate = (order: string[], rotations: Map<string, number>) => {
    evaluations++;
    const reordered = order.map((id, index) => ({
      ...pedalById.get(id)!,
      chainPosition: index + 1,
      rotationDegrees: rotations.get(id) ?? pedalById.get(id)!.rotationDegrees,
    }));
    const placements = calculateGreedyPlacement(reordered, pedalsById, board, routingConfig);

    // HARD collision guard: a candidate whose placement overlaps or leaves
    // the board is never eligible, no matter how short its cables score
    // (the routing cost has no overlap term - shorter-but-colliding layouts
    // would otherwise win)
    if (hasPlacementCollision(placements, reordered, pedalsById, board)) {
      return { placements, score: Infinity, cost: undefined };
    }

    const cost = calculateRoutingCost(
      placements, reordered, pedalsById, board, undefined, useEffectsLoop, use4CableMethod, routingConfig
    );
    return { placements, score: cost.totalScore, cost };
  };

  // --- Stage 1: chain orders at current rotations -----------------------------
  const baseRotations = new Map(placedPedals.map((p) => [p.id, p.rotationDegrees]));
  const candidateOrders = hasOrderSearch
    ? enumerateChainOrders(initialChainOrder, swappableGroups, 48)
    : [initialChainOrder];

  let bestOrder = initialChainOrder;
  let bestRotations = new Map(baseRotations);
  let best = evaluate(initialChainOrder, bestRotations);
  // Every candidate illegal => the search found nothing, it did not conclude
  // the board was already ideal. Tracked so the UI can say which happened.
  let anyLegalCandidate = Number.isFinite(best.score);

  // Seed with the user's own layout when it already beats the greedy
  // re-placement of the same order, so every later candidate is compared
  // against what the user actually had. Ties keep the baseline: doing nothing
  // beats shuffling a board for no gain.
  //
  // HONESTLY: no input has yet been found where this changes the outcome -
  // 300 random legal layouts and 24 tight-board configurations all produced a
  // greedy candidate at least as good as the baseline. It is kept because it
  // is the exact analogue of a bug PROVEN real in the sibling early-return
  // path above (which returned a colliding layout scoring better than a legal
  // one), and because `evaluate()` yields Infinity for every colliding
  // candidate - so if all 48 orders collide, `best.placements` would be a
  // colliding layout that a legal baseline should beat. Guarding one path and
  // not the other is how the two drift apart.
  if (baselineCandidate.score <= best.score + 1e-9) {
    best = baselineCandidate;
  }

  for (const order of candidateOrders) {
    if (order === initialChainOrder) continue;
    if (evaluations >= MAX_EVALUATIONS) break;
    const result = evaluate(order, bestRotations);
    if (Number.isFinite(result.score)) anyLegalCandidate = true;
    if (result.score < best.score - 1e-9) {
      best = result;
      bestOrder = order;
    }
  }

  // --- Stage 2: rotation coordinate descent -----------------------------------
  // One pass per rotatable pedal; only strictly-better rotations are kept,
  // so re-optimizing an optimized layout is a no-op (idempotence).
  for (const id of rotatableIds) {
    const current = bestRotations.get(id) ?? 0;
    for (const rotation of [0, 90, 180, 270]) {
      if (rotation === current) continue;
      if (evaluations >= MAX_EVALUATIONS) break;
      const candidate = new Map(bestRotations);
      candidate.set(id, rotation);
      const result = evaluate(bestOrder, candidate);
      if (Number.isFinite(result.score)) anyLegalCandidate = true;
      if (result.score < best.score - 1e-9) {
        best = result;
        bestRotations = candidate;
      }
    }
  }

  const changedRotations = [...bestRotations]
    .filter(([id, rot]) => rot !== (pedalById.get(id)?.rotationDegrees ?? 0))
    .map(([id, rotationDegrees]) => ({ id, rotationDegrees }));

  return {
    placements: best.placements,
    chainOrder: bestOrder,
    swappableGroups,
    rotations: changedRotations.length > 0 ? changedRotations : undefined,
    baselineCost,
    // `best.cost` is the winner's own score object, not a recomputation, so
    // what the UI reports is literally what the search compared.
    cost: best.cost,
    noLegalCandidate: !anyLegalCandidate,
  };
}

/** True when any placement overlaps another or leaves the board */
function hasPlacementCollision(
  placements: PedalPlacement[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): boolean {
  const byId = new Map(placedPedals.map((p) => [p.id, p]));
  const rects = placements.map((pl) => {
    const placed = byId.get(pl.id);
    const pedal = placed ? pedalsById[placed.pedalId] || placed.pedal : undefined;
    const size = pedal
      ? rotatedFootprint(pedal, placed?.rotationDegrees ?? 0)
      : { widthInches: 2.87, depthInches: 5.12 };
    return { x: pl.x, y: pl.y, w: size.widthInches, h: size.depthInches };
  });

  for (const r of rects) {
    if (r.x < -0.01 || r.y < -0.01 || r.x + r.w > board.widthInches + 0.01 || r.y + r.h > board.depthInches + 0.01) {
      return true;
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.01 && oy > 0.01) return true;
    }
  }
  return false;
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
