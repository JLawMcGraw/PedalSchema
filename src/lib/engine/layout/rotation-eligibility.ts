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

/**
 * Above either of these a pedal is "large", which is the DEFAULT for the
 * per-board rotation lock - not a veto.
 *
 * It was a veto once, as a proxy for "can you still step on the footswitch",
 * and it was wrong twice over. Rotation turns the footswitch sideways on ANY
 * pedal, a 2.87in compact as much as a 3.98in EQ-200, so width never
 * discriminated on foot access. And it excluded precisely the pedals rotation
 * exists to help, because manufacturers put jacks on the top edge PRECISELY
 * when a pedal is wide enough to have room there: "has top jacks" and "wider
 * than a compact" are nearly the same statement. It left ZERO rotatable pedals
 * in a 63-pedal catalogue - a rule that only ever fired as a false negative.
 *
 * As a default it is honest: a size heuristic is a good guess at what someone
 * would rather not have turned, and they can say otherwise per pedal.
 *
 * Calibrated against the real catalogue, not chosen for roundness: a BOSS
 * compact is 2.87 x 5.08in and stays unlocked; EQ-200 is 3.98 x 5.43in and
 * PW-3 is 3.15 x 7.56in and both lock by default.
 */
export const MAX_ROTATABLE_WIDTH_INCHES = 3.5;
export const MAX_ROTATABLE_DEPTH_INCHES = 5.5;

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
