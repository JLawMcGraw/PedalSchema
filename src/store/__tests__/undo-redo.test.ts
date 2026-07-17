/**
 * Undo/redo history on the configuration store.
 *
 * Exercises the store directly (getState() actions) - snapshots must
 * capture every board-editing mutation, restore it exactly on undo,
 * reapply on redo, and drop the redo stack when a new edit forks history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigurationStore } from '../configuration-store';
import { makeBoard, makePedalSet, makeAmp } from '@/lib/engine/__tests__/support/fixtures';

function initStore() {
  const board = makeBoard('wide');
  const amp = makeAmp(true);
  const set = makePedalSet('trio');
  useConfigurationStore.getState().initConfiguration({
    id: 'config-undo-test',
    name: 'Undo Test',
    board,
    amp,
    placedPedals: set.placedPedals,
    pedalsById: set.pedalsById,
  });
  return { board, amp, set };
}

const store = () => useConfigurationStore.getState();

describe('undo/redo', () => {
  beforeEach(() => {
    initStore();
  });

  it('starts with empty history after init', () => {
    expect(store().history.past).toHaveLength(0);
    expect(store().history.future).toHaveLength(0);
  });

  it('undoes and redoes a pedal move exactly', () => {
    const target = store().placedPedals[0];
    const before = { x: target.xInches, y: target.yInches };

    store().movePedal(target.id, { x: 5, y: 3 });
    const moved = store().placedPedals.find((p) => p.id === target.id)!;
    expect({ x: moved.xInches, y: moved.yInches }).not.toEqual(before);

    store().undo();
    const undone = store().placedPedals.find((p) => p.id === target.id)!;
    expect({ x: undone.xInches, y: undone.yInches }).toEqual(before);

    store().redo();
    const redone = store().placedPedals.find((p) => p.id === target.id)!;
    expect({ x: redone.xInches, y: redone.yInches }).toEqual({ x: moved.xInches, y: moved.yInches });
  });

  it('treats a mutation plus its chain normalization as ONE undo step', () => {
    const before = store().placedPedals;
    const removed = before[1];

    store().removePedal(removed.id); // triggers normalizeChain internally
    expect(store().placedPedals).toHaveLength(before.length - 1);

    store().undo();
    expect(store().placedPedals).toHaveLength(before.length);
    expect(store().placedPedals.map((p) => p.id)).toContain(removed.id);
    // chain positions restored exactly, not re-derived
    expect(store().placedPedals.map((p) => [p.id, p.chainPosition])).toEqual(
      before.map((p) => [p.id, p.chainPosition])
    );
  });

  it('undoes flag toggles including their side effects', () => {
    store().setUse4CableMethod(true);
    expect(store().use4CableMethod).toBe(true);
    expect(store().useEffectsLoop).toBe(true); // side effect: 4CM forces loop on

    store().undo();
    expect(store().use4CableMethod).toBe(false);
    expect(store().useEffectsLoop).toBe(false);
  });

  it('undoes optimizeLayout as a single step', () => {
    const before = store().placedPedals.map((p) => [p.id, p.xInches, p.yInches]);
    store().optimizeLayout();
    store().undo();
    expect(store().placedPedals.map((p) => [p.id, p.xInches, p.yInches])).toEqual(before);
  });

  it('clears the redo stack when a new edit forks history', () => {
    const target = store().placedPedals[0];
    store().movePedal(target.id, { x: 5, y: 3 });
    store().undo();
    expect(store().history.future).toHaveLength(1);

    store().movePedal(target.id, { x: 2, y: 2 });
    expect(store().history.future).toHaveLength(0);
    store().redo(); // no-op
    const p = store().placedPedals.find((x) => x.id === target.id)!;
    expect({ x: p.xInches, y: p.yInches }).toEqual({ x: 2, y: 2 });
  });

  it('undo on empty history is a no-op', () => {
    const before = store().placedPedals;
    store().undo();
    expect(store().placedPedals).toBe(before);
  });

  it('caps history at 50 entries', () => {
    const target = store().placedPedals[0];
    for (let i = 0; i < 60; i++) {
      store().movePedal(target.id, { x: (i % 10) + 1, y: 1 });
    }
    expect(store().history.past.length).toBeLessThanOrEqual(50);
  });

  it('marks the configuration dirty after undo', () => {
    const target = store().placedPedals[0];
    store().movePedal(target.id, { x: 5, y: 3 });
    store().markClean();
    store().undo();
    expect(store().isDirty).toBe(true);
  });
});
