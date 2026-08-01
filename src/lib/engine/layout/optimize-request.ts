/**
 * The message contract between the store and the optimizer worker.
 *
 * Kept in its own module so the worker and its caller share one definition and
 * neither imports the other. Every field is plain data: PlacedPedal, Pedal,
 * Board and RoutingConfig contain no functions or class instances, so the whole
 * request survives structured cloning unchanged.
 */

import type { Board, Pedal, PlacedPedal, RoutingConfig } from '@/types';
import type { ScoredJointOptimizationResult } from './index';

export interface OptimizeRequest {
  /** Identifies the run, so a result that arrives after the board moved on can be dropped. */
  requestId: number;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  board: Board;
  routingConfig: RoutingConfig;
}

export type OptimizeResponse =
  | { requestId: number; ok: true; result: ScoredJointOptimizationResult }
  | { requestId: number; ok: false; error: string };
