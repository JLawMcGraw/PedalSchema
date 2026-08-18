/**
 * Signal Chain Engine Tests
 *
 * Verifies category-based ordering, locked-position preservation
 * (chain_position_locked wiring), and that split chains carry final
 * (not stale) chain positions.
 */

import { describe, it, expect } from 'vitest';
import type { Pedal, PlacedPedal, ChainContext } from '@/types';
import { signalChainEngine } from '../index';

const NOW = '2024-01-01T00:00:00Z';

function makePedal(id: string, category: Pedal['category']): Pedal {
  return {
    id,
    name: `Pedal ${id}`,
    manufacturer: 'Test',
    category,
    widthInches: 2.87,
    depthInches: 5.12,
    heightInches: 2.37,
    voltage: 9,
    currentMa: 50,
    polarity: 'center_negative',
    defaultChainPosition: null,
    preferredLocation: 'front_of_amp',
    supports4Cable: false,
    needsBufferBefore: false,
    needsDirectPickup: false,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    notes: null,
    jacks: [],
  } as Pedal;
}

function makePlaced(
  id: string,
  pedalId: string,
  chainPosition: number,
  overrides: Partial<PlacedPedal> = {}
): PlacedPedal {
  return {
    id,
    configurationId: 'config-1',
    pedalId,
    xInches: 0,
    yInches: 0,
    rotationDegrees: 0,
    chainPosition,
    location: 'front_of_amp',
    isActive: true,
    useLoop: false,
    createdAt: NOW,
    ...overrides,
  };
}

const noLoopContext: ChainContext = {
  ampHasEffectsLoop: false,
  useEffectsLoop: false,
  use4CableMethod: false,
  modulationInLoop: false,
};

const loopContext: ChainContext = {
  ampHasEffectsLoop: true,
  useEffectsLoop: true,
  use4CableMethod: false,
  modulationInLoop: false,
};

function setup(entries: Array<[string, Pedal['category'], number, Partial<PlacedPedal>?]>) {
  const pedalsById: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];
  for (const [id, category, pos, overrides] of entries) {
    const pedal = makePedal(`pedal-${id}`, category);
    pedalsById[pedal.id] = pedal;
    placed.push(makePlaced(id, pedal.id, pos, overrides));
  }
  return { pedalsById, placed };
}

describe('category default ordering', () => {
  it('orders tuner before overdrive before delay regardless of input order', () => {
    const { pedalsById, placed } = setup([
      ['delay1', 'delay', 1],
      ['od1', 'overdrive', 2],
      ['tuner1', 'tuner', 3],
    ]);

    const result = signalChainEngine.calculate(placed, pedalsById, noLoopContext);
    const order = result.orderedPedals.map((p) => p.id);

    expect(order).toEqual(['tuner1', 'od1', 'delay1']);
    // Positions are sequential starting at 1
    expect(result.orderedPedals.map((p) => p.chainPosition)).toEqual([1, 2, 3]);
  });
});

describe('locked chain positions (chain_position_locked)', () => {
  it('keeps a locked pedal at its pinned slot while rules order the rest', () => {
    // A delay locked at position 1 - category rules would normally put it last
    const { pedalsById, placed } = setup([
      ['delay1', 'delay', 1, { chainPositionLocked: true }],
      ['od1', 'overdrive', 2],
      ['tuner1', 'tuner', 3],
    ]);

    const result = signalChainEngine.calculate(placed, pedalsById, noLoopContext);
    const order = result.orderedPedals.map((p) => p.id);

    expect(order[0]).toBe('delay1');
    expect(result.orderedPedals[0].chainPosition).toBe(1);
    // The unlocked pedals are still rule-ordered after it
    expect(order).toEqual(['delay1', 'tuner1', 'od1']);
  });

  it('does not move a locked delay into the effects loop', () => {
    const { pedalsById, placed } = setup([
      ['delay1', 'delay', 2, { chainPositionLocked: true }],
      ['od1', 'overdrive', 1],
      ['delay2', 'delay', 3],
    ]);

    const result = signalChainEngine.calculate(placed, pedalsById, loopContext);

    const lockedDelay = result.orderedPedals.find((p) => p.id === 'delay1')!;
    const freeDelay = result.orderedPedals.find((p) => p.id === 'delay2')!;

    // Locked pedal is fully pinned: order AND location untouched
    expect(lockedDelay.location).toBe('front_of_amp');
    expect(lockedDelay.chainPosition).toBe(2);
    // The unlocked delay is moved to the loop by the time-effects rule
    expect(freeDelay.location).toBe('effects_loop');
  });

  it('survives adding another pedal (the recalculation that used to clobber manual order)', () => {
    const { pedalsById, placed } = setup([
      ['delay1', 'delay', 1, { chainPositionLocked: true }],
      ['od1', 'overdrive', 2],
    ]);

    // First calculation
    const first = signalChainEngine.calculate(placed, pedalsById, noLoopContext);
    expect(first.orderedPedals[0].id).toBe('delay1');

    // Simulate adding a tuner (which rules want at the very front)
    const tuner = makePedal('pedal-tuner1', 'tuner');
    pedalsById[tuner.id] = tuner;
    const withTuner = [...first.orderedPedals, makePlaced('tuner1', tuner.id, 3)];

    const second = signalChainEngine.calculate(withTuner, pedalsById, noLoopContext);
    // The locked delay still holds slot 1; the tuner goes after it
    expect(second.orderedPedals[0].id).toBe('delay1');
    expect(second.orderedPedals.map((p) => p.id)).toEqual(['delay1', 'tuner1', 'od1']);
  });
});

describe('split chains carry final positions', () => {
  it('frontOfAmpChain and effectsLoopChain reflect post-assignment numbering', () => {
    const { pedalsById, placed } = setup([
      ['od1', 'overdrive', 1],
      ['delay1', 'delay', 2],
      ['reverb1', 'reverb', 3],
    ]);

    const result = signalChainEngine.calculate(placed, pedalsById, loopContext);

    // Every pedal in the split chains must carry the same chainPosition as
    // its counterpart in orderedPedals (previously the split was computed
    // before renumbering and could go stale)
    const byId = new Map(result.orderedPedals.map((p) => [p.id, p.chainPosition]));
    for (const p of [...result.frontOfAmpChain, ...result.effectsLoopChain]) {
      expect(p.chainPosition).toBe(byId.get(p.id));
    }

    expect(result.frontOfAmpChain.map((p) => p.id)).toEqual(['od1']);
    expect(result.effectsLoopChain.map((p) => p.id)).toEqual(['delay1', 'reverb1']);
  });
});

describe('a pedal cannot sit in a loop the rig does not have', () => {
  /*
   * addPedal copies the catalogue's preferredLocation onto the placed pedal,
   * so adding a chorus (preferred: effects_loop) to a board with no effects
   * loop filed it under 'effects_loop'. The properties panel hides the Signal
   * Location control when there is no loop - correctly, there is nothing to
   * choose - so the pedal sat somewhere the user could neither see nor change.
   *
   * Harmless while the loop is off, because the topology is then one chain.
   * The trap is later: switching the loop ON would yank that pedal into the
   * loop segment, undoing a chain position the owner had deliberately pinned.
   */
  const inLoop = (overrides: Partial<PlacedPedal> = {}) =>
    setup([
      ['tuner1', 'tuner', 1],
      ['chorus1', 'modulation', 2, { location: 'effects_loop', ...overrides }],
    ]);

  it('moves it front-of-amp when the amp has no loop', () => {
    const { pedalsById, placed } = inLoop();
    const result = signalChainEngine.calculate(placed, pedalsById, noLoopContext);
    expect(result.orderedPedals.find((p) => p.id === 'chorus1')!.location).toBe('front_of_amp');
    expect(result.effectsLoopChain).toHaveLength(0);
  });

  it('moves it front-of-amp when the loop exists but is switched off', () => {
    const { pedalsById, placed } = inLoop();
    const result = signalChainEngine.calculate(placed, pedalsById, {
      ampHasEffectsLoop: true, useEffectsLoop: false,
      use4CableMethod: false, modulationInLoop: false,
    });
    expect(result.orderedPedals.find((p) => p.id === 'chorus1')!.location).toBe('front_of_amp');
  });

  it('leaves it alone when there really is a loop in use', () => {
    // A DELAY, deliberately, not the chorus the other cases use. This asserts
    // that step 3b does NOT fire when a loop exists - an invariant that holds
    // for every category. Written with a modulation pedal it also silently
    // asserted that the modulation switch does nothing in its off position,
    // which is the bug fixed on 2026-08-18: loopContext has modulationInLoop
    // false, so a chorus here now correctly lands front_of_amp. The switch's
    // own behaviour is tested in 'the modulation switch works in both
    // directions' below; this test is about the loop existing.
    const { pedalsById, placed } = setup([
      ['tuner1', 'tuner', 1],
      ['delay1', 'delay', 2, { location: 'effects_loop' }],
    ]);
    const result = signalChainEngine.calculate(placed, pedalsById, loopContext);
    expect(result.orderedPedals.find((p) => p.id === 'delay1')!.location).toBe('effects_loop');
  });

  it('does not disturb a pinned chain position while correcting the location', () => {
    // The case this came from: the owner pinned a chorus directly after the
    // tuner to use it as a preamp. Correcting its location must not move it.
    const { pedalsById, placed } = inLoop({ chainPositionLocked: true });
    const result = signalChainEngine.calculate(placed, pedalsById, noLoopContext);
    const chorus = result.orderedPedals.find((p) => p.id === 'chorus1')!;
    const tuner = result.orderedPedals.find((p) => p.id === 'tuner1')!;
    expect(chorus.location).toBe('front_of_amp');
    expect(chorus.chainPosition).toBe(tuner.chainPosition + 1);
  });
});

describe('the modulation switch works in both directions', () => {
  /*
   * `modulationInLoop` used to be one-directional: the rule moved modulation
   * INTO the loop when the flag was on and returned the chain untouched when
   * it was off. So a pedal that had ever been in the loop could never come
   * back, and the panel's "Dirty: modulation before preamp" described a state
   * the engine could not produce.
   *
   * It read as fully inert because of where it was looked at: on `test` both
   * modulation pedals are already `effects_loop` in stored data (no-op in
   * either direction), and on J$ Home one of the two is chainPositionLocked,
   * which excludes it from rule processing entirely. Only the OFF direction
   * was ever actually broken.
   */
  const modContext = (modulationInLoop: boolean, use4CableMethod = false): ChainContext => ({
    ampHasEffectsLoop: true,
    useEffectsLoop: true,
    use4CableMethod,
    modulationInLoop,
  });

  const locationOf = (result: ReturnType<typeof signalChainEngine.calculate>, id: string) =>
    result.orderedPedals.find((p) => p.id === id)!.location;

  it('ON moves a front-of-amp modulation pedal into the loop', () => {
    const { pedalsById, placed } = setup([
      ['tuner1', 'tuner', 1],
      ['chorus1', 'modulation', 2, { location: 'front_of_amp' }],
    ]);
    const result = signalChainEngine.calculate(placed, pedalsById, modContext(true));
    expect(locationOf(result, 'chorus1')).toBe('effects_loop');
  });

  it('OFF returns a stored-in-loop modulation pedal to the front - the direction that was missing', () => {
    const { pedalsById, placed } = setup([
      ['tuner1', 'tuner', 1],
      ['chorus1', 'modulation', 2, { location: 'effects_loop' }],
    ]);
    const result = signalChainEngine.calculate(placed, pedalsById, modContext(false));
    expect(locationOf(result, 'chorus1')).toBe('front_of_amp');
  });

  it('treats tremolo the same as modulation in both directions', () => {
    const { pedalsById, placed } = setup([
      ['trem1', 'tremolo', 1, { location: 'front_of_amp' }],
    ]);
    expect(locationOf(signalChainEngine.calculate(placed, pedalsById, modContext(true)), 'trem1'))
      .toBe('effects_loop');

    const { pedalsById: byId2, placed: placed2 } = setup([
      ['trem1', 'tremolo', 1, { location: 'effects_loop' }],
    ]);
    expect(locationOf(signalChainEngine.calculate(placed2, byId2, modContext(false)), 'trem1'))
      .toBe('front_of_amp');
  });

  it('ON -> OFF -> ON round-trips to where it started', () => {
    // The round trip is the test the one-directional rule could not pass: its
    // second leg was a no-op, so the third had nothing to move and the chain
    // never came back. Each leg is fed the PREVIOUS leg's output, which is
    // what the store does - normalizeChain writes locations back onto
    // placedPedals, so every toggle starts from the last one's result.
    const { pedalsById, placed } = setup([
      ['tuner1', 'tuner', 1],
      ['chorus1', 'modulation', 2, { location: 'front_of_amp' }],
      ['delay1', 'delay', 3, { location: 'front_of_amp' }],
    ]);

    const on1 = signalChainEngine.calculate(placed, pedalsById, modContext(true));
    expect(locationOf(on1, 'chorus1')).toBe('effects_loop');

    const off = signalChainEngine.calculate(on1.orderedPedals, pedalsById, modContext(false));
    expect(locationOf(off, 'chorus1')).toBe('front_of_amp');
    // The delay is not modulation's business: the time-effects rule owns it,
    // and it stays in the loop across the whole round trip.
    expect(locationOf(off, 'delay1')).toBe('effects_loop');

    const on2 = signalChainEngine.calculate(off.orderedPedals, pedalsById, modContext(true));
    expect(locationOf(on2, 'chorus1')).toBe('effects_loop');
    expect(on2.orderedPedals.map((p) => `${p.id}:${p.chainPosition}:${p.location}`))
      .toEqual(on1.orderedPedals.map((p) => `${p.id}:${p.chainPosition}:${p.location}`));
  });

  it('never moves a pedal the user placed by hand, in either direction', () => {
    // locationOverride was respected in the ON direction only because the OFF
    // direction did not exist. A symmetric rule can lose that guard silently,
    // and the user would find their manual placement undone by a switch.
    const front = setup([
      ['chorus1', 'modulation', 1, { location: 'front_of_amp', locationOverride: true }],
    ]);
    expect(locationOf(signalChainEngine.calculate(front.placed, front.pedalsById, modContext(true)), 'chorus1'))
      .toBe('front_of_amp');

    const loop = setup([
      ['chorus1', 'modulation', 1, { location: 'effects_loop', locationOverride: true }],
    ]);
    expect(locationOf(signalChainEngine.calculate(loop.placed, loop.pedalsById, modContext(false)), 'chorus1'))
      .toBe('effects_loop');
  });

  it('OFF wins over the 4-cable method for modulation, but not for delay and reverb', () => {
    // Owner's decision, 2026-08-18. four-cable-fx-loop (priority 104) puts all
    // four time-based categories in the loop; modulation-flexible (priority
    // 50) runs after it and pulls modulation back when the switch is off.
    // Delay and reverb stay put - post-preamp is the point of the method for
    // those, while modulation placement is taste. A lower-priority rule
    // overriding a higher one is deliberate here.
    const { pedalsById, placed } = setup([
      ['chorus1', 'modulation', 1, { location: 'front_of_amp' }],
      ['delay1', 'delay', 2, { location: 'front_of_amp' }],
      ['verb1', 'reverb', 3, { location: 'front_of_amp' }],
    ]);

    const on = signalChainEngine.calculate(placed, pedalsById, modContext(true, true));
    expect(locationOf(on, 'chorus1')).toBe('effects_loop');

    const off = signalChainEngine.calculate(placed, pedalsById, modContext(false, true));
    expect(locationOf(off, 'chorus1')).toBe('front_of_amp');
    expect(locationOf(off, 'delay1')).toBe('effects_loop');
    expect(locationOf(off, 'verb1')).toBe('effects_loop');
  });

  it('leaves the switch to step 3b when the rig has no loop at all', () => {
    // Two places writing the same location is how the duplicated jack policy
    // started. With no loop, this rule must return the chain untouched and
    // let step 3b sweep every category to front_of_amp.
    const { pedalsById, placed } = setup([
      ['chorus1', 'modulation', 1, { location: 'effects_loop' }],
    ]);
    for (const modulationInLoop of [false, true]) {
      const result = signalChainEngine.calculate(placed, pedalsById, {
        ampHasEffectsLoop: false, useEffectsLoop: false,
        use4CableMethod: false, modulationInLoop,
      });
      expect(locationOf(result, 'chorus1')).toBe('front_of_amp');
    }
  });

  it('does not move a modulation pedal whose chain position is pinned', () => {
    // J$ Home's Chorus Ensemble Deluxe, which is why the switch looked dead
    // there: locked pedals are excluded from rule processing entirely, both
    // ordering AND location. That is the documented contract of a pin.
    const { pedalsById, placed } = setup([
      ['tuner1', 'tuner', 1],
      ['chorus1', 'modulation', 2, { location: 'front_of_amp', chainPositionLocked: true }],
    ]);
    const result = signalChainEngine.calculate(placed, pedalsById, modContext(true));
    expect(locationOf(result, 'chorus1')).toBe('front_of_amp');
  });
});

describe('a loop hub is ordered before the pedals in its loop', () => {
  /*
   * Category ordering puts a noise gate AFTER the drives, which is right for a
   * gate wired inline. Wired as an NS-2 style loop hub it is wrong: the signal
   * reaches the gate first, leaves through its send to the drives, and returns
   * - so the hub belongs immediately before its members, and a chain list
   * showing it after them describes a different rig than the cables do.
   */
  const rig = () => setup([
    ['tuner1', 'tuner', 1],
    ['chorus1', 'modulation', 2, { chainPositionLocked: true }],
    ['od1', 'overdrive', 3],
    ['od2', 'overdrive', 4],
    ['gate1', 'noise_gate', 5, { useLoop: true }],
    ['delay1', 'delay', 6],
  ]);
  const order = (r: { orderedPedals: PlacedPedal[] }) =>
    [...r.orderedPedals].sort((a, b) => a.chainPosition - b.chainPosition).map((p) => p.id);

  const loopConfig = (hubId: string, memberIds: string[]) => ({
    useLoopPedals: true, use4CableMethod: false, pedalConfigs: [
      { pedalId: hubId, mode: 'loop' as const, loopPedalIds: memberIds },
    ],
  });

  it('leaves the gate after the drives when no loop is configured', () => {
    const { pedalsById, placed } = rig();
    const noLoop = placed.map((p) => (p.id === 'gate1' ? { ...p, useLoop: false } : p));
    const r = signalChainEngine.calculate(noLoop, pedalsById, noLoopContext);
    expect(order(r)).toEqual(['tuner1', 'chorus1', 'od1', 'od2', 'gate1', 'delay1']);
  });

  it('moves the hub in front of its members when the loop IS configured', () => {
    const { pedalsById, placed } = rig();
    const r = signalChainEngine.calculate(placed, pedalsById, noLoopContext,
      loopConfig('gate1', ['od1', 'od2']));
    expect(order(r)).toEqual(['tuner1', 'chorus1', 'gate1', 'od1', 'od2', 'delay1']);
  });

  it('is idempotent - re-normalizing its own output changes nothing', () => {
    // The hoist runs BEFORE locked pedals are re-inserted. Doing it after
    // shifted a pinned pedal off its pin, and the next normalize re-inserted
    // it at the new index, so the order drifted on every pass. The config
    // matrix caught that on every `+locked` combination.
    const { pedalsById, placed } = rig();
    const cfg = loopConfig('gate1', ['od1', 'od2']);
    const first = signalChainEngine.calculate(placed, pedalsById, noLoopContext, cfg);
    const second = signalChainEngine.calculate(first.orderedPedals, pedalsById, noLoopContext, cfg);
    expect(order(second)).toEqual(order(first));
  });

  it('leaves a PINNED hub where the user put it', () => {
    // An explicit placement outranks this rule.
    const { pedalsById, placed } = rig();
    const pinned = placed.map((p) =>
      p.id === 'gate1' ? { ...p, chainPositionLocked: true, chainPosition: 5 } : p);
    const r = signalChainEngine.calculate(pinned, pedalsById, noLoopContext,
      loopConfig('gate1', ['od1', 'od2']));
    const ids = order(r);
    expect(ids.indexOf('gate1')).toBeGreaterThan(ids.indexOf('od2'));
  });
});

/**
 * Ties in the category sort used to be decided by the INPUT ARRAY ORDER.
 *
 * `applyDefaultOrdering` compared `defaultChainPosition ?? categoryDefault`
 * and returned that difference alone, so two pedals of the same category
 * compared equal and `Array.prototype.sort` - stable - left them in whatever
 * order the caller happened to pass. The caller is the editor loader, which
 * maps `configuration_pedals` straight out of a PostgREST embed with no
 * ORDER BY, and Postgres is free to return an updated row in a new place.
 *
 * So saving a board could change the chain order of the board you reopened,
 * without anyone touching it. Measured on the saved `test` board: permuting
 * ONLY the input array, with every other input identical, moved the count of
 * unroutable cables between 0, 2 and 8.
 *
 * It bit the one feature that exists to reorder ties: joint optimization
 * reorders within "swappable groups", which are by definition consecutive
 * pedals of the SAME CATEGORY - exactly the pedals whose sort keys tie. The
 * optimizer's chain order was written to the database and then discarded by
 * the next load.
 *
 * The tie-break is the stored chainPosition, so the order the user (or the
 * optimizer) last saved is what survives, with the id as a final backstop so
 * the result is total.
 */
describe('ties are broken deterministically, not by input array order', () => {
  const permutations: Array<[string, (xs: PlacedPedal[]) => PlacedPedal[]]> = [
    ['as given', (xs) => xs],
    ['reversed', (xs) => [...xs].reverse()],
    ['by id', (xs) => [...xs].sort((a, b) => a.id.localeCompare(b.id))],
    ['rotated', (xs) => [...xs.slice(1), xs[0]]],
  ];

  it('returns one order for every input permutation of a tied group', () => {
    const orders = permutations.map(([, permute]) => {
      // Three EQs: same category, no defaultChainPosition - the sort key ties.
      const { pedalsById, placed } = setup([
        ['eqA', 'eq', 1],
        ['eqB', 'eq', 2],
        ['eqC', 'eq', 3],
      ]);
      const result = signalChainEngine.calculate(permute(placed), pedalsById, noLoopContext);
      return result.orderedPedals.map((p) => p.id);
    });

    for (const order of orders) expect(order).toEqual(orders[0]);
  });

  it('breaks the tie on the STORED chainPosition, preserving a saved order', () => {
    // What the optimizer saved: C, A, B. Fed in a different array order.
    const { pedalsById, placed } = setup([
      ['eqA', 'eq', 2],
      ['eqB', 'eq', 3],
      ['eqC', 'eq', 1],
    ]);

    const result = signalChainEngine.calculate([...placed].reverse(), pedalsById, noLoopContext);

    expect(result.orderedPedals.map((p) => p.id)).toEqual(['eqC', 'eqA', 'eqB']);
    expect(result.orderedPedals.map((p) => p.chainPosition)).toEqual([1, 2, 3]);
  });

  it('is idempotent - re-normalizing a normalized chain changes nothing', () => {
    const { pedalsById, placed } = setup([
      ['eqA', 'eq', 2],
      ['eqB', 'eq', 3],
      ['eqC', 'eq', 1],
    ]);

    const once = signalChainEngine.calculate(placed, pedalsById, noLoopContext).orderedPedals;
    const twice = signalChainEngine.calculate(once, pedalsById, noLoopContext).orderedPedals;

    expect(twice.map((p) => p.id)).toEqual(once.map((p) => p.id));
    expect(twice.map((p) => p.chainPosition)).toEqual(once.map((p) => p.chainPosition));
  });
});
