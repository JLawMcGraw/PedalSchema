import type { Amp, Board, Pedal, PlacedPedal, RoutingConfig, JointOptimizationResult, PedalPlacement, SwappableGroup } from '@/types';
import { deriveSignalTopology, primaryChain, ampClusters, hubClusters, resolvePedalLoop } from '../topology';
import { calculateRoutingCost, type RoutingCostResult } from './routing-cost';
import { identifySwappableGroups } from '../signal-chain';
import { COLLISION_SPACING } from '../collision';
import { rotateSide, rotatedFootprint } from '../geometry/rotation';
import { canOptimizerRotate, mayRotateTo } from './rotation-eligibility';
import { ROW_GAP, MIN_ROW_CLEARANCE } from './constants';
import { deriveRowBands, type RowBand } from './rows';
import { isDebugEnabled } from '../debug-flag';


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
export interface GreedyPlacementResult {
  placements: PedalPlacement[];
  /**
   * The placer could not honour its own layout rules and fell back - to
   * order-relaxed placement, or to "anywhere on the board".
   *
   * This has always been computed (`placementDegraded`) and never left the
   * function, so no caller could tell a clean placement from a salvaged one.
   * findValidPositionInZone has two returns with no validity check at all -
   * the narrow-zone bail and the terminal "truly full board" clamp - and its
   * return type is non-nullable, so callers have no failure branch either.
   *
   * Deliberately NOT fixed by returning null: that was tried, and it turns a
   * wrong answer into no answer (see the note at the retry loop). Reporting
   * honestly beats failing differently.
   */
  degraded: boolean;
}

/**
 * Greedy placement, plus whether it had to degrade to produce it.
 *
 * The plain `calculateGreedyPlacement` below is the same call without the
 * diagnostic. Both exist because 15 test call sites want placements and
 * nothing else, and churning them to unpack a tuple would obscure the change
 * that matters.
 */
export function calculateGreedyPlacementWithDiagnostics(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): GreedyPlacementResult {
  if (placedPedals.length === 0) {
    return { placements: [], degraded: false };
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

  // --- Rows -----------------------------------------------------------------
  // One source of truth, shared with the routing cost's row-alignment
  // penalty. They used to derive rows differently and disagree - see rows.ts.
  const rows = deriveRowBands(placedPedals, pedalsById, board);

  const rowYPositions = rows.map((r) => r.y);
  /**
   * The deepest band any row offers. A pedal deeper than this cannot sit IN a
   * row at all - it must STRADDLE two, which needs a column with nothing above
   * or below it. See the straddler handling in placePackedChain.
   */
  const maxBandHeight = rows.reduce((max, r) => Math.max(max, r.height), 0);

  const placements: PedalPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];
  // Enabled by ?debug in the browser, or DEBUG_PLACEMENT=1 for offline replay
  // of a dumped store state (see .claude/scripts/dump-state.js).
  const DEBUG_PLACEMENT = isDebugEnabled('debug');

  // Set by placePackedChain when it has to fall back to order-relaxed or
  // anywhere-on-board placement - the signal to retry with less corridor
  let placementDegraded = false;
  // When true, pedals too deep for any row band claim their column before the
  // packed run. A RETRY ordering, not the default - see the loop at the end.
  let straddleFirstPass = false;

  /**
   * Place a chain of pedals right-to-left as one packed run:
   * the FIRST pedal at (packStart + total - firstWidth), subsequent pedals
   * tight to its left, the LAST pedal ending near packMinX. Rows are tried
   * in rowOrder; overflow re-packs the remainder strip-aware.
   */
  /*
   * The hub pedal (NS-2 style / 4CM wiring centre) has up to four jacks
   * pulling cable runs into the corridors on BOTH its sides, so it places with
   * extra padding to fit multiple lanes there. Earning that room is worth
   * 1.0in of row.
   *
   * Except when it costs more than it buys. A pedal loop's members are laid
   * out immediately after their hub, and if the padded group no longer fits
   * the row the packer wraps THROUGH it - stranding a member on the next row,
   * where its send and return have to cross the board to get back. On the real
   * 9-pedal board the run needs 17.82in of an 18in row: the padding takes it
   * to 18.82 and splits the group, trading two crowded corridors for two
   * board-length cables.
   *
   * So for a pedal loop the pad is ATTEMPTED and dropped only if it splits the
   * group - see the retry at the end of this function. 4-cable mode keeps it
   * unconditionally: there the hub spans the amp preamp and its members are
   * not adjacent, so nothing is gained by giving the room back.
   */
  let hubPadEnabled = true;

  /**
   * The pedal the loop group ENDS on, which needs the same room as the hub.
   *
   * Two cables cross the gap just past it: the RETURN, running back to the hub
   * on the far side of the group, and the hub's OUTPUT, running the other way
   * to the next pedal in the chain. At minimum spacing that gap is 20px, and
   * OBSTACLE_MARGIN takes 8px off each side - leaving a 4px band for two runs
   * that need LANE_TOLERANCE (10px) between them. They came out 2px apart,
   * which is one cable as far as the eye is concerned.
   *
   * Widening the gap is the only thing that helps: the lane router cannot
   * spread runs through space that is not there.
   */
  const loopGroupTail =
    topology.mode === 'pedal-loop'
      ? (topology.segments.find((seg) => seg.id === 'hub-loop')?.pedals ?? []).slice(-1)[0]?.id
      : undefined;

  const hubPad = (placed: PlacedPedal): number => {
    const isHub = !!topology.hub && placed.id === topology.hub.id;
    const isTail = !!loopGroupTail && placed.id === loopGroupTail;
    if (!isHub && !isTail) return 0;
    if (topology.mode === 'pedal-loop' && !hubPadEnabled) return 0;
    return 0.5;
  };

  /** The hub and the pedals in its loop, which are placed consecutively. */
  const loopGroupIds =
    topology.mode === 'pedal-loop' && topology.hub
      ? [
          topology.hub.id,
          ...(topology.segments.find((seg) => seg.id === 'hub-loop')?.pedals ?? []).map((p) => p.id),
        ]
      : [];

  /** Did a row wrap fall inside the loop group? */
  const loopGroupSplit = (): boolean => {
    if (loopGroupIds.length < 2) return false;
    const ys = loopGroupIds
      .map((id) => placements.find((p) => p.id === id)?.y)
      .filter((y): y is number => y !== undefined);
    return new Set(ys.map((y) => Math.round(y * 100))).size > 1;
  };

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

    // `seq` is the run being packed, which is NOT always the whole chain: the
    // straddler dry run below packs a subset, and indices must follow it.
    const packedStartX = (seq: PlacedPedal[], startIdx: number, rowY: number): number => {
      let total = 0;
      let depthNeeded = 0;
      for (let j = startIdx; j < seq.length; j++) {
        total += effWidth(seq[j]) + (j > startIdx ? COLLISION_SPACING : 0);
        depthNeeded = Math.max(depthNeeded, dims(seq[j]).depth);
      }
      const firstWidth = effWidth(seq[startIdx]);
      const stripX = findStripStart(total, depthNeeded, rowY, placedBoxes, board, packMinX);
      if (stripX !== null) return stripX + total - firstWidth;
      return Math.min(board.widthInches - firstWidth, packMinX + total - firstWidth);
    };

    /**
     * One right-to-left packing pass over `seq`, rows tried in rowOrder.
     *
     * Extracted so it can be run TWICE: once as a dry run to discover where
     * the chain's pedals actually land, then for real. Row capacity depends on
     * real geometry - strip finding, cluster boxes, corridor padding - so a
     * closed-form model of "which row does index i land in" drifts from the
     * truth exactly when it matters. Measuring beats modelling.
     *
     * Pedals in `preSpots` already hold a column; the pass steps over them and
     * carries the cursor past, so the rest of the run continues to their left.
     */
    const runPass = (seq: PlacedPedal[], preSpots: Set<string>): void => {
      let rowPos = 0;
      let cursorX = packedStartX(seq, 0, rowYPositions[rowOrder[0]] ?? board.depthInches * 0.5);

      for (let idx = 0; idx < seq.length; idx++) {
        const placed = seq[idx];
        // Already holds its column. Carry the cursor past it so the rest of
        // the run continues to its left and chain order still reads
        // right-to-left.
        if (preSpots.has(placed.id)) {
          cursorX = placements.find((p) => p.id === placed.id)!.x - COLLISION_SPACING;
          continue;
        }
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
          cursorX = packedStartX(seq, idx, nextRowY);
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
              packedStartX(seq, idx, tryRowY),
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

    /**
     * STRADDLERS GO FIRST.
     *
     * A pedal deeper than the deepest row band cannot sit IN a band at all -
     * it has to straddle two, which needs a column with nothing above or below
     * it. Placed in chain order it arrives at a row that is already full, the
     * order-relax scan finds nothing, and the fallback stacks it on a
     * neighbour: the recorded 20-pedal repro put a 7.56in pedal on top of its
     * neighbour, overlapping by 2.87 x 1.92in.
     *
     * The fallback is not what is wrong - making it return null would turn a
     * wrong answer into no answer. The ordering is. So claim the column up
     * front and let the packed run flow around it. A board whose deep pedal
     * happens to be chain-FIRST already worked precisely because it took its
     * column before anything competed for one; this gives every chain position
     * that.
     *
     * WHERE to claim is the whole difficulty, and it is why this dry-runs the
     * chain first. Two closed-form models were tried and both broke:
     *   - a single-row model gives every pedal past the first row's capacity a
     *     negative x, so they all clamp to 0 - right for the chain-LAST pedal,
     *     wrong for every other late one;
     *   - a row-wrapping model fixes the middle but inverts the last few,
     *     because a straddler steals a slot from the row it overhangs INTO,
     *     which shifts where the run wraps - the thing the model was
     *     predicting.
     * So place it beside the chain neighbour whose real position we measured.
     */
    const straddlerIds = new Set(
      chain.filter((p) => dims(p).depth > maxBandHeight + 1e-6).map((p) => p.id)
    );
    const preplaced = new Set<string>();

    if (straddleFirstPass && straddlerIds.size > 0 && straddlerIds.size < chain.length) {
      // --- Dry run: where does the chain land with the straddlers absent? ---
      const placeMark = placements.length;
      const boxMark = placedBoxes.length;
      const degradedBefore = placementDegraded;
      const warn = console.warn;
      console.warn = () => {}; // a dry run must not narrate
      try {
        runPass(chain.filter((p) => !straddlerIds.has(p.id)), new Set());
      } finally {
        console.warn = warn;
      }
      const dry = new Map(placements.slice(placeMark).map((p) => [p.id, { x: p.x, y: p.y }]));
      placements.length = placeMark;
      placedBoxes.length = boxMark;
      placementDegraded = degradedBefore;

      // --- Claim each straddler's column beside its measured neighbour ------
      for (let idx = 0; idx < chain.length; idx++) {
        const placed = chain[idx];
        if (!straddlerIds.has(placed.id)) continue;
        const { depth } = dims(placed);
        const pad = padOf(placed);
        const width = effWidth(placed);

        // Nearest earlier chain neighbour that the dry run positioned. Its x
        // is where the run had got to; the straddler belongs just left of it.
        let anchor: { x: number; y: number } | undefined;
        for (let j = idx - 1; j >= 0 && !anchor; j--) anchor = dry.get(chain[j].id);
        const anchorX = anchor
          ? anchor.x - COLLISION_SPACING - width
          : packedStartX(chain, 0, rowYPositions[rowOrder[0]] ?? board.depthInches * 0.5);

        /*
         * Align it to a board EDGE - never centre it on a band.
         *
         * Centring looks tidier and is much worse: a 9.06in pedal centred on a
         * 16in board spans y 3.5 to 12.6, leaving a 3.5in sliver above and a
         * 3.4in sliver below, both too shallow for anything. Two such pedals
         * chopped every row into unusable segments and drove two compacts onto
         * exactly the same spot. Edge-aligned, the overhang eats into ONE
         * neighbouring band and the rest of the board stays whole.
         *
         * Which edge follows the band the chain wants: front half of the board
         * means front-aligned - where the real board's 7.56in PW-3 sits, and
         * where a pedal you step on belongs - back half means back-aligned.
         */
        const bandY = anchor
          ? rowYPositions.reduce((best, y) => (Math.abs(y - anchor!.y) < Math.abs(best - anchor!.y) ? y : best), rowYPositions[0])
          : (rowYPositions[rowOrder[0]] ?? board.depthInches * 0.5);
        const bandH = rows.find((r) => Math.abs(r.y - bandY) < 1e-6)?.height ?? maxBandHeight;
        const straddleY = bandY + bandH / 2 > board.depthInches / 2
          ? Math.max(0, board.depthInches - depth)
          : 0;

        const spot = findValidPositionInRowStartingFrom(
          width, depth, placedBoxes, board, straddleY,
          packMinX, board.widthInches,
          anchorX,
          'right-to-left',
          true
        );
        // No spot even on a near-empty board means the board genuinely cannot
        // host it. Leave it to the main pass, which degrades and reports.
        if (!spot) continue;

        if (DEBUG_PLACEMENT) {
          console.log(
            `[STRADDLE] chain${placed.chainPosition} d=${depth.toFixed(2)} > band ${maxBandHeight.toFixed(2)} ` +
            `-> claimed (${(spot.x + pad).toFixed(2)}, ${spot.y.toFixed(2)}) anchored at x=${anchorX.toFixed(2)}`
          );
        }
        placements.push({ id: placed.id, x: spot.x + pad, y: spot.y });
        placedBoxes.push({ x: spot.x, y: spot.y, width, height: depth });
        preplaced.add(placed.id);
      }
    }

    runPass(chain, preplaced);
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

  /**
   * Straddler-first is a RETRY, not the default order, and that distinction is
   * the whole design.
   *
   * Claiming a deep pedal's column up front rescues the case it was built for
   * (a straddler late in the chain, arriving at rows that are already full).
   * But on a board that was packing fine it FRAGMENTS the rows: measured over
   * 1777 random dense boards, making it unconditional fixed 165 and broke 146
   * - a wash bought with churn. The worst were multi-straddler boards, where
   * two claimed mid-board columns chopped every row into unusable segments and
   * two compacts ended up exactly on top of each other.
   *
   * So try the plain order first and keep it whenever it does not degrade,
   * which leaves every already-working board bit-for-bit unchanged. Only a run
   * that had to relax chain order or reach for the no-collision-check fallback
   * pays for the retry.
   */
  const hasStraddler = placedPedals.some((p) => dims(p).depth > maxBandHeight + 1e-6);
  const orderings = hasStraddler ? [false, true] : [false];

  /*
   * Hub padding is the outermost retry axis: try WITH it, and give it up only
   * if it splits the loop group across a row. Crowded corridors beside the hub
   * cost a little; a member stranded on the next row costs two board-length
   * cables, so the padding is the cheaper thing to lose.
   *
   * Only a pedal loop can give it up - see hubPad.
   */
  const padOptions = loopGroupIds.length >= 2 ? [true, false] : [true];

  let settled = false;
  for (const padOn of padOptions) {
    if (settled) break;
    hubPadEnabled = padOn;
    for (let tier = 0; tier < CLEARANCE_TIERS.length && !settled; tier++) {
      CLUSTER_CABLE_CLEARANCE = CLEARANCE_TIERS[tier];
      for (const straddlersFirst of orderings) {
        straddleFirstPass = straddlersFirst;
        placementDegraded = false;
        placements.length = 0;
        placedBoxes.length = 0;
        attemptPlacement();
        // With the pad on, a split group is not good enough - that is the one
        // outcome dropping the pad exists to avoid.
        if (!placementDegraded && !(padOn && loopGroupSplit())) { settled = true; break; }
      }
      if (!settled && tier < CLEARANCE_TIERS.length - 1 && DEBUG_PLACEMENT) {
        console.log(`[GREEDY] Placement degraded at clearance ${CLUSTER_CABLE_CLEARANCE}, retrying tighter`);
      }
    }
  }

  // Nothing worked at any clearance or ordering. Return the plain run at the
  // tightest clearance - exactly what this returned before straddler-first
  // existed, so a board that was already unsatisfiable is not ALSO changed.
  if (!settled) {
    CLUSTER_CABLE_CLEARANCE = CLEARANCE_TIERS[CLEARANCE_TIERS.length - 1];
    hubPadEnabled = true;
    straddleFirstPass = false;
    placementDegraded = false;
    placements.length = 0;
    placedBoxes.length = 0;
    attemptPlacement();
  }

  return { placements, degraded: placementDegraded };
}

/**
 * Greedy placement. See calculateGreedyPlacementWithDiagnostics when you need
 * to know whether the placer had to degrade to get there.
 */
export function calculateGreedyPlacement(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  routingConfig?: RoutingConfig
): PedalPlacement[] {
  return calculateGreedyPlacementWithDiagnostics(
    placedPedals, pedalsById, board, routingConfig
  ).placements;
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
  /**
   * The placer had to degrade to produce the layout being returned - it fell
   * back to order-relaxed or anywhere-on-board placement rather than honouring
   * its own row and clearance rules.
   *
   * Distinct from `noLegalCandidate`: that means nothing legal was found at
   * all. This means something was found, by giving up on the rules. A user
   * looking at a cramped board deserves to know which.
   */
  placementDegraded?: boolean;
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
    // The user's own layout was not placed by us, so there is nothing to
    // have degraded.
    degraded: false,
  };

  // Pedals the optimizer may turn unasked: a jack-facing change to gain from,
  // not a treadle, and not locked by the owner. See rotation-eligibility.
  // Absent config means allowed - the guard is what makes it safe, not the flag.
  const allowRotation = routingConfig?.allowRotation ?? true;
  const rotatableIds = allowRotation
    ? placedPedals
        .filter((p) => canOptimizerRotate(pedalsById[p.pedalId] || p.pedal, p))
        .map((p) => p.id)
    : [];

  const hasOrderSearch =
    swappableGroups.length > 0 && swappableGroups.some(g => g.pedalIds.length >= 2);

  // Nothing to search: greedy placement, kept only if it beats what's there
  if (!hasOrderSearch && rotatableIds.length === 0) {
    const greedy = calculateGreedyPlacementWithDiagnostics(
      placedPedals, pedalsById, board, routingConfig
    );
    const placements = greedy.placements;
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
      // Only meaningful for a layout we actually returned.
      placementDegraded: keepBaseline ? false : greedy.degraded,
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
    const greedy = calculateGreedyPlacementWithDiagnostics(
      reordered, pedalsById, board, routingConfig
    );
    const placements = greedy.placements;

    // HARD collision guard: a candidate whose placement overlaps or leaves
    // the board is never eligible, no matter how short its cables score
    // (the routing cost has no overlap term - shorter-but-colliding layouts
    // would otherwise win)
    if (hasPlacementCollision(placements, reordered, pedalsById, board)) {
      return { placements, score: Infinity, cost: undefined, degraded: greedy.degraded };
    }

    const cost = calculateRoutingCost(
      placements, reordered, pedalsById, board, undefined, useEffectsLoop, use4CableMethod, routingConfig
    );
    return { placements, score: cost.totalScore, cost, degraded: greedy.degraded };
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
  // HONESTLY: this guard cannot currently fire, and we now know WHY rather
  // than merely that no input was found. Overlapping pedals make the cables
  // between them unroutable, and the routing cost penalises that far more than
  // tight packing can save - measured, a 0.02in overlap (pedals all but
  // touching, cables all but zero-length) still scores about FOUR times worse
  // than a properly spaced layout. A colliding baseline can never win on
  // points, so this never has to reject one: disabling it leaves the whole
  // suite green.
  //
  // It is kept because that is a property of the COST function, not of this
  // one, and cost functions get rebalanced. It is also the exact analogue of a
  // bug PROVEN real in the sibling early-return path above (which returned a
  // colliding layout scoring better than a legal one), and `evaluate()` yields
  // Infinity for every colliding candidate - so if all 48 orders collide,
  // `best.placements` would be a colliding layout that a legal baseline should
  // beat. Guarding one path and not the other is how the two drift apart.
  //
  // The precondition is pinned by "cannot profit from colliding, however small
  // the overlap" in __tests__/placement-property.test.ts, which fails the day
  // this guard becomes load-bearing.
  if (baselineCandidate.score <= best.score + 1e-9) {
    best = baselineCandidate;
  }

  // Stages 1 and 2 alternate until neither improves.
  //
  // They used to run ONCE each: every order at the starting rotations, then
  // every rotation at the winning order. That explores a single path through
  // (order x rotation) space, and which path depends on the scores - so it is
  // only as good as the first stage's guess.
  //
  // P1.5 made that visible. With the cost function scoring real drawn geometry,
  // the search on the J$ Home board settled on a layout scoring 168.65 while a
  // reachable layout scoring 135.08 - 17 inches less cable - went unvisited,
  // purely because the better one needs a different order AND a different
  // rotation, and neither stage could see past the other.
  //
  // Alternating is ordinary coordinate descent: each pass takes the best order
  // at the current rotations, then the best rotations at that order, and stops
  // when a full pass finds nothing. Only strictly-better candidates are ever
  // kept, so re-optimizing an optimized layout is still a no-op (idempotence,
  // asserted by config-matrix). MAX_EVALUATIONS still bounds the whole thing.
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const scoreAtPassStart = best.score;

    // --- Stage 1: chain orders at the current rotations ----------------------
    for (const order of candidateOrders) {
      if (order === bestOrder) continue;
      if (evaluations >= MAX_EVALUATIONS) break;
      const result = evaluate(order, bestRotations);
      if (Number.isFinite(result.score)) anyLegalCandidate = true;
      if (result.score < best.score - 1e-9) {
        best = result;
        bestOrder = order;
      }
    }

    // --- Stage 2: rotation coordinate descent at the current order -----------
    for (const id of rotatableIds) {
      const current = bestRotations.get(id) ?? 0;
      for (const rotation of [0, 90, 180, 270]) {
        if (rotation === current) continue;
        // A half turn leaves the pedal upside down - refused outright, whatever
        // it scores. See mayRotateTo.
        if (!mayRotateTo(rotation)) continue;
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

    if (best.score >= scoreAtPassStart - 1e-9) break; // a full pass changed nothing
    if (evaluations >= MAX_EVALUATIONS) break;
  }

  const changedRotations = [...bestRotations]
    .filter(([id, rot]) => rot !== (pedalById.get(id)?.rotationDegrees ?? 0))
    .map(([id, rotationDegrees]) => ({ id, rotationDegrees }));

  /*
   * A loop hub is listed before the pedals in its loop.
   *
   * normalizeChain already does this, but the order SEARCH above works on raw
   * permutations and does not know the rule, so whichever order it settles on
   * can put the hub back after its members. The board then showed the right
   * thing - the hub beside the chorus, drives after it - while the chain list
   * read "Conspiracy -> TS9 -> NS-2", describing a rig that was not on screen.
   *
   * Placement is unaffected either way: the topology decides loop membership
   * by ID, not by position. This is about the two views agreeing.
   */
  const hoisted = [...bestOrder];
  const loopForOrder = resolvePedalLoop(
    hoisted.map((id) => pedalById.get(id)!).filter(Boolean),
    (p) => pedalsById[p.pedalId] || p.pedal,
    routingConfig
  );
  if (loopForOrder && !loopForOrder.loopPedal.chainPositionLocked) {
    const firstMember = hoisted.findIndex((id) => loopForOrder.memberIds.includes(id));
    const hubAt = hoisted.indexOf(loopForOrder.loopPedal.id);
    if (firstMember >= 0 && hubAt > firstMember) {
      hoisted.splice(hubAt, 1);
      hoisted.splice(firstMember, 0, loopForOrder.loopPedal.id);
    }
  }

  return {
    placements: best.placements,
    chainOrder: hoisted,
    swappableGroups,
    rotations: changedRotations.length > 0 ? changedRotations : undefined,
    baselineCost,
    // `best.cost` is the winner's own score object, not a recomputation, so
    // what the UI reports is literally what the search compared.
    cost: best.cost,
    noLegalCandidate: !anyLegalCandidate,
    // The WINNER's flag, not any candidate's - the search may have degraded
    // its way through a dozen arrangements and still returned a clean one.
    placementDegraded: best.degraded,
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
  /**
   * The first `limit` permutations, in the order the full enumeration would
   * have produced them - and it STOPS there.
   *
   * This used to build every permutation and let the caller's cap discard the
   * rest, which is factorial work for a constant-size answer. A single
   * swappable group of 12 pedals meant 12! = 479,001,600 arrays to keep 48,
   * and the process ran out of heap: measured 31ms at 6 pedals, 63ms at 8,
   * 1.9s at 10, and dead at 12. Since the optimizer runs in a Web Worker, that
   * crash took the worker with it - no reply, no error the host could catch,
   * and an Optimize button that spins forever.
   *
   * Same traversal order, so the candidate set is unchanged for every group
   * small enough that the old code finished at all.
   */
  const permutations = (ids: string[], limit: number): string[][] => {
    const out: string[][] = [];
    const walk = (chosen: string[], rest: string[]) => {
      if (out.length >= limit) return;
      if (rest.length === 0) {
        out.push(chosen);
        return;
      }
      for (let i = 0; i < rest.length; i++) {
        if (out.length >= limit) return;
        walk([...chosen, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
      }
    };
    walk([], ids);
    return out;
  };

  let candidates: string[][] = [initialOrder];

  for (const group of swappableGroups) {
    if (group.pedalIds.length < 2) continue;

    // `cap` is the most any single candidate can consume before the caps
    // below break out, so generating more is dead work by construction.
    const groupPerms = permutations(group.pedalIds, cap);
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
