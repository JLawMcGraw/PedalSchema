import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredJointOptimizationResult } from '@/lib/engine/layout';
import { makeAmp, makeBoard, makePedalSet } from '@/lib/engine/__tests__/support/fixtures';

const optimizer = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/engine/layout/run-optimize', () => ({ runOptimize: optimizer.run }));

import { useConfigurationStore } from '../configuration-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function init() {
  const set = makePedalSet('trio');
  useConfigurationStore.getState().initConfiguration({
    id: 'config-optimize-race', name: 'Race', board: makeBoard('wide'),
    amp: makeAmp(true), placedPedals: set.placedPedals, pedalsById: set.pedalsById,
  });
}

function resultAt(x: number): ScoredJointOptimizationResult {
  const pedals = useConfigurationStore.getState().placedPedals;
  return {
    placements: pedals.map((p) => ({ id: p.id, x, y: p.yInches })),
    chainOrder: pedals.map((p) => p.id),
    swappableGroups: [],
  };
}

describe('optimizer concurrency', () => {
  beforeEach(() => {
    optimizer.run.mockReset();
    init();
  });

  it('discards a result after any persisted edit without adding phantom history', async () => {
    const run = deferred<ScoredJointOptimizationResult>();
    optimizer.run.mockReturnValueOnce(run.promise);
    const pending = useConfigurationStore.getState().optimizeLayout();

    const target = useConfigurationStore.getState().placedPedals[0];
    useConfigurationStore.getState().movePedal(target.id, { x: 4, y: 2 });
    const movedX = useConfigurationStore.getState().placedPedals[0].xInches;
    expect(useConfigurationStore.getState().history.past).toHaveLength(1);

    run.resolve(resultAt(9));
    await pending;

    expect(useConfigurationStore.getState().placedPedals[0].xInches).toBe(movedX);
    expect(useConfigurationStore.getState().history.past).toHaveLength(1);
  });

  it('adds no history entry when optimization fails', async () => {
    optimizer.run.mockRejectedValueOnce(new Error('worker failed'));
    await useConfigurationStore.getState().optimizeLayout();
    expect(useConfigurationStore.getState().history.past).toHaveLength(0);
    expect(useConfigurationStore.getState().isOptimizing).toBe(false);
  });

  it('cannot apply an old board result after configuration reinitialization', async () => {
    const run = deferred<ScoredJointOptimizationResult>();
    optimizer.run.mockReturnValueOnce(run.promise);
    const pending = useConfigurationStore.getState().optimizeLayout();

    const replacement = makePedalSet('seven');
    useConfigurationStore.getState().initConfiguration({
      id: 'replacement-board', name: 'Replacement', board: makeBoard('mini'),
      placedPedals: replacement.placedPedals, pedalsById: replacement.pedalsById,
    });
    const replacementIds = useConfigurationStore.getState().placedPedals.map((p) => p.id);

    run.resolve({
      placements: [], chainOrder: [], swappableGroups: [],
    });
    await pending;

    expect(useConfigurationStore.getState().id).toBe('replacement-board');
    expect(useConfigurationStore.getState().placedPedals.map((p) => p.id)).toEqual(replacementIds);
    expect(useConfigurationStore.getState().history.past).toHaveLength(0);
    expect(useConfigurationStore.getState().isOptimizing).toBe(false);
  });
});
