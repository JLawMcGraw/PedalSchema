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
  PowerSupply,
} from '@/types';
import { useShallow } from 'zustand/react/shallow';
import { detectCollisions } from '@/lib/engine/collision';
import { signalChainEngine } from '@/lib/engine/signal-chain';
import { calculateCables } from '@/lib/engine/cables';
import { routeAllCables, type RoutedCable } from '@/lib/engine/cables/route-cables';
import { derivePowerSummary, derivePowerPlan, describePowerPlan, type PowerSummary, type SupplyPlan } from '@/lib/engine/power';
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
  /**
   * What the board asks of a power supply. Derived like everything else here,
   * and deliberately reports its KNOWN total separately from the pedals it
   * could not account for - see src/lib/engine/power.
   */
  power: PowerSummary;
  /**
   * How this board lays over the chosen supply's outputs, or null when no
   * supply is chosen - which is the normal state and means demand-only
   * reporting, exactly as it worked before supplies existed.
   */
  powerPlan: SupplyPlan | null;
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
  /** The supply this board is planned against, if any. */
  powerSupply?: PowerSupply | null;
}

const EMPTY: DerivedBoardState = {
  cables: [],
  routedCables: [],
  collisions: [],
  warnings: [],
  suggestions: [],
  power: { knownTotalMa: 0, unknown: [], pedalCount: 0, highDraw: [], byVoltage: [] },
  powerPlan: null,
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
    s.powerSupply,
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

    result = {
      cables, routedCables, collisions, warnings, suggestions,
      power: derivePowerSummary(s.placedPedals, s.pedalsById),
      powerPlan: s.powerSupply
        ? derivePowerPlan(s.placedPedals, s.pedalsById, s.powerSupply)
        : null,
    };
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

/**
 * The machine-readable twin of the editor: everything a verification script
 * needs about the current board, read from the SAME derived state the canvas
 * renders. Scripts must not recompute geometry - if this and the canvas ever
 * disagree, the twin is worthless.
 *
 * Board coordinates are inches; cable paths are pixels at INCHES_TO_PIXELS.
 * Screen positions are deliberately absent: they belong to the DOM, and
 * .claude/scripts/lib/twin.js derives them from [data-pedal-canvas].
 */
export interface PedalSchemaSnapshot {
  scale: number;
  board: Board | null;
  pedals: Array<{
    id: string;
    pedalId: string;
    name: string;
    xInches: number;
    yInches: number;
    widthInches: number;
    depthInches: number;
    rotationDegrees: number;
    chainPosition: number;
  }>;
  cables: Array<{
    from: string;
    to: string;
    /** Which router produced the path - see RoutedCable.strategy */
    strategy: string;
    valid: boolean;
    points: Array<{ x: number; y: number }>;
  }>;
  collisionCount: number;
  warningCount: number;
  /** Summary of the last optimizeLayout(), or null if none this session */
  lastOptimization: unknown;
  /** Unsaved work, and why the last save failed - null when it did not */
  isDirty: boolean;
  saveError: string | null;
}

// Debug helpers: extract source + derived state from the browser console.
// Companion to window.__loadPedalSchemaRepro (configuration-store.ts).
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __getPedalSchemaState: () => SourceSlice;
    __getPedalSchemaDerived: () => DerivedBoardState;
    __getPedalSchemaSnapshot: () => PedalSchemaSnapshot;
    __pedalSchemaSetSupply: (nameFragment: string) => { name: string; outputs: number } | null;
    __pedalSchemaAssignAll: (outputIndex: number) => Record<string, unknown>;
    __pedalSchemaAssignSpread: () => Record<string, unknown>;
    __pedalSchemaProbeUnknownOnOutput: () => Record<string, unknown>;
    __pedalSchemaOptimize: () => Promise<void>;
    __pedalSchemaSetLoop: (hubId: string, memberIds: string[]) => void;
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
      // Part of SourceSlice since supplies landed. Omitting it made the twin
      // disagree with what deriveBoardState actually reads.
      powerSupply: s.powerSupply,
    };
  };
  w.__getPedalSchemaDerived = () => deriveBoardState(useConfigurationStore.getState());

  // Optimize is asynchronous now (it runs in a worker), so a verification
  // script cannot tell when it finished by waiting a fixed time. Hand back the
  // promise so a measurement can bracket exactly the run and nothing else.
  w.__pedalSchemaOptimize = () => useConfigurationStore.getState().optimizeLayout();

  // Configure a pedal loop the way the Routing panel does, so a verification
  // script can exercise persistence without driving that panel's markup.
  w.__pedalSchemaSetLoop = (hubId: string, memberIds: string[]) =>
    useConfigurationStore.getState().setPedalRoutingMode(hubId, 'loop', memberIds);

  /**
   * Supply-side probes. The Power tab's supply half cannot be driven from a
   * verification script through markup alone - it needs a supply chosen and
   * pedals assigned - and the ONE case that matters most (a pedal with no
   * recorded draw sitting on an output) is unreachable by clicking, because
   * the only catalogue pedal without a draw is on nobody's board.
   */
  w.__pedalSchemaSetSupply = (nameFragment: string) => {
    const st = useConfigurationStore.getState();
    const supply = st.powerSupplies.find((s2) =>
      s2.name.toLowerCase().includes(nameFragment.toLowerCase())
    );
    if (!supply) return null;
    st.setPowerSupply(supply);
    return { name: supply.name, outputs: supply.outputs.length };
  };

  const planOf = (outputIndex = 0) => {
    const st = useConfigurationStore.getState();
    const d = deriveBoardState(st);
    const load = d.powerPlan?.outputs[outputIndex];
    return {
      headline: d.powerPlan ? describePowerPlan(d.powerPlan) : '(no supply)',
      overCapacityCount: d.powerPlan?.overCapacityCount ?? 0,
      knownDrawMa: load?.knownDrawMa ?? 0,
      effectiveRatedMa: load?.effectiveRatedMa ?? 0,
      headroomMa: load?.headroomMa ?? null,
      unknownCount: load?.unknownCount ?? 0,
    };
  };

  w.__pedalSchemaAssignAll = (outputIndex: number) => {
    const st = useConfigurationStore.getState();
    const output = st.powerSupply?.outputs[outputIndex];
    if (output) {
      for (const p of st.placedPedals) {
        useConfigurationStore.getState().assignPedalToOutput(p.id, output.id);
      }
    }
    return planOf(outputIndex);
  };

  w.__pedalSchemaAssignSpread = () => {
    const st = useConfigurationStore.getState();
    const outs = st.powerSupply?.outputs ?? [];
    st.placedPedals.forEach((p, i) => {
      const o = outs[i % outs.length];
      if (o) useConfigurationStore.getState().assignPedalToOutput(p.id, o.id);
    });
    return planOf(0);
  };

  /**
   * Put a pedal with NO recorded draw onto an otherwise comfortable output.
   * Not saved - the catalogue pedal is swapped in memory only.
   */
  w.__pedalSchemaProbeUnknownOnOutput = () => {
    const st = useConfigurationStore.getState();
    const outs = st.powerSupply?.outputs ?? [];
    const target = outs[0];
    const victim = st.placedPedals[0];
    if (!target || !victim) return planOf(0);

    useConfigurationStore.setState((state) => {
      const pedal = state.pedalsById[victim.pedalId];
      if (pedal) state.pedalsById = { ...state.pedalsById, [victim.pedalId]: { ...pedal, currentMa: null } };
    });
    useConfigurationStore.getState().assignPedalToOutput(victim.id, target.id);
    return planOf(0);
  };

  w.__getPedalSchemaSnapshot = () => {
    const s = useConfigurationStore.getState();
    const d = deriveBoardState(s);
    const label = (type: string, pedalId: string | null | undefined) =>
      pedalId ? `${type}:${pedalId}` : type;

    return {
      scale: INCHES_TO_PIXELS,
      board: s.board,
      pedals: s.placedPedals.map((p) => {
        const pedal = s.pedalsById[p.pedalId] || p.pedal;
        return {
          id: p.id,
          pedalId: p.pedalId,
          name: pedal?.name ?? '(unknown)',
          xInches: p.xInches,
          yInches: p.yInches,
          widthInches: pedal?.widthInches ?? 0,
          depthInches: pedal?.depthInches ?? 0,
          rotationDegrees: p.rotationDegrees,
          chainPosition: p.chainPosition,
        };
      }),
      cables: d.routedCables.map((rc) => ({
        from: label(rc.cable.fromType, rc.cable.fromPedalId),
        to: label(rc.cable.toType, rc.cable.toPedalId),
        strategy: rc.strategy,
        valid: rc.valid,
        points: rc.path.map((pt) => ({ x: pt.x, y: pt.y })),
      })),
      collisionCount: d.collisions.length,
      warningCount: d.warnings.length,
      lastOptimization: s.lastOptimization,
      isDirty: s.isDirty,
      saveError: s.saveError,
    };
  };
}
