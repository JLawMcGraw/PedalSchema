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
    const { pedalsById, placed } = inLoop();
    const result = signalChainEngine.calculate(placed, pedalsById, loopContext);
    expect(result.orderedPedals.find((p) => p.id === 'chorus1')!.location).toBe('effects_loop');
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
