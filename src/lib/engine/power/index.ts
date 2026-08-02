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

import type { Pedal, PlacedPedal, PowerOutput, PowerSupply } from '@/types';

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

// ---------------------------------------------------------------------------
// Supply side
//
// Everything above answers "what does this board want?". Everything below
// answers "will THIS supply give it?", which is a different question and can
// fail in ways a total cannot express: a board drawing 500mA against a 2000mA
// supply is still broken if six of its pedals are on one 100mA output.
// ---------------------------------------------------------------------------

export interface AssignedPedal {
  placedPedalId: string;
  name: string;
  /** null = not recorded. NEVER coerce to 0 - see the module header. */
  currentMa: number | null;
  voltage: number;
}

export interface OutputLoad {
  output: PowerOutput;
  pedals: AssignedPedal[];
  /** Sum over assigned pedals whose draw is known. A floor when unknownCount > 0. */
  knownDrawMa: number;
  unknownCount: number;
  /**
   * The rating that actually applies, given the voltage these pedals need.
   * Equals output.ratedMa for a fixed output; lower for a switchable one
   * running above its default voltage.
   */
  effectiveRatedMa: number;
  /**
   * Rated minus known draw, or NULL when any assigned pedal's draw is unknown.
   *
   * This is the tri-state trap at its sharpest. With an unknown on the output
   * the headroom is not a number we are unsure of - it is not a number at all,
   * and reporting `rated - known` would state a surplus that the missing pedal
   * may well have consumed. A caller that wants to render something has to
   * handle the null in the open.
   */
  headroomMa: number | null;
  /** Known draw alone already exceeds the rating. True is always trustworthy. */
  overCapacity: boolean;
  /**
   * Pedals whose voltage this output cannot supply, even switched. Separate
   * from current entirely: 18V into a 9V pedal is not a budget problem.
   */
  voltageMismatch: AssignedPedal[];
}

export interface SupplyPlan {
  supply: PowerSupply;
  outputs: OutputLoad[];
  /** Placed pedals with no output chosen. Not powered, and not a rounding error. */
  unassigned: AssignedPedal[];
  /** Outputs whose KNOWN draw already exceeds their rating. */
  overCapacityCount: number;
  /** Outputs carrying a pedal whose draw is unknown, so cannot be judged. */
  unjudgeableCount: number;
  /** Outputs with a pedal this output cannot supply at any of its voltages. */
  voltageMismatchCount: number;
}

/** Every mode an output can be switched to, default first. */
function outputModes(output: PowerOutput): Array<{ voltage: number; ratedMa: number }> {
  return [{ voltage: output.voltage, ratedMa: output.ratedMa }, ...(output.alternateModes ?? [])];
}

/**
 * What this output can actually give at the voltage these pedals need.
 *
 * A switchable output derates as voltage rises, so judging an 18V load against
 * the 9V rating overstates headroom - and overstating headroom is the one
 * direction this module must never be wrong in. Where the assigned pedals
 * disagree on voltage the output is already mis-wired; the LOWEST matching
 * rating is used so the report cannot flatter it.
 */
function effectiveRating(output: PowerOutput, pedals: AssignedPedal[]): number {
  const modes = outputModes(output);
  const needed = [...new Set(pedals.map((p) => p.voltage))];
  const matching = modes.filter((m) => needed.includes(m.voltage));
  if (matching.length === 0) return output.ratedMa;
  return Math.min(...matching.map((m) => m.ratedMa));
}

/**
 * Lay this board's pedals over a supply's outputs and report what breaks.
 *
 * Reports per OUTPUT rather than in total, because that is where supplies
 * actually fail. Nothing here rounds an unknown into a number.
 */
export function derivePowerPlan(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  supply: PowerSupply
): SupplyPlan {
  const byOutput = new Map<string, AssignedPedal[]>();
  const unassigned: AssignedPedal[] = [];

  for (const placed of placedPedals) {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;
    const entry: AssignedPedal = {
      placedPedalId: placed.id,
      name: pedal.name,
      currentMa: pedal.currentMa ?? null,
      voltage: pedal.voltage ?? 9,
    };

    const outputId = placed.powerOutputId ?? null;
    // An id pointing at an output this supply does not have (the user switched
    // supplies) is unassigned, not a crash and not a silent drop.
    const known = outputId && supply.outputs.some((o) => o.id === outputId);
    if (!known) {
      unassigned.push(entry);
      continue;
    }
    const list = byOutput.get(outputId!) ?? [];
    list.push(entry);
    byOutput.set(outputId!, list);
  }

  const outputs: OutputLoad[] = [...supply.outputs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((output) => {
      const pedals = byOutput.get(output.id) ?? [];
      let knownDrawMa = 0;
      let unknownCount = 0;
      const voltageMismatch: AssignedPedal[] = [];
      const canSupply = outputModes(output).map((m) => m.voltage);

      for (const p of pedals) {
        if (p.currentMa == null) unknownCount++;
        else knownDrawMa += p.currentMa;
        if (!canSupply.includes(p.voltage)) voltageMismatch.push(p);
      }

      // Rate against the voltage actually being asked for, not the default.
      const ratedMa = effectiveRating(output, pedals);

      return {
        output,
        pedals,
        knownDrawMa,
        unknownCount,
        effectiveRatedMa: ratedMa,
        headroomMa: unknownCount > 0 ? null : ratedMa - knownDrawMa,
        overCapacity: knownDrawMa > ratedMa,
        voltageMismatch,
      };
    });

  return {
    supply,
    outputs,
    unassigned,
    overCapacityCount: outputs.filter((o) => o.overCapacity).length,
    unjudgeableCount: outputs.filter((o) => o.unknownCount > 0 && !o.overCapacity).length,
    voltageMismatchCount: outputs.filter((o) => o.voltageMismatch.length > 0).length,
  };
}

/**
 * One line on whether the supply covers the board.
 *
 * Never claims adequacy it cannot support. An output carrying a pedal of
 * unknown draw is reported as unjudgeable, not as fine - the whole reason this
 * module exists is that "we do not know" must not round to "yes".
 */
export function describePowerPlan(plan: SupplyPlan): string {
  const problems: string[] = [];

  if (plan.overCapacityCount > 0) {
    const n = plan.overCapacityCount;
    problems.push(`${n} output${n === 1 ? '' : 's'} over capacity`);
  }
  if (plan.voltageMismatchCount > 0) {
    const n = plan.voltageMismatchCount;
    problems.push(`${n} output${n === 1 ? '' : 's'} at the wrong voltage`);
  }
  if (plan.unassigned.length > 0) {
    const n = plan.unassigned.length;
    problems.push(`${n} pedal${n === 1 ? '' : 's'} not assigned to an output`);
  }

  if (problems.length > 0) {
    return `${plan.supply.name}: ${problems.join(', ')}.`;
  }
  if (plan.unjudgeableCount > 0) {
    const n = plan.unjudgeableCount;
    return (
      `${plan.supply.name}: no output is over its rating, but ${n} ` +
      `carr${n === 1 ? 'ies' : 'y'} a pedal with no recorded draw - headroom unknown.`
    );
  }
  const assigned = plan.outputs.reduce((sum, o) => sum + o.pedals.length, 0);
  if (assigned === 0) return `${plan.supply.name}: no pedals assigned yet.`;
  return `${plan.supply.name}: every output within its rating.`;
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
