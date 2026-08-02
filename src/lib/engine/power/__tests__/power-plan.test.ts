/**
 * The supply side, and the one rule it must never break.
 *
 * `Pedal.currentMa` is nullable and null is NOT zero. On the demand side that
 * makes a total a floor. On the supply side it is sharper: an output carrying
 * a pedal of unknown draw has no headroom figure at all, and reporting
 * `rated - known` there would state a surplus the missing pedal may already
 * have consumed - reporting an inadequate supply as adequate, which is the one
 * wrong answer that costs someone a gig.
 */
import { describe, expect, it } from 'vitest';
import { derivePowerPlan, describePowerPlan } from '../index';
import type { Pedal, PlacedPedal, PowerSupply } from '@/types';

function pedal(id: string, currentMa: number | null, voltage = 9): Pedal {
  return {
    id, name: id, manufacturer: 'T', category: 'overdrive',
    widthInches: 2.9, depthInches: 5.1, heightInches: 2.3,
    voltage, currentMa, isSystem: true, jacks: [],
  } as unknown as Pedal;
}

function placed(id: string, pedalId: string, powerOutputId: string | null): PlacedPedal {
  return {
    id, pedalId, xInches: 0, yInches: 0, rotationDegrees: 0,
    chainPosition: 1, location: 'front_of_amp', isActive: true, powerOutputId,
  } as unknown as PlacedPedal;
}

function supply(
  outputs: Array<{ id: string; ma: number; v?: number; alt?: Array<{ voltage: number; ratedMa: number }> }>
): PowerSupply {
  return {
    id: 's1', name: 'Test Brick', manufacturer: 'T',
    isIsolated: true, isSystem: true, createdBy: null, notes: null,
    outputs: outputs.map((o, i) => ({
      id: o.id, supplyId: 's1', label: `Output ${i + 1}`,
      voltage: o.v ?? 9, ratedMa: o.ma, alternateModes: o.alt ?? [], sortOrder: i,
    })),
  };
}

describe('power plan', () => {
  it('reports headroom per output when every draw is known', () => {
    const byId = { a: pedal('a', 40), b: pedal('b', 30) };
    const plan = derivePowerPlan(
      [placed('p1', 'a', 'o1'), placed('p2', 'b', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 100 }, { id: 'o2', ma: 100 }])
    );

    expect(plan.outputs[0].knownDrawMa).toBe(70);
    expect(plan.outputs[0].headroomMa).toBe(30);
    expect(plan.outputs[0].overCapacity).toBe(false);
    expect(plan.outputs[1].headroomMa).toBe(100);
    expect(describePowerPlan(plan)).toMatch(/every output within its rating/);
  });

  it('flags an output whose known draw alone exceeds its rating', () => {
    const byId = { a: pedal('a', 300) };
    const plan = derivePowerPlan([placed('p1', 'a', 'o1')], byId, supply([{ id: 'o1', ma: 100 }]));

    expect(plan.outputs[0].overCapacity).toBe(true);
    expect(plan.overCapacityCount).toBe(1);
    expect(describePowerPlan(plan)).toMatch(/over capacity/);
  });

  /** THE trap. A null draw must never be summed as zero. */
  it('refuses to state headroom for an output carrying an unknown draw', () => {
    const byId = { known: pedal('known', 10), mystery: pedal('mystery', null) };
    const plan = derivePowerPlan(
      [placed('p1', 'known', 'o1'), placed('p2', 'mystery', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 100 }])
    );

    const out = plan.outputs[0];
    expect(out.unknownCount).toBe(1);
    expect(out.knownDrawMa).toBe(10);
    // NOT 90. The mystery pedal may draw 500mA.
    expect(out.headroomMa).toBeNull();
    expect(out.overCapacity).toBe(false);
    expect(plan.unjudgeableCount).toBe(1);
  });

  it('never calls a supply adequate while an unknown is on it', () => {
    const byId = { known: pedal('known', 10), mystery: pedal('mystery', null) };
    const plan = derivePowerPlan(
      [placed('p1', 'known', 'o1'), placed('p2', 'mystery', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 100 }])
    );

    const line = describePowerPlan(plan);
    expect(line).toMatch(/headroom unknown/);
    expect(line).not.toMatch(/within its rating/);
  });

  it('counts an unassigned pedal as unassigned, not as powered', () => {
    const byId = { a: pedal('a', 40) };
    const plan = derivePowerPlan([placed('p1', 'a', null)], byId, supply([{ id: 'o1', ma: 100 }]));

    expect(plan.unassigned).toHaveLength(1);
    expect(plan.outputs[0].pedals).toHaveLength(0);
    expect(describePowerPlan(plan)).toMatch(/not assigned/);
  });

  it('treats an id from a different supply as unassigned rather than crashing', () => {
    // Reachable by switching supplies with pedals already assigned.
    const byId = { a: pedal('a', 40) };
    const plan = derivePowerPlan([placed('p1', 'a', 'stale-output')], byId, supply([{ id: 'o1', ma: 100 }]));

    expect(plan.unassigned).toHaveLength(1);
    expect(plan.outputs[0].pedals).toHaveLength(0);
  });

  it('flags a voltage an output cannot deliver, separately from current', () => {
    const byId = { big: pedal('big', 20, 18) };
    const plan = derivePowerPlan([placed('p1', 'big', 'o1')], byId, supply([{ id: 'o1', ma: 500 }]));

    const out = plan.outputs[0];
    // Plenty of current, still wrong.
    expect(out.overCapacity).toBe(false);
    expect(out.voltageMismatch).toHaveLength(1);
    expect(describePowerPlan(plan)).toMatch(/wrong voltage/);
  });

  it('accepts a switchable output at one of its alternate voltages', () => {
    const byId = { big: pedal('big', 20, 18) };
    const plan = derivePowerPlan(
      [placed('p1', 'big', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 500, v: 9, alt: [{ voltage: 12, ratedMa: 375 }, { voltage: 18, ratedMa: 250 }] }])
    );

    expect(plan.outputs[0].voltageMismatch).toHaveLength(0);
    expect(plan.voltageMismatchCount).toBe(0);
  });

  /**
   * The reason alternate modes carry their own rating. Zuma outputs 8-9 give
   * 500mA at 9V but only 250mA at 18V; judging an 18V load against the 9V
   * number reports twice the headroom the output has.
   */
  it('derates a switchable output to the voltage actually being used', () => {
    const byId = { big: pedal('big', 300, 18) };
    const plan = derivePowerPlan(
      [placed('p1', 'big', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 500, v: 9, alt: [{ voltage: 12, ratedMa: 375 }, { voltage: 18, ratedMa: 250 }] }])
    );

    const out = plan.outputs[0];
    expect(out.effectiveRatedMa).toBe(250);      // not 500
    expect(out.overCapacity).toBe(true);         // 300 > 250
    expect(out.headroomMa).toBe(-50);
  });

  it('a big total against a big supply is still broken if one output is over', () => {
    // The reason this reports per output rather than in total: 2000mA of
    // supply and 380mA of demand, and it still will not run.
    const byId = { s1: pedal('s1', 300), s2: pedal('s2', 80) };
    const plan = derivePowerPlan(
      [placed('p1', 's1', 'o1'), placed('p2', 's2', 'o1')],
      byId,
      supply([{ id: 'o1', ma: 100 }, { id: 'o2', ma: 1900 }])
    );

    expect(plan.overCapacityCount).toBe(1);
    expect(plan.outputs[1].headroomMa).toBe(1900);
  });
});
