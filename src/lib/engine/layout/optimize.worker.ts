/**
 * The layout optimizer, off the main thread.
 *
 * Optimize is the most expensive thing the app does: up to MAX_EVALUATIONS
 * (200) candidate arrangements, each one a full greedy placement plus an O(n^2)
 * collision check plus a complete cable route of every cable. On a 20-pedal
 * board that is seconds of solid computation, and run inline it freezes the
 * editor - no repaint, no scroll, no cancel.
 *
 * The engine is pure and imports nothing from React, Next or the DOM, so it
 * moves here unmodified. Both of its browser touches are `typeof window`
 * guards that simply read false in a worker.
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
    const response: OptimizeResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
