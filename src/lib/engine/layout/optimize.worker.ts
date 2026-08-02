/**
 * The layout optimizer, off the main thread.
 *
 * Optimize is the most expensive thing the app does: up to MAX_EVALUATIONS
 * (200) candidate arrangements, each one a full greedy placement plus an O(n^2)
 * collision check plus a complete cable route of every cable.
 *
 * Measured 2026-08-02 on the real saved boards: 20 pedals in ~130ms, 9 pedals
 * in ~37ms. This comment previously claimed "seconds of solid computation",
 * which was ~5x pessimistic - but the reason to stay off the main thread is
 * unchanged, because the tail is what hurts. A board whose pedals are all one
 * swappable category runs the full order search, and an over-subscribed board
 * spends far longer failing than a roomy one spends succeeding. Run inline,
 * any of that freezes the editor: no repaint, no scroll, no cancel.
 *
 * The engine is pure and imports nothing from React, Next or the DOM, so it
 * moves here unmodified.
 *
 * It must STAY that way, and that is not a matter of care. A Worker is built
 * as a CLIENT bundle, so bundlers fold `typeof window` to a literal inside it
 * and any such guard silently vanishes - see engine/debug-flag.ts, which
 * exists because that killed this worker once, and
 * __tests__/worker-safety.test.ts, which walks this file's import graph and
 * fails if it happens again.
 */

import { calculateOptimalLayoutJoint } from './index';
import type { OptimizeRequest, OptimizeResponse } from './optimize-request';

self.onmessage = (event: MessageEvent<OptimizeRequest>) => {
  const { requestId, placedPedals, pedalsById, board, routingConfig } = event.data;
  try {
    const result = calculateOptimalLayoutJoint(placedPedals, pedalsById, board, routingConfig);
    const response: OptimizeResponse = { requestId, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    // A worker that dies silently leaves the button spinning forever, so a
    // failure has to come back as a message like any other result.
    // Include the STACK. A worker failure arrives on the main thread as a
    // bare string, and "window is not defined" with no origin is not
    // actionable - the visible stack points at the onmessage handler that
    // rebuilt the Error, which is never where the fault is.
    const response: OptimizeResponse = {
      requestId,
      ok: false,
      error: error instanceof Error
        ? `${error.message}\n${error.stack ?? '(no stack)'}`
        : String(error),
    };
    self.postMessage(response);
  }
};
