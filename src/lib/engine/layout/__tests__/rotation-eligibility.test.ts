/**
 * Every pedal in these cases is a real one, at its real catalogue dimensions.
 * Invented numbers are how the row-height work went wrong earlier this week -
 * an assumed 5.08in that was really 5.10in silently disabled the whole feature.
 */
import { describe, it, expect } from 'vitest';
import type { Pedal, PedalJack } from '@/types';
import {
  canOptimizerRotate,
  hasTopOrBottomSignalJack,
  isFootSwept,
  isLargePedal,
} from '../rotation-eligibility';

const jacks = (...specs: Array<[PedalJack['jackType'], PedalJack['side']]>): PedalJack[] =>
  specs.map(([jackType, side], i) => ({
    id: `j${i}`, pedalId: 'p', jackType, side, positionPercent: 50, label: null,
  }));

const SIDE_JACKS = jacks(['input', 'right'], ['output', 'left'], ['power', 'top']);
const TOP_JACKS = jacks(['input', 'top'], ['output', 'top'], ['power', 'top']);

const pedal = (over: Partial<Pedal>): Pedal =>
  ({
    id: 'p', name: 'test', manufacturer: 'BOSS', category: 'overdrive',
    widthInches: 2.87, depthInches: 5.08, heightInches: 2.37,
    jacks: SIDE_JACKS, ...over,
  }) as Pedal;

// Real catalogue entries
const BOSS_COMPACT = pedal({ name: 'DS-1', widthInches: 2.87, depthInches: 5.08 });
const BOSS_COMPACT_5_10 = pedal({ name: 'CS-3', widthInches: 2.9, depthInches: 5.1 });
const EQ_200 = pedal({ name: 'EQ-200', category: 'eq', widthInches: 3.98, depthInches: 5.43, jacks: TOP_JACKS });
const PW_3 = pedal({ name: 'PW-3', category: 'filter', widthInches: 3.15, depthInches: 7.56, jacks: TOP_JACKS });
const FV_500 = pedal({ name: 'FV-500', category: 'volume', widthInches: 3.5, depthInches: 5.0, jacks: TOP_JACKS });

describe('isLargePedal', () => {
  it('passes the standard compacts the catalogue is mostly made of', () => {
    expect(isLargePedal(BOSS_COMPACT)).toBe(false);
    expect(isLargePedal(BOSS_COMPACT_5_10)).toBe(false);
  });

  it('excludes EQ-200 on width and PW-3 on depth', () => {
    expect(isLargePedal(EQ_200)).toBe(true); // 3.98in wide
    expect(isLargePedal(PW_3)).toBe(true); // 7.56in deep
  });
});

describe('isFootSwept', () => {
  it('excludes volume treadles whatever their size', () => {
    expect(isFootSwept(FV_500)).toBe(true);
  });

  it('excludes a wah treadle by its depth, not its category alone', () => {
    expect(isFootSwept(PW_3)).toBe(true);
    // An envelope filter is a filter too, but it is an ordinary box you press
    expect(isFootSwept(pedal({ category: 'filter', depthInches: 5.08 }))).toBe(false);
  });

  it('leaves ordinary effects alone', () => {
    expect(isFootSwept(BOSS_COMPACT)).toBe(false);
  });
});

describe('hasTopOrBottomSignalJack', () => {
  it('is false for the ordinary left/right layout', () => {
    expect(hasTopOrBottomSignalJack(BOSS_COMPACT)).toBe(false);
  });

  it('ignores a top-mounted POWER jack - every compact has one', () => {
    // The whole seeded catalogue is input:right/output:left/power:top. If power
    // counted, every pedal would look rotatable.
    expect(hasTopOrBottomSignalJack(pedal({ jacks: jacks(['power', 'top']) }))).toBe(false);
  });

  it('is true when a signal jack is on the top edge', () => {
    expect(hasTopOrBottomSignalJack(EQ_200)).toBe(true);
  });
});

describe('canOptimizerRotate', () => {
  it('allows a compact whose jacks are on the top edge', () => {
    expect(canOptimizerRotate(pedal({ jacks: TOP_JACKS }))).toBe(true);
  });

  it('refuses a side-jack compact - turning it would move jacks off the sides', () => {
    expect(canOptimizerRotate(BOSS_COMPACT)).toBe(false);
  });

  it('refuses the large and the foot-swept, top jacks notwithstanding', () => {
    expect(canOptimizerRotate(EQ_200)).toBe(false);
    expect(canOptimizerRotate(PW_3)).toBe(false);
    expect(canOptimizerRotate(FV_500)).toBe(false);
  });

  it('refuses a pedal with no jack data at all', () => {
    // Most of the catalogue. Rotation is only as alive as the jack data.
    expect(canOptimizerRotate(pedal({ jacks: [] }))).toBe(false);
    expect(canOptimizerRotate(pedal({ jacks: undefined }))).toBe(false);
    expect(canOptimizerRotate(undefined)).toBe(false);
  });
});
