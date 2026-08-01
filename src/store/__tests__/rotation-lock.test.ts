/**
 * The per-board rotation lock, exercised through the store the editor uses.
 *
 * The lock is the replacement for a width VETO that refused to turn any large
 * pedal. The veto was wrong because it excluded precisely the pedals rotation
 * helps - manufacturers put jacks on the top edge when a pedal is wide enough
 * to have room there - so the same size threshold survives here only as a
 * DEFAULT the owner can overrule per pedal. These tests pin that distinction:
 * a large pedal arrives locked, and unlocking it actually works.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigurationStore } from '../configuration-store';
import { makeBoard, makePedalSet, makeAmp } from '@/lib/engine/__tests__/support/fixtures';
import { canOptimizerRotate } from '@/lib/engine/layout/rotation-eligibility';
import type { Pedal } from '@/types';

const store = () => useConfigurationStore.getState();

/** EQ-200 at its real dimensions: top jacks, and "large" by the threshold. */
const largePedal = (over: Partial<Pedal> = {}): Pedal =>
  ({
    id: 'eq200', name: 'EQ-200', manufacturer: 'BOSS', category: 'eq',
    widthInches: 3.98, depthInches: 5.43, heightInches: 2.6,
    preferredLocation: 'front_of_amp',
    jacks: [
      { id: 'j0', pedalId: 'eq200', jackType: 'input', side: 'top', positionPercent: 75, label: 'IN' },
      { id: 'j1', pedalId: 'eq200', jackType: 'output', side: 'top', positionPercent: 25, label: 'OUT' },
    ],
    ...over,
  }) as Pedal;

/** A BOSS compact: the case the threshold must leave alone. */
const compactPedal = () =>
  largePedal({ id: 'ds1', name: 'DS-1', category: 'overdrive', widthInches: 2.87, depthInches: 5.08 });

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

  it('locks a large pedal on the way in, and leaves a compact unlocked', () => {
    store().addPedal(largePedal(), { x: 1, y: 1 });
    store().addPedal(compactPedal(), { x: 8, y: 1 });

    expect(added('eq200').rotationLocked).toBe(true);
    expect(added('ds1').rotationLocked).toBe(false);
  });

  it('a defaulted lock actually stops the optimizer, and unlocking releases it', () => {
    // The default is only worth anything if the engine reads it, so assert
    // through canOptimizerRotate rather than the flag alone.
    store().addPedal(largePedal(), { x: 1, y: 1 });
    const pedal = largePedal();

    expect(canOptimizerRotate(pedal, added('eq200'))).toBe(false);

    store().setRotationLocked(added('eq200').id, false);
    expect(added('eq200').rotationLocked).toBe(false);
    // ...and the pedal is genuinely eligible now - the lock was the only thing
    // refusing it, size notwithstanding.
    expect(canOptimizerRotate(pedal, added('eq200'))).toBe(true);
  });

  it('marks the config dirty and is undoable', () => {
    store().addPedal(largePedal(), { x: 1, y: 1 });
    const id = added('eq200').id;
    store().markClean();

    store().setRotationLocked(id, false);
    expect(store().isDirty).toBe(true);
    expect(added('eq200').rotationLocked).toBe(false);

    store().undo();
    expect(added('eq200').rotationLocked).toBe(true);

    store().redo();
    expect(added('eq200').rotationLocked).toBe(false);
  });
});
