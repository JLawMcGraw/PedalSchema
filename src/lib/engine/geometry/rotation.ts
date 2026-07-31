/**
 * Pedal orientation — the SINGLE SOURCE OF TRUTH for what rotation means.
 *
 * This exists because the same three facts were re-derived all over the
 * codebase: twelve copies of `deg === 90 || deg === 270`, and three independent
 * implementations of "step a jack's side around the compass". Three copies of
 * one rule is three chances for them to disagree, and they already did - only
 * the layout engine's copy guarded against a negative rotation.
 *
 * Kept separate from ./index.ts (cable geometry, clearances, path validation)
 * because the canvas renderer needs orientation and should not pull the routing
 * policy in with it.
 */

import type { JackSide } from '@/types';

/** Sides in clockwise order — rotating a pedal steps a jack along this ring. */
const SIDES: readonly JackSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Quarter-turns clockwise, normalised to 0-3.
 *
 * `rotation_degrees` is a bare INTEGER in the database with no CHECK
 * constraint, so -90 and 450 are storable even though the app only ever writes
 * 0/90/180/270. Normalising here means a stray value degrades to the right
 * orientation instead of silently reading as "not rotated".
 */
export function rotationSteps(rotationDegrees: number): number {
  return ((Math.round(rotationDegrees / 90) % 4) + 4) % 4;
}

/** Does this rotation swap the pedal's width and depth? */
export function isRotated(rotationDegrees: number): boolean {
  const steps = rotationSteps(rotationDegrees);
  return steps === 1 || steps === 3;
}

/** Which edge a jack ends up on once the pedal is rotated. */
export function rotateSide(side: JackSide, rotationDegrees: number): JackSide {
  const index = SIDES.indexOf(side);
  if (index < 0) return side;
  return SIDES[(index + rotationSteps(rotationDegrees)) % 4];
}

/**
 * The footprint a pedal actually occupies on the board once rotated: a pedal
 * turned on its side is as wide as it is deep.
 */
export function rotatedFootprint(
  pedal: { widthInches: number; depthInches: number },
  rotationDegrees: number
): { widthInches: number; depthInches: number } {
  return isRotated(rotationDegrees)
    ? { widthInches: pedal.depthInches, depthInches: pedal.widthInches }
    : { widthInches: pedal.widthInches, depthInches: pedal.depthInches };
}
