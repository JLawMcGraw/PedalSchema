/**
 * Derived Board State
 *
 * SINGLE derivation point for everything computed from configuration source
 * state: cable topology, routed cable paths, collisions, and chain
 * warnings/suggestions.
 *
 * The store holds ONLY source-of-truth state; nothing here is stored or
 * manually kept in sync. `deriveBoardState` is memoized on the identity of
 * its inputs (immer produces new references only for changed slices), so
 * every subscriber shares one computation per state change and the derived
 * object is identity-stable - selectors can rely on `===`.
 */

import type {
  Board,
  Amp,
  Cable,
  Collision,
  ChainContext,
  ChainSuggestion,
  ChainWarning,
  Pedal,
  PlacedPedal,
  RoutingConfig,
} from '@/types';
import { useShallow } from 'zustand/react/shallow';
import { detectCollisions } from '@/lib/engine/collision';
import { signalChainEngine } from '@/lib/engine/signal-chain';
import { calculateCables } from '@/lib/engine/cables';
import { routeAllCables, type RoutedCable } from '@/lib/engine/cables/route-cables';
import { useConfigurationStore } from './configuration-store';

/** Editor canvas scale - pixels per inch at zoom 1 */
export const INCHES_TO_PIXELS = 40;

export interface DerivedBoardState {
  /** Cable topology (who connects to whom) */
  cables: Cable[];
  /** Routed cable paths in pixels (same order as cables) */
  routedCables: RoutedCable[];
  /** Pedal overlap collisions */
  collisions: Collision[];
  /** Signal chain warnings for the current order */
  warnings: ChainWarning[];
  /** Signal chain suggestions */
  suggestions: ChainSuggestion[];
}

/** The source slice everything is derived from */
export interface SourceSlice {
  id: string | null;
  board: Board | null;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  routingConfig: RoutingConfig;
}

const EMPTY: DerivedBoardState = {
  cables: [],
  routedCables: [],
  collisions: [],
  warnings: [],
  suggestions: [],
};

// Last-call memoization on input identities
let lastInputs: unknown[] | null = null;
let lastResult: DerivedBoardState = EMPTY;

export function deriveBoardState(s: SourceSlice): DerivedBoardState {
  const inputs = [
    s.id,
    s.board,
    s.amp,
    s.useEffectsLoop,
    s.use4CableMethod,
    s.modulationInLoop,
    s.placedPedals,
    s.pedalsById,
    s.routingConfig,
  ];

  if (lastInputs && inputs.length === lastInputs.length && inputs.every((v, i) => v === lastInputs![i])) {
    return lastResult;
  }

  let result: DerivedBoardState;

  if (!s.board || s.placedPedals.length === 0) {
    result = EMPTY;
  } else {
    const collisions = detectCollisions(s.placedPedals, s.pedalsById, s.board);

    const connections = calculateCables(
      s.placedPedals,
      s.pedalsById,
      s.board,
      s.amp,
      s.useEffectsLoop,
      s.routingConfig,
      s.use4CableMethod
    );

    const cables: Cable[] = connections.map((c, index) => ({
      id: `cable-${index}`,
      configurationId: s.id || '',
      fromType: c.fromType,
      fromPedalId: c.fromPedalId,
      fromJack: c.fromJackType,
      toType: c.toType,
      toPedalId: c.toPedalId,
      toJack: c.toJackType,
      calculatedLengthInches: c.calculatedLengthInches,
      cableType: c.cableType,
      sortOrder: c.sortOrder,
      createdAt: '',
    }));

    const fxLoopActive = s.useEffectsLoop && !!s.amp?.hasEffectsLoop;
    const routedCables = routeAllCables(
      cables,
      s.placedPedals,
      s.pedalsById,
      s.board,
      INCHES_TO_PIXELS,
      fxLoopActive
    );

    const context: ChainContext = {
      ampHasEffectsLoop: s.amp?.hasEffectsLoop || false,
      useEffectsLoop: s.useEffectsLoop,
      use4CableMethod: s.use4CableMethod,
      modulationInLoop: s.modulationInLoop,
      loopType: s.amp?.loopType,
    };
    const { warnings, suggestions } = signalChainEngine.analyze(s.placedPedals, s.pedalsById, context);

    result = { cables, routedCables, collisions, warnings, suggestions };
  }

  lastInputs = inputs;
  lastResult = result;
  return result;
}

/**
 * Subscribe to a slice of derived state.
 *
 * const { collisions } = useDerivedConfiguration((d) => ({ collisions: d.collisions }));
 *
 * Re-renders only when the selected slice changes (shallow-compared; the
 * underlying derived values are identity-stable per state version).
 */
export function useDerivedConfiguration<T>(selector: (d: DerivedBoardState) => T): T {
  return useConfigurationStore(useShallow((s) => selector(deriveBoardState(s))));
}

// Debug helpers: extract source + derived state from the browser console.
// Companion to window.__loadPedalSchemaRepro (configuration-store.ts).
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __getPedalSchemaState: () => SourceSlice;
    __getPedalSchemaDerived: () => DerivedBoardState;
  };
  w.__getPedalSchemaState = () => {
    const s = useConfigurationStore.getState();
    return {
      id: s.id,
      board: s.board,
      amp: s.amp,
      useEffectsLoop: s.useEffectsLoop,
      use4CableMethod: s.use4CableMethod,
      modulationInLoop: s.modulationInLoop,
      placedPedals: s.placedPedals,
      pedalsById: s.pedalsById,
      routingConfig: s.routingConfig,
    };
  };
  w.__getPedalSchemaDerived = () => deriveBoardState(useConfigurationStore.getState());
}
