/**
 * Cable Endpoint Positions
 *
 * SINGLE SOURCE OF TRUTH for where cable endpoints live:
 * - External endpoints (guitar, amp input/send/return) relative to the board
 * - Pedal jack positions (rotation-aware, with synthetic fallbacks)
 *
 * Used by the canvas renderer, the routing engine, the optimizer cost
 * function, and cable-length estimation, so they all agree on geometry.
 * The convention matches what the editor canvas actually draws:
 * guitar 1.5" right of the board, amp panel 1.5" left of the board with
 * RTN at 0.2 x depth, SND at 0.5, IN at 0.8 (or 0.5 when no FX loop).
 */

import type { Board, Pedal, PlacedPedal, PedalJack } from '@/types';
import type { Point } from '../geometry';

/** Horizontal distance of external endpoints from the board edge, in inches */
export const EXTERNAL_OFFSET_INCHES = 1.5;

/** Amp jack vertical positions as fractions of board depth */
export const AMP_RETURN_Y_FRACTION = 0.2;
export const AMP_SEND_Y_FRACTION = 0.5;
export const AMP_INPUT_Y_FRACTION_WITH_LOOP = 0.8;
export const AMP_INPUT_Y_FRACTION_NO_LOOP = 0.5;

export type ExternalEndpointType = 'guitar' | 'amp_input' | 'amp_send' | 'amp_return';

/**
 * Get an external endpoint position in INCHES (board coordinate space).
 */
export function getExternalEndpointInches(
  type: ExternalEndpointType,
  board: Board,
  useEffectsLoop: boolean = false
): Point {
  switch (type) {
    case 'guitar':
      return { x: board.widthInches + EXTERNAL_OFFSET_INCHES, y: board.depthInches / 2 };
    case 'amp_return':
      return { x: -EXTERNAL_OFFSET_INCHES, y: board.depthInches * AMP_RETURN_Y_FRACTION };
    case 'amp_send':
      return { x: -EXTERNAL_OFFSET_INCHES, y: board.depthInches * AMP_SEND_Y_FRACTION };
    case 'amp_input':
      return {
        x: -EXTERNAL_OFFSET_INCHES,
        y: board.depthInches * (useEffectsLoop ? AMP_INPUT_Y_FRACTION_WITH_LOOP : AMP_INPUT_Y_FRACTION_NO_LOOP),
      };
  }
}

/**
 * Get an external endpoint position in PIXELS.
 */
export function getExternalEndpointPx(
  type: ExternalEndpointType,
  board: Board,
  scale: number,
  useEffectsLoop: boolean = false
): Point {
  const inches = getExternalEndpointInches(type, board, useEffectsLoop);
  return { x: inches.x * scale, y: inches.y * scale };
}

/**
 * Find a jack of a specific type on a pedal.
 * Returns a synthetic jack if not found (for pedals without that jack type).
 * Convention: input/send on the right edge, output/return on the left edge
 * (signal flows right-to-left, guitar on the right, amp on the left).
 */
export function findJack(pedal: Pedal, jackType: 'input' | 'output' | 'send' | 'return'): PedalJack {
  // Try to find the actual jack
  const jack = pedal.jacks?.find((j) => j.jackType === jackType);
  if (jack) return jack;

  // For send/return, only return synthetic if pedal supports it
  if (jackType === 'send' || jackType === 'return') {
    const hasSend = pedal.jacks?.some(j => j.jackType === 'send');
    const hasReturn = pedal.jacks?.some(j => j.jackType === 'return');
    if (!hasSend && !hasReturn && !pedal.supports4Cable) {
      // This pedal doesn't have loop jacks - return a dummy that won't be used
      // but won't cause null errors
      return {
        id: `synthetic-${jackType}`,
        pedalId: pedal.id,
        jackType: jackType,
        side: jackType === 'send' ? 'right' : 'left',
        positionPercent: 25,
        label: jackType.toUpperCase(),
      };
    }
  }

  // Create synthetic jack for input/output (all pedals have these)
  const isInput = jackType === 'input' || jackType === 'send';
  return {
    id: `synthetic-${jackType}`,
    pedalId: pedal.id,
    jackType: jackType,
    side: isInput ? 'right' : 'left',
    positionPercent: 50,
    label: jackType.toUpperCase(),
  };
}

/**
 * Calculate the position of a jack on a placed pedal, in INCHES.
 * Handles pedal rotation (jack sides rotate with the pedal).
 */
export function getJackPosition(
  placedPedal: PlacedPedal,
  jack: PedalJack,
  pedal: Pedal
): Point {
  const isRotated = placedPedal.rotationDegrees === 90 || placedPedal.rotationDegrees === 270;

  // Get effective dimensions after rotation
  const effectiveWidth = isRotated ? pedal.depthInches : pedal.widthInches;
  const effectiveDepth = isRotated ? pedal.widthInches : pedal.depthInches;

  // Calculate jack position based on side and position percent
  let jackOffsetX = 0;
  let jackOffsetY = 0;

  // Map the original jack side through rotation
  const rotationSteps = placedPedal.rotationDegrees / 90;
  const sides: Array<'top' | 'right' | 'bottom' | 'left'> = ['top', 'right', 'bottom', 'left'];
  const originalSideIndex = sides.indexOf(jack.side);
  const rotatedSideIndex = (originalSideIndex + rotationSteps) % 4;
  const rotatedSide = sides[rotatedSideIndex];

  const positionRatio = jack.positionPercent / 100;

  switch (rotatedSide) {
    case 'top':
      jackOffsetX = effectiveWidth * positionRatio;
      jackOffsetY = 0;
      break;
    case 'bottom':
      jackOffsetX = effectiveWidth * positionRatio;
      jackOffsetY = effectiveDepth;
      break;
    case 'left':
      jackOffsetX = 0;
      jackOffsetY = effectiveDepth * positionRatio;
      break;
    case 'right':
      jackOffsetX = effectiveWidth;
      jackOffsetY = effectiveDepth * positionRatio;
      break;
  }

  return {
    x: placedPedal.xInches + jackOffsetX,
    y: placedPedal.yInches + jackOffsetY,
  };
}

/**
 * Get a pedal jack position in PIXELS, handling rotation and missing jack
 * definitions via synthetic fallbacks.
 */
export function getPedalJackPx(
  placed: PlacedPedal,
  pedal: Pedal,
  jackType: string,
  scale: number
): Point {
  const jack = findJack(pedal, jackType as 'input' | 'output' | 'send' | 'return');
  const inches = getJackPosition(placed, jack, pedal);
  return { x: inches.x * scale, y: inches.y * scale };
}
