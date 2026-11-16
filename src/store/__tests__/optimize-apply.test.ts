/**
 * What pressing Optimize does to the STORE, as opposed to the board.
 *
 * Two things the engine cannot see, because they happen where its result is
 * handed over:
 *
 * A PRESS THAT MOVES NOTHING IS NOT AN EDIT. Optimize often changes nothing -
 * the board is already the best the search can find. The result was applied
 * anyway: an undo entry for a step that undoes nothing, the redo stack thrown
 * away, and a saved board marked unsaved. Measured on 2026-11-16 on a saved,
 * already-optimal board: undo entries 1 -> 2, isDirty false -> true, pedal
 * state byte-identical - with "Already optimal - nothing moved" on screen
 * beside a lit Save button.
 *
 * THE OPTIMIZER PLANS FOR THE LOOP THE CANVAS DRAWS. The canvas treats the
 * effects loop as on only when the flag is set AND the amp has one. The
 * optimizer was handed the bare flag. setAmp keeps the two in step, but
 * loading a board does not check, so a saved row can say "loop on" against an
 * amp without one - and then Optimize scored the amp input at the jack
 * position the loop uses while the canvas drew it at the other.
 *
 * The real optimizer runs here: there is no Worker in node, so runOptimize
 * falls back to calling the engine inline. Both blocks were run against the
 * old store first.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeAmp, makeBoard, makePedalSet } from '@/lib/engine/__tests__/support/fixtures';
import { calculateRoutingCost } from '@/lib/engine/layout/routing-cost';
import { useConfigurationStore } from '../configuration-store';
import { deriveBoardState } from '../derived';

const store = () => useConfigurationStore.getState();

const boardState = () =>
  JSON.stringify(
    store().placedPedals
      .map((p) => [p.id, p.xInches, p.yInches, p.rotationDegrees, p.chainPosition])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );

beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { vi.restoreAllMocks(); });

describe('an Optimize that moves nothing is not an edit', () => {
  beforeEach(async () => {
    const set = makePedalSet('seven');
    store().initConfiguration({
      id: 'optimize-apply', name: 'Optimize apply', board: makeBoard('wide'), amp: makeAmp(true),
      placedPedals: set.placedPedals, pedalsById: set.pedalsById,
    });
    store().normalizeChain();
    // The first press does move things: every pedal starts at the origin.
    await store().optimizeLayout();
  });

  it('the first press is a real edit: one undo entry, and unsaved', () => {
    expect(store().history.past).toHaveLength(1);
    expect(store().isDirty).toBe(true);
  });

  it('a second press on the saved board leaves it saved, with nothing new to undo', async () => {
    store().markSaved(store().mutationVersion, 2);
    expect(store().isDirty).toBe(false);
    const before = boardState();
    const mutationVersion = store().mutationVersion;

    await store().optimizeLayout();

    // The precondition: it really did change nothing.
    expect(boardState()).toBe(before);

    expect(store().history.past).toHaveLength(1);
    expect(store().isDirty).toBe(false);
    expect(store().mutationVersion).toBe(mutationVersion);
  });

  it('still says what it found', async () => {
    store().dismissOptimizationSummary();
    expect(store().lastOptimization).toBeNull();

    await store().optimizeLayout();

    expect(store().lastOptimization?.headline).toBe('Already optimal - nothing moved.');
  });

  it('keeps the redo stack', async () => {
    // Make an edit on top of the optimized board, then undo it: the board is
    // the optimized one again, with that edit waiting to be redone.
    const target = store().placedPedals[0];
    store().movePedal(target.id, { x: target.xInches + 0.5, y: target.yInches });
    store().undo();
    expect(store().history.future).toHaveLength(1);

    await store().optimizeLayout();

    expect(store().history.future).toHaveLength(1);
  });
});

describe('the optimizer plans for the loop the canvas draws', () => {
  it('scores what is drawn when the loop flag is set against an amp with no loop', async () => {
    const set = makePedalSet('seven');
    // The state a saved row can arrive in: flag on, amp has no loop.
    store().initConfiguration({
      id: 'loop-flag', name: 'Loop flag', board: makeBoard('wide'), amp: makeAmp(false),
      useEffectsLoop: true,
      placedPedals: set.placedPedals, pedalsById: set.pedalsById,
    });
    expect(store().useEffectsLoop).toBe(true);
    expect(store().amp?.hasEffectsLoop).toBe(false);

    store().normalizeChain();
    await store().optimizeLayout();

    // What the canvas draws for this state: no loop.
    const { placedPedals, pedalsById, board, routingConfig, use4CableMethod } = store();
    const asDrawn = calculateRoutingCost(
      placedPedals.map((p) => ({ id: p.id, x: p.xInches, y: p.yInches })),
      placedPedals, pedalsById, board!, undefined,
      false, use4CableMethod, { ...routingConfig, useEffectsLoop: false, use4CableMethod }
    );
    expect(asDrawn.totalLengthInches).toBeCloseTo(deriveBoardState(store()).cableLengthInches, 6);

    // And that is the board the optimizer reported choosing.
    expect(store().lastOptimization).not.toBeNull();
    expect(store().lastOptimization!.after).toBeCloseTo(asDrawn.totalScore, 6);
  });
});
