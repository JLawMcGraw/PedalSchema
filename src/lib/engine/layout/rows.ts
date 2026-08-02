/**
 * Where the rows of a board are, and how deep each one is.
 *
 * EXTRACTED so there is exactly one answer to "where are the rows". There used
 * to be two, and they disagreed. The placer derived rows from pedal DEPTH,
 * using rails only to snap a derived row onto a real mounting bar. The routing
 * cost's row-alignment penalty did something else entirely - it treated EVERY
 * RAIL as a row:
 *
 *   const rowYPositions = rails.length > 0
 *     ? rails.map(r => r.positionFromBackInches)
 *     : [board.depthInches * 0.55, board.depthInches * 0.05];
 *
 * which is the exact "rails are not rows" mistake the placer was fixed for,
 * plus the hardcoded two-row fallback the placer had already abandoned. The
 * consequence was that the optimizer REJECTED ITS OWN PLACER'S OUTPUT: on a
 * Classic Jr with rails at 0, 3.1, 6.2 and 9.3in, the placer puts a row at
 * y=7.3 and the scorer then charged it 1.1in of misalignment for not sitting
 * on rail 6.2. A layout with a shorter cable run (48.4in against 55.7in) lost
 * on row alignment (110 against 88) and Optimize did nothing at all.
 *
 * Anything that needs to know where rows are must call THIS.
 */
import type { Board, Pedal, PlacedPedal } from '@/types';
import { COLLISION_SPACING } from '../collision';
import { rotatedFootprint } from '../geometry/rotation';
import { ROW_GAP, MIN_ROW_CLEARANCE } from './constants';

/**
 * One row of the board: where its pedals' back edges sit, and how deep the
 * band is. Rows are NOT all the same height - see below.
 */
export interface RowBand {
  y: number;
  height: number;
}

/**
 * Why the rows came out the way they did.
 *
 * deriveRows computes all of this to place the bands and then throws it away,
 * returning only {y, height}. That is why the optimizer can only say "could
 * not fit these pedals on this board" - it genuinely does not know which
 * constraint bound. Phase 6 established the binding constraint is usually
 * CORRIDORS, not area: three rows of ~5.1in pedals on a 16in board leave
 * 0.2in between rows against a ~0.24in patch cable.
 */
export interface RowFit {
  /** How many bands the board holds at the sizing depth */
  rowCount: number;
  /** Corridor between adjacent bands, inches - what cables have to run through */
  corridorInches: number;
  /** Depth the bands themselves consume */
  usedInches: number;
  boardDepthInches: number;
  /** Deepest pedal on the board */
  deepestPedalInches: number;
  /** Pedals too deep for any band - they must straddle two rows */
  straddlerCount: number;
  /** The corridor is at its floor: no room left between rows */
  corridorAtFloor: boolean;
}

export interface RowLayout {
  rows: RowBand[];
  fit: RowFit;
}

export function deriveRowBands(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): RowBand[] {
  return deriveRowLayout(placedPedals, pedalsById, board).rows;
}

/**
 * Rows, plus the arithmetic that produced them. `deriveRowBands` is this
 * without the diagnostic - kept because most callers place pedals and do not
 * explain themselves.
 */
export function deriveRowLayout(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): RowLayout {
  const dims = (placed: PlacedPedal): { width: number; depth: number } => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return { width: 2.87, depth: 5.12 };
    const { widthInches, depthInches } = rotatedFootprint(pedal, placed.rotationDegrees);
    return { width: widthInches, depth: depthInches };
  };

  const rails = [...(board.rails || [])].sort((a, b) => b.positionFromBackInches - a.positionFromBackInches);

  const maxDepth = placedPedals.reduce((max, placed) => Math.max(max, dims(placed).depth), 0);

  // Filled by deriveRows below. The empty-board shape is the honest answer for
  // a board with nothing on it, not a placeholder.
  let fit: RowFit = {
    rowCount: 0,
    corridorInches: 0,
    usedInches: 0,
    boardDepthInches: board.depthInches,
    deepestPedalInches: maxDepth,
    straddlerCount: 0,
    corridorAtFloor: false,
  };

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

    // Capture the arithmetic on the way past. Every number here was already
    // computed to place the bands; recording it costs nothing and is the only
    // way anything downstream can say WHICH constraint bound.
    const tallestBand = heights.reduce((max, h) => Math.max(max, h), 0);
    fit = {
      rowCount: count,
      corridorInches: gap,
      usedInches: used,
      boardDepthInches: board.depthInches,
      deepestPedalInches: maxDepth,
      straddlerCount: placedPedals.filter((p) => dims(p).depth > tallestBand + 1e-6).length,
      corridorAtFloor: count > 1 && gap <= MIN_ROW_CLEARANCE + 1e-6,
    };

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


  return { rows, fit };
}
