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
import { rotateSide, rotatedFootprint } from '../geometry/rotation';

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
 * How much a jack's label says "this is the one a single mono cable goes to".
 * Higher wins. 0 means the label tells us nothing.
 *
 * A pedal can carry two jacks of the same TYPE - stereo A/B pairs, guitar and
 * bass inputs, a direct out beside the real one. 39 of the 59 catalogued
 * pedals do, in the 12 label patterns scored below, and 13 of them are on the
 * two saved boards.
 *
 * The label is the only thing that can settle it, because it is what is
 * silkscreened on the enclosure. Position cannot:
 *
 *     BF-3   [OUTPUT A (MONO)] @22   [OUTPUT B] @38
 *     DD-7   [OUTPUT B] @22          [OUTPUT A (MONO)] @38
 *
 * A "lowest position" rule picks the mono jack on the BF-3 and the stereo-only
 * jack on the DD-7. There is no positional rule that is right for both.
 *
 * Each clause below is a real pattern from the catalogue, not a guess at what
 * might exist. The MONO ones are unambiguous - the pedal says so.
 *
 * LEFT was shipped as a convention and is now VERIFIED, which is why it is no
 * longer grouped with the judgement calls. It rides on exactly three pedals,
 * all Strymon - Timeline and BigSky on `test`, Flint on J$ Home - and Strymon
 * publish the answer directly:
 *
 *   "Connect a mono TS instrument cable into the LEFT INPUT and LEFT OUTPUT
 *    for a mono connection."   (BigSky, Mobius, NightSky, TimeLine, Volante)
 *   Flint, a two-footswitch pedal: mono TS into the INPUT and the LEFT OUTPUT.
 *   https://www.strymon.net/faq/mono-and-stereo-connections/
 *   https://www.strymon.net/support/flint/      read 2026-08-10
 *
 * Note what did NOT change: the jack LABELS still read "LEFT OUT"/"RIGHT OUT",
 * because that is what is silkscreened on the enclosure. Writing "(MONO)" into
 * them would make the label a worse record of the pedal in order to make this
 * function's job easier. The label records the enclosure; this function records
 * the manufacturer's wiring instruction. Two different facts, two homes.
 *
 * Two judgement calls remain, and these are the ones to revisit:
 *   - GUITAR IN over BASS IN, because this is a guitar pedalboard. That is a
 *     product decision living in the router; if bass rigs ever matter it
 *     belongs on the configuration instead. Affects the AW-3 and BF-3.
 *   - the plain OUTPUT over a DIRECT OUT or BYPASS, which are side feeds
 *     rather than the effected signal path.
 */
export function monoAffinity(label: string | null | undefined): number {
  if (!label) return 0;
  const l = label.toUpperCase();
  // "OUTPUT A (MONO)", "OUTPUT A/MONO", "MONO OUT", "INPUT-A (MONO)"
  if (l.includes('MONO')) return 4;
  if (l.includes('STEREO') || /\bRIGHT\b/.test(l)) return -1;
  if (/\bLEFT\b/.test(l)) return 3;
  if (/\bGUITAR\b/.test(l)) return 2;
  if (/\bBASS\b/.test(l)) return -1;
  // A bare OUTPUT/INPUT beats a qualified side feed (DIRECT OUT, BYPASS).
  if (l === 'OUTPUT' || l === 'INPUT') return 1;
  return 0;
}

/**
 * Find a jack of a specific type on a pedal.
 * Returns a synthetic jack if not found (for pedals without that jack type).
 * Convention: input/send on the right edge, output/return on the left edge
 * (signal flows right-to-left, guitar on the right, amp on the left).
 *
 * When a pedal has SEVERAL jacks of the requested type this used to take
 * `.find()` - the first one in an array ordered by nothing at all, since the
 * jacks arrive from a PostgREST embed with no ORDER BY. That silently wired
 * the DD-7 and the EQ-200 into `OUTPUT B`, a jack that only carries signal in
 * stereo. See `monoAffinity` for why the label and not the position decides,
 * and `find-jack.test.ts` for all 12 patterns.
 */
export function findJack(pedal: Pedal, jackType: 'input' | 'output' | 'send' | 'return'): PedalJack {
  // Try to find the actual jack
  const candidates = pedal.jacks?.filter((j) => j.jackType === jackType) ?? [];
  if (candidates.length > 0) {
    // Sorted, not scanned, and the comparator is TOTAL: affinity first, then
    // position, then id. Without that last clause two unlabelled jacks would
    // compare equal and the array order - the thing we cannot trust - would
    // be back in charge.
    const [best] = [...candidates].sort((a, b) => {
      const affinity = monoAffinity(b.label) - monoAffinity(a.label);
      if (affinity !== 0) return affinity;
      if (a.positionPercent !== b.positionPercent) return a.positionPercent - b.positionPercent;
      return String(a.id).localeCompare(String(b.id));
    });
    return best;
  }

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
 * The jacks to DRAW for a pedal, and whether each one is real or assumed.
 *
 * The canvas used to render `pedal.jacks` directly, which meant a pedal with
 * no researched jack data drew no jacks at all - while its cables attached
 * perfectly happily to the right and left edges, because findJack() above
 * synthesises them. The picture and the wiring disagreed, and the picture was
 * the one that looked broken.
 *
 * So both now come from the same place. A pedal with no data gets the same
 * input/output pair the router will use, flagged `assumed` so the canvas can
 * draw it as a guess rather than as knowledge - which is the whole reason the
 * jack provenance columns exist.
 *
 * Note what is NOT synthesised: power, send/return, expression. Nothing routes
 * to them, and inventing a DC jack position is exactly the kind of confident
 * fiction this is meant to replace.
 */
export function jacksToRender(
  pedal: Pick<Pedal, 'id' | 'jacks'>
): Array<PedalJack & { assumed?: boolean }> {
  if (pedal.jacks?.length) return pedal.jacks;
  return [
    { ...findJack(pedal as Pedal, 'input'), assumed: true },
    { ...findJack(pedal as Pedal, 'output'), assumed: true },
  ];
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
  // Effective dimensions and jack edge after rotation
  const { widthInches: effectiveWidth, depthInches: effectiveDepth } = rotatedFootprint(
    pedal,
    placedPedal.rotationDegrees
  );
  const rotatedSide = rotateSide(jack.side, placedPedal.rotationDegrees);

  // Calculate jack position based on side and position percent
  let jackOffsetX = 0;
  let jackOffsetY = 0;

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
