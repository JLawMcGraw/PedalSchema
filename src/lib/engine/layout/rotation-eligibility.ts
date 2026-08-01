/**
 * Which pedals the OPTIMIZER may turn, and why some of them it may not.
 *
 * Manual rotation is deliberately not governed by any of this: you can turn any
 * pedal on your own board by hand, because you know why. This module only
 * decides what the automatic search is allowed to do unasked.
 *
 * Two reasons to refuse, plus a prune:
 *
 * 1. FOOT-SWEPT (hard rule). A wah or volume treadle is worked by rocking
 *    heel-to-toe along its long axis. Turned ninety degrees it cannot be played
 *    at all - that is broken, not merely awkward, so no toggle offers it.
 *
 * 2. LOCKED BY THE OWNER (hard rule, per board). Most people would not want a
 *    6.5in reverb turned even though it fits and would route better. That is a
 *    taste judgement about this pedal on this board, so it is stored there -
 *    see PlacedPedal.rotationLocked - and defaulted ON for large pedals when
 *    the pedal is added.
 *
 * 3. NO FACING CHANGE (a prune, not a rule). A pedal with its jacks on the left
 *    and right edges - the ordinary case, and every BOSS compact - gains
 *    nothing from being turned: rotation moves those jacks to the top and
 *    bottom, which makes the cable run WORSE. The search would discover that
 *    itself and discard the candidate; skipping it early just keeps the
 *    evaluation budget for pedals that can actually gain.
 *
 * What is deliberately NOT here is a fit rule. "Will it still fit turned?" is
 * already answered by the search: hasPlacementCollision scores any overlapping
 * or off-board candidate Infinity, measuring with ROTATED dimensions, and a
 * rotation is kept only when it is strictly better. A guard for that would be
 * redundant, and the width veto that used to live here was exactly that
 * mistake wearing a foot-access costume - see isLargePedal below.
 */

import type { Pedal, PlacedPedal } from '@/types';
import { rotationSteps } from '../geometry/rotation';

/**
 * Above either of these a pedal is "large", which is the DEFAULT for the
 * per-board rotation lock - not a veto.
 *
 * It was a veto once, at 3.5 x 5.5in, as a proxy for "can you still step on
 * the footswitch", and that is simply not what width measures: rotation turns
 * the footswitch sideways on ANY pedal, a 2.87in compact as much as a 3.98in
 * EQ-200. It also excluded the pedals rotation exists to help, leaving ZERO
 * rotatable pedals in what was then a 63-pedal catalogue - a rule that only
 * ever fired as a false negative.
 *
 * The explanation offered at the time was that makers put jacks on the top
 * edge precisely when a pedal is wide enough to have room there, so "has top
 * jacks" and "wider than a compact" were nearly the same statement. That
 * generalisation is FALSE and the catalogue now disproves it: the Way Huge
 * Smalls series is 2.4in wide - narrower than a BOSS compact - with both
 * signal jacks on the top edge. The zero was an artefact of a BOSS-heavy
 * catalogue, not a law about pedals. The veto is still wrong, but for the
 * first reason alone, which is the one that was always doing the work.
 *
 * As a default it is honest: a size heuristic is a good guess at what someone
 * would rather not have turned, and they can say otherwise per pedal. But the
 * OLD numbers could not be reused as that default, because they were tuned to
 * exclude EQ-200 - the very pedal we just decided should be turnable. Reusing
 * them would have carried the rejected judgement forward, and left all seven
 * newly-eligible pedals locked out of the box: the veto again, wearing a
 * default's clothes.
 *
 * These are placed in the EMPTY BANDS of the real catalogue, so no pedal sits
 * near a line and a small data correction cannot flip one:
 *
 *   widths ... 3.5, 3.98, 4.0 | 4.5 | 4.8, 5.5, 5.79, 6.5, 6.69, 10.04
 *   depths ... 5.43, 5.5, 5.6 | 6.5 | 7.3, 7.52, 7.56, 9.06, 10.0
 *
 * What that buys: the 3.98in 200-series and the 5.6in-deep RAT stay unlocked
 * and can be turned to shorten a cable run; the 6.5in Strymons, the 5.5in
 * fuzzes and the 10in SY-300 arrive locked, because "big enough that you would
 * mind it sitting sideways" is what the default is actually guessing at.
 */
export const MAX_ROTATABLE_WIDTH_INCHES = 4.5;
export const MAX_ROTATABLE_DEPTH_INCHES = 6.5;

/**
 * A treadle is deep. This is an independent functional test rather than a size
 * threshold catching a functional problem by luck - it must stay true even for
 * a short treadle, now that size no longer vetoes anything.
 */
const TREADLE_DEPTH_INCHES = 6;

/** Big enough that most people would rather it stayed facing forward. */
export function isLargePedal(pedal: Pick<Pedal, 'widthInches' | 'depthInches'>): boolean {
  return (
    pedal.widthInches > MAX_ROTATABLE_WIDTH_INCHES ||
    pedal.depthInches > MAX_ROTATABLE_DEPTH_INCHES
  );
}

/** Pedals played by rocking a treadle, which only works facing forward. */
export function isFootSwept(pedal: Pick<Pedal, 'category' | 'depthInches'>): boolean {
  if (pedal.category === 'volume') return true;
  // 'filter' covers both wah treadles and ordinary envelope-filter boxes; only
  // the treadle-shaped ones are swept.
  return pedal.category === 'filter' && pedal.depthInches > TREADLE_DEPTH_INCHES;
}

/** Does turning this pedal move a signal jack onto a different edge? */
export function hasTopOrBottomSignalJack(pedal: Pick<Pedal, 'jacks'>): boolean {
  return !!pedal.jacks?.some(
    (j) =>
      (j.jackType === 'input' || j.jackType === 'output') &&
      (j.side === 'top' || j.side === 'bottom')
  );
}

/**
 * May the optimizer turn this pedal without being asked?
 *
 * Takes the PLACED pedal as well as the catalogue entry, because the lock is a
 * decision about this pedal on this board, not about the model.
 *
 * Note the jack clause is a DATA dependency: a pedal with no jack rows at all
 * can never qualify, and part of the catalogue has none. Rotation is only as
 * alive as the jack data behind it.
 */
export function canOptimizerRotate(
  pedal: Pick<Pedal, 'widthInches' | 'depthInches' | 'category' | 'jacks'> | undefined,
  placed?: Pick<PlacedPedal, 'rotationLocked'>
): boolean {
  if (!pedal) return false;
  if (placed?.rotationLocked) return false;
  return hasTopOrBottomSignalJack(pedal) && !isFootSwept(pedal);
}

/**
 * May the optimizer turn a pedal to THIS angle?
 *
 * A property of the angle, not the pedal: HALF TURNS ARE REFUSED, because a
 * pedal rotated 180 degrees is upside down. Its labels read inverted and its
 * footswitch sits at the far edge, so you step over the pedal to reach it.
 * That is a usability fact the routing score cannot see - the score measures
 * cable length, and on some boards the half turn is the SHORTEST option, so it
 * wins on points while being the one arrangement nobody would build.
 *
 * Reported as a bug the first time it fired: a Way Huge Smalls came out upside
 * down with its jacks pointing at the player.
 *
 * A NOTE ON THE ARGUMENT, because the first version of this rule used a worse
 * one. It originally refused any rotation that put a signal jack on the FRONT
 * edge, reasoning that cables there run across the front of the board where
 * your feet are. That is only true for a pedal in the FRONT row: for one at
 * the back, a front-facing jack feeds the corridor BETWEEN rows, which is
 * exactly where cables belong. The rule happened to catch the right case for
 * the wrong reason. Upside-down is the part that is true wherever the pedal
 * sits.
 *
 * Quarter turns are allowed. A pedal on its side is a thing people really do
 * build, particularly one with top-mounted jacks; a pedal on its head is not.
 *
 * COST OF THIS RULE, measured so it is not a surprise later: on the twelve-
 * pedal fixture the half turn was the ONLY rotation that improved anything
 * (404 against 413 at rest, with the quarter turns at 1335 and 1123), so
 * banning it makes the optimizer leave that board alone entirely. On the real
 * 7-pedal board quarter turns still earn 4-7%. Rotation fires less often now,
 * and that is the intended trade.
 */
export function mayRotateTo(rotationDegrees: number): boolean {
  return rotationSteps(rotationDegrees) !== 2;
}
