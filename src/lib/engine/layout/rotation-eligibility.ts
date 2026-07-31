/**
 * Which pedals the OPTIMIZER may turn, and why most of them it may not.
 *
 * Manual rotation is deliberately not governed by any of this: you can turn any
 * pedal on your own board by hand, because you know why. This module only
 * decides what the automatic search is allowed to do unasked.
 *
 * Three independent reasons to refuse, all of them physical:
 *
 * 1. NO FACING CHANGE. A pedal with its jacks on the left and right edges - the
 *    ordinary case, and every BOSS compact - gains nothing from being turned:
 *    rotation moves those jacks to the top and bottom, which makes the cable
 *    run WORSE, not better. Only a pedal with a top- or bottom-mounted jack has
 *    anything to gain, which is why this rule predates the others.
 *
 * 2. TOO LARGE. You operate a pedal with your foot. A big enclosure turned
 *    sideways puts its footswitch where your foot does not go, and eats a row
 *    doing it.
 *
 * 3. FOOT-SWEPT. A wah or volume treadle is worked by rocking heel-to-toe along
 *    its long axis. Turned ninety degrees it cannot be played at all - it is not
 *    merely awkward, it is broken.
 */

import type { Pedal } from '@/types';

/**
 * Above either of these a pedal is "large".
 *
 * Calibrated against the real catalogue, not chosen for roundness: a BOSS
 * compact is 2.87 x 5.08in and must pass; EQ-200 is 3.98 x 5.43in and must not;
 * PW-3 is 3.15 x 7.56in and must not. That leaves 3.5in of width and 5.5in of
 * depth as the dividing line, with the compacts clearing it comfortably on both
 * axes and nothing in the catalogue sitting awkwardly near it.
 */
export const MAX_ROTATABLE_WIDTH_INCHES = 3.5;
export const MAX_ROTATABLE_DEPTH_INCHES = 5.5;

/**
 * A treadle is deep. The size rule already excludes every treadle in the
 * catalogue, so this is belt-and-braces against a short one - cheap to keep,
 * and it states the reason in its own right rather than relying on a size
 * threshold to catch a functional problem by luck.
 */
const TREADLE_DEPTH_INCHES = 6;

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
 * Note the first clause is a DATA dependency: a pedal with no jack rows at all
 * can never qualify, and most of the catalogue has none. Rotation is only as
 * alive as the jack data behind it.
 */
export function canOptimizerRotate(
  pedal: Pick<Pedal, 'widthInches' | 'depthInches' | 'category' | 'jacks'> | undefined
): boolean {
  if (!pedal) return false;
  return hasTopOrBottomSignalJack(pedal) && !isLargePedal(pedal) && !isFootSwept(pedal);
}
