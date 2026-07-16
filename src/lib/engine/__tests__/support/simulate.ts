/**
 * simulateConfiguration - replicate the app's full pipeline as pure
 * functions, exactly as the store + derived state run it:
 *
 *   normalize chain -> optimize layout -> derive (cables, routes, collisions)
 *
 * Used by the configuration matrix so every scenario is tested end-to-end
 * through the same code paths the editor uses.
 */

import type { Amp, Board, Pedal, PlacedPedal, ChainContext, RoutingConfig } from '@/types';
import { signalChainEngine } from '../../signal-chain';
import { calculateOptimalLayoutJoint } from '../../layout';
import { deriveBoardState, type DerivedBoardState } from '@/store/derived';

export interface ScenarioFlags {
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  /** Enable the NS-2 style pedal's own send/return loop */
  ns2UseLoop: boolean;
  /** Pin two mid-chain pedals via chainPositionLocked */
  withLockedPedals: boolean;
}

export interface Scenario {
  label: string;
  board: Board;
  amp: Amp;
  pedalsById: Record<string, Pedal>;
  placedPedals: PlacedPedal[];
  flags: ScenarioFlags;
}

export interface SimulationResult {
  /** Pedals after chain normalization + layout optimization */
  pedals: PlacedPedal[];
  derived: DerivedBoardState;
}

export function simulateConfiguration(scenario: Scenario): SimulationResult {
  const { board, amp, pedalsById, flags } = scenario;

  // Scenario knobs (ns2UseLoop, locked pedals) are applied by the scenario
  // BUILDER, not here - this function must be a pure pipeline so running it
  // on its own output tests idempotence.
  let pedals = scenario.placedPedals.map((p) => ({ ...p }));

  const context: ChainContext = {
    ampHasEffectsLoop: amp.hasEffectsLoop,
    useEffectsLoop: flags.useEffectsLoop,
    use4CableMethod: flags.use4CableMethod,
    modulationInLoop: flags.modulationInLoop,
    loopType: amp.loopType,
  };

  const routingConfig: RoutingConfig = {
    useLoopPedals: true,
    use4CableMethod: flags.use4CableMethod,
    useEffectsLoop: flags.useEffectsLoop,
    pedalConfigs: [],
  };

  // 1. Normalize chain (store.normalizeChain)
  const normalized = signalChainEngine.calculate(pedals, pedalsById, context);
  pedals = normalized.orderedPedals;

  // 2. Optimize layout (store.optimizeLayout)
  const layout = calculateOptimalLayoutJoint(pedals, pedalsById, board, routingConfig);
  const placementById = new Map(layout.placements.map((p) => [p.id, p]));
  pedals = pedals.map((p) => {
    const placement = placementById.get(p.id);
    return placement ? { ...p, xInches: placement.x, yInches: placement.y } : p;
  });
  if (layout.swappableGroups.length > 0) {
    const orderIndex = new Map(layout.chainOrder.map((id, i) => [id, i + 1]));
    pedals = pedals.map((p) => ({
      ...p,
      chainPosition: orderIndex.get(p.id) ?? p.chainPosition,
    }));
  }

  // 3. Derive cables, routes, collisions (src/store/derived.ts)
  const derived = deriveBoardState({
    id: 'config-test',
    board,
    amp,
    useEffectsLoop: flags.useEffectsLoop,
    use4CableMethod: flags.use4CableMethod,
    modulationInLoop: flags.modulationInLoop,
    placedPedals: pedals,
    pedalsById,
    routingConfig,
  });

  return { pedals, derived };
}
