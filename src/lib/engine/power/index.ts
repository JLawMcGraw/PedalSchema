/**
 * What this board asks of a power supply.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: an unrecorded current draw is not a
 * draw of zero. `Pedal.currentMa` is nullable, and a `?? 0` anywhere in a total
 * turns "we do not know" into "free" - which reports an inadequate supply as
 * adequate, the one wrong answer that costs someone a gig. So the total here is
 * explicitly the KNOWN total, and the pedals it could not account for are
 * returned alongside it. A caller that wants a single number has to decide, in
 * the open, what to do about the unknowns.
 *
 * Everything here is per BOARD, derived, and pure - see src/store/derived.ts.
 */

import type { Pedal, PlacedPedal } from '@/types';

/**
 * A typical isolated-supply output. Not a limit this module enforces - supplies
 * vary and many have one or two high-current outputs - but the threshold above
 * which a pedal cannot be assumed to share, and has to be planned for.
 *
 * Grounded in the catalogue: BOSS compacts draw 25-75mA and the Way Huge Smalls
 * 16-19mA, so ordinary pedals sit far below this. The pedals that cross it are
 * the digital ones - the Strymons at 300mA each - and those are exactly the
 * ones people discover too late.
 */
export const TYPICAL_OUTPUT_MA = 100;

export interface PowerDemand {
  /** Placed pedal id, so the UI can select the pedal it is talking about. */
  placedPedalId: string;
  name: string;
  currentMa: number;
}

export interface VoltageGroup {
  voltage: number;
  /** Sum over pedals in this group whose draw is known. */
  knownTotalMa: number;
  pedalCount: number;
  unknownCount: number;
}

export interface PowerSummary {
  /**
   * Total draw of the pedals whose draw is KNOWN. A floor, not a fact,
   * whenever `unknown` is non-empty - present it as "at least".
   */
  knownTotalMa: number;
  /** Pedals with no recorded draw. The reason the total is a floor. */
  unknown: Array<{ placedPedalId: string; name: string }>;
  /** Total pedals considered, including the unknowns. */
  pedalCount: number;
  /**
   * Pedals drawing more than a typical output can give. Each needs an output
   * of its own, so this is not something the total can express.
   */
  highDraw: PowerDemand[];
  /** Split by voltage: a 9V and an 18V pedal cannot share an output. */
  byVoltage: VoltageGroup[];
}

const EMPTY: PowerSummary = {
  knownTotalMa: 0, unknown: [], pedalCount: 0, highDraw: [], byVoltage: [],
};

/**
 * Summarise the power demand of a board.
 *
 * Counts EVERY placed pedal, including ones switched off. `isActive` is a
 * signal-path state - a bypassed pedal is still plugged into the supply and
 * still draws its current, so excluding it would under-report exactly the
 * board someone is about to build.
 */
export function derivePowerSummary(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): PowerSummary {
  if (placedPedals.length === 0) return EMPTY;

  let knownTotalMa = 0;
  const unknown: PowerSummary['unknown'] = [];
  const highDraw: PowerDemand[] = [];
  const groups = new Map<number, VoltageGroup>();

  for (const placed of placedPedals) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    const voltage = pedal.voltage ?? 9;
    const group = groups.get(voltage) ?? {
      voltage, knownTotalMa: 0, pedalCount: 0, unknownCount: 0,
    };
    group.pedalCount++;

    // The whole point: null is not zero, and neither is undefined.
    if (pedal.currentMa == null) {
      unknown.push({ placedPedalId: placed.id, name: pedal.name });
      group.unknownCount++;
    } else {
      knownTotalMa += pedal.currentMa;
      group.knownTotalMa += pedal.currentMa;
      if (pedal.currentMa > TYPICAL_OUTPUT_MA) {
        highDraw.push({ placedPedalId: placed.id, name: pedal.name, currentMa: pedal.currentMa });
      }
    }
    groups.set(voltage, group);
  }

  return {
    knownTotalMa,
    unknown,
    pedalCount: placedPedals.length,
    highDraw: highDraw.sort((a, b) => b.currentMa - a.currentMa),
    byVoltage: [...groups.values()].sort((a, b) => a.voltage - b.voltage),
  };
}

/**
 * One line stating the demand, phrased so an unknown never reads as a zero.
 *
 * "986mA" and "at least 986mA (1 pedal unknown)" describe very different
 * boards, and the difference is the whole reason this module exists.
 */
export function describePowerSummary(summary: PowerSummary): string {
  if (summary.pedalCount === 0) return 'No pedals on the board.';
  const unknownCount = summary.unknown.length;
  if (unknownCount === 0) return `${summary.knownTotalMa}mA across ${summary.pedalCount} pedals.`;
  if (unknownCount === summary.pedalCount) {
    return `Draw unknown for all ${summary.pedalCount} pedals.`;
  }
  return (
    `At least ${summary.knownTotalMa}mA across ${summary.pedalCount} pedals - ` +
    `${unknownCount} ${unknownCount === 1 ? 'pedal has' : 'pedals have'} no recorded draw.`
  );
}
