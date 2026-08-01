/**
 * Every pedal in these cases is a real one, at its real catalogue dimensions.
 * Invented numbers are how the row-height work went wrong earlier this week -
 * an assumed 5.08in that was really 5.10in silently disabled the whole feature.
 */
import { describe, it, expect } from 'vitest';
import type { Pedal, PedalJack } from '@/types';
import {
  canOptimizerRotate,
  mayRotateTo,
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
const BIGSKY = pedal({ name: 'BigSky', category: 'reverb', widthInches: 6.5, depthInches: 5.1, jacks: TOP_JACKS });
const RAT_2 = pedal({ name: 'RAT 2', category: 'distortion', widthInches: 3.3, depthInches: 5.6 });

describe('isLargePedal', () => {
  // No longer a veto - this is the DEFAULT for the per-board rotation lock.
  it('leaves the standard compacts the catalogue is mostly made of unlocked', () => {
    expect(isLargePedal(BOSS_COMPACT)).toBe(false);
    expect(isLargePedal(BOSS_COMPACT_5_10)).toBe(false);
  });

  it('leaves the 200-series unlocked - locking them would restore the veto', () => {
    // The whole point of the rework. EQ-200 is 3.98 x 5.43in: bigger than a
    // compact, but not "big enough that you would mind it sideways", and it is
    // one of only seven pedals in the catalogue that can gain from turning at
    // all. Under the old 3.5 x 5.5in numbers all seven defaulted to locked,
    // which is the veto by another name.
    expect(isLargePedal(EQ_200)).toBe(false);
    expect(isLargePedal(RAT_2)).toBe(false); // 5.6in deep, still an ordinary box
  });

  it('locks the genuinely big - Strymon on width, PW-3 on depth', () => {
    expect(isLargePedal(BIGSKY)).toBe(true); // 6.5in wide
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

  it('allows a LARGE top-jack pedal - size is a default, not a veto', () => {
    // The regression the width veto caused: EQ-200 is exactly the pedal
    // rotation exists to help, and the old rule refused it. Whether it FITS
    // turned is the search's business, not this module's.
    expect(canOptimizerRotate(EQ_200)).toBe(true);
  });

  it('still refuses the foot-swept, top jacks notwithstanding', () => {
    // A rotated treadle cannot be rocked. Broken, not awkward - no toggle.
    expect(canOptimizerRotate(PW_3)).toBe(false);
    expect(canOptimizerRotate(FV_500)).toBe(false);
  });

  it('refuses a pedal the owner has locked on this board', () => {
    expect(canOptimizerRotate(EQ_200, { rotationLocked: true })).toBe(false);
    // ...and the same pedal model unlocked is still allowed, so the lock is
    // what did the refusing and not something about EQ-200 itself.
    expect(canOptimizerRotate(EQ_200, { rotationLocked: false })).toBe(true);
    expect(canOptimizerRotate(EQ_200, {})).toBe(true);
  });

  it('refuses a pedal with no jack data at all', () => {
    // Part of the catalogue. Rotation is only as alive as the jack data.
    expect(canOptimizerRotate(pedal({ jacks: [] }))).toBe(false);
    expect(canOptimizerRotate(pedal({ jacks: undefined }))).toBe(false);
    expect(canOptimizerRotate(undefined)).toBe(false);
  });
});

describe('mayRotateTo - no upside-down pedals', () => {
  /*
   * A pedal at 180 degrees reads inverted and puts its footswitch at the far
   * edge. The routing score cannot see that - it measures length, and the half
   * turn is sometimes the SHORTEST option, so it wins on points while being
   * the one arrangement nobody would build.
   */
  it('refuses the half turn', () => {
    expect(mayRotateTo(180)).toBe(false);
    expect(mayRotateTo(-180)).toBe(false);
  });

  it('allows rest and the quarter turns', () => {
    // A pedal on its side is a thing people really do build, especially one
    // with top-mounted jacks. A pedal on its head is not.
    expect(mayRotateTo(0)).toBe(true);
    expect(mayRotateTo(90)).toBe(true);
    expect(mayRotateTo(270)).toBe(true);
    expect(mayRotateTo(-90)).toBe(true);
    expect(mayRotateTo(360)).toBe(true);
  });

  it('is about the ANGLE, not the pedal - it needs nothing else to decide', () => {
    // The first version of this rule refused any rotation that put a signal
    // jack on the front edge, on the grounds that cables there run where your
    // feet are. That holds only for a FRONT-ROW pedal: at the back, a
    // front-facing jack feeds the corridor between rows, which is where cables
    // belong. Upside-down is true wherever the pedal sits, so the rule needs
    // no jack data and cannot be fooled by a pedal that has none.
    expect(mayRotateTo(180)).toBe(false);
  });
});
