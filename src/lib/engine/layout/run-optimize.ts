/**
 * Run the optimizer, preferring a worker and falling back to running it inline.
 *
 * The fallback is not a nicety. The engine has to stay directly callable:
 * every existing test calls calculateOptimalLayoutJoint synchronously, and
 * nothing about correctness may depend on a Worker existing. So this module
 * only decides WHERE the same function runs.
 */

import { calculateOptimalLayoutJoint, type ScoredJointOptimizationResult } from './index';
import type { OptimizeRequest, OptimizeResponse } from './optimize-request';

type Input = Omit<OptimizeRequest, 'requestId'>;

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

/** Pending runs by request id, so out-of-order or stale replies can be matched up. */
const pending = new Map<
  number,
  { resolve: (r: ScoredJointOptimizationResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    workerUnavailable = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./optimize.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<OptimizeResponse>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return; // superseded and already dropped
      pending.delete(event.data.requestId);
      if (event.data.ok) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      // The worker itself failed - fail every run waiting on it and go inline
      // from here, rather than leaving callers hanging.
      const message = event.message || 'optimizer worker failed';
      for (const [, entry] of pending) entry.reject(new Error(message));
      pending.clear();
      worker?.terminate();
      worker = null;
      workerUnavailable = true;
    };
    return worker;
  } catch {
    // Bundlers that cannot build the worker, or environments that forbid it
    workerUnavailable = true;
    return null;
  }
}

/**
 * Optimize `input`, off the main thread where possible.
 *
 * Resolves with the same result the synchronous call would produce - this is a
 * change of thread, never of behaviour.
 */
export async function runOptimize(input: Input): Promise<ScoredJointOptimizationResult> {
  const w = getWorker();
  if (!w) {
    return calculateOptimalLayoutJoint(
      input.placedPedals, input.pedalsById, input.board, input.routingConfig
    );
  }

  const requestId = nextRequestId++;
  return new Promise<ScoredJointOptimizationResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage({ requestId, ...input } satisfies OptimizeRequest);
  }).catch((error) => {
    // One failed run should not cost the user the feature: fall back inline.
    console.warn('[optimize] worker failed, running inline:', error);
    return calculateOptimalLayoutJoint(
      input.placedPedals, input.pedalsById, input.board, input.routingConfig
    );
  });
}

/** Stop caring about a run whose result is no longer wanted. */
export function abandonOptimize(requestId: number): void {
  pending.delete(requestId);
}
