/**
 * The per-board rotation lock, exercised through the store the editor uses.
 *
 * The lock is the replacement for a width VETO that refused to turn any large
 * pedal. The veto was wrong because it excluded precisely the pedals rotation
 * helps - manufacturers put jacks on the top edge when a pedal is wide enough
 * to have room there - so a size test survives here only as a DEFAULT the
 * owner can overrule per pedal, and at a HIGHER threshold than the veto used.
 *
 * Both halves of that need pinning, because getting either wrong rebuilds the
 * veto: a big pedal must arrive locked, a 200-series must NOT, and unlocking
 * must genuinely release the pedal to the optimizer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigurationStore } from '../configuration-store';
import { makeBoard, makePedalSet, makeAmp } from '@/lib/engine/__tests__/support/fixtures';
import { canOptimizerRotate } from '@/lib/engine/layout/rotation-eligibility';
import type { Pedal } from '@/types';

const store = () => useConfigurationStore.getState();

/** Top jacks throughout - these pedals are only interesting if turnable. */
const topJackPedal = (over: Partial<Pedal>): Pedal =>
  ({
    manufacturer: 'BOSS', heightInches: 2.6, preferredLocation: 'front_of_amp',
    jacks: [
      { id: 'j0', pedalId: over.id, jackType: 'input', side: 'top', positionPercent: 75, label: 'IN' },
      { id: 'j1', pedalId: over.id, jackType: 'output', side: 'top', positionPercent: 25, label: 'OUT' },
    ],
    ...over,
  }) as Pedal;

/** Strymon BigSky at its real 6.5 x 5.1in: big enough to lock by default. */
const bigPedal = () =>
  topJackPedal({ id: 'bigsky', name: 'BigSky', category: 'reverb', widthInches: 6.5, depthInches: 5.1 });

/**
 * EQ-200 at its real 3.98 x 5.43in. Bigger than a compact but NOT locked by
 * default - the regression guard for the rework. The old 3.5in threshold
 * locked this, and locking it locked all seven turnable pedals in the
 * catalogue, which is the width veto restored as a default.
 */
const midPedal = () =>
  topJackPedal({ id: 'eq200', name: 'EQ-200', category: 'eq', widthInches: 3.98, depthInches: 5.43 });

function initStore() {
  const set = makePedalSet('trio');
  store().initConfiguration({
    id: 'config-rotation-lock',
    name: 'Rotation Lock Test',
    board: makeBoard('wide'),
    amp: makeAmp(true),
    placedPedals: set.placedPedals,
    pedalsById: set.pedalsById,
  });
}

const added = (pedalId: string) => store().placedPedals.find((p) => p.pedalId === pedalId)!;

describe('rotation lock', () => {
  beforeEach(() => initStore());

  it('locks a genuinely big pedal on the way in, and leaves a 200-series alone', () => {
    store().addPedal(bigPedal(), { x: 1, y: 1 });
    store().addPedal(midPedal(), { x: 8, y: 1 });

    expect(added('bigsky').rotationLocked).toBe(true);
    expect(added('eq200').rotationLocked).toBe(false);
    // The one that matters: a pedal that CAN gain from turning arrives free to
    // do it, so the feature is live on a fresh board rather than opt-in.
    expect(canOptimizerRotate(midPedal(), added('eq200'))).toBe(true);
  });

  it('a defaulted lock actually stops the optimizer, and unlocking releases it', () => {
    // The default is only worth anything if the engine reads it, so assert
    // through canOptimizerRotate rather than the flag alone.
    store().addPedal(bigPedal(), { x: 1, y: 1 });

    expect(canOptimizerRotate(bigPedal(), added('bigsky'))).toBe(false);

    store().setRotationLocked(added('bigsky').id, false);
    expect(added('bigsky').rotationLocked).toBe(false);
    // ...and the pedal is genuinely eligible now - the lock was the only thing
    // refusing it, size notwithstanding. Size is a default, never a veto.
    expect(canOptimizerRotate(bigPedal(), added('bigsky'))).toBe(true);
  });

  it('marks the config dirty and is undoable', () => {
    store().addPedal(bigPedal(), { x: 1, y: 1 });
    const id = added('bigsky').id;
    store().markClean();

    store().setRotationLocked(id, false);
    expect(store().isDirty).toBe(true);
    expect(added('bigsky').rotationLocked).toBe(false);

    store().undo();
    expect(added('bigsky').rotationLocked).toBe(true);

    store().redo();
    expect(added('bigsky').rotationLocked).toBe(false);
  });
});
