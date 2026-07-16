/**
 * Signal Topology - SINGLE SOURCE OF TRUTH for signal flow.
 *
 * Every routing mode (standard chain, amp effects loop, NS-2 style pedal
 * loops, the 4-cable method) is expressed uniformly as ordered SEGMENTS:
 * a run of pedals between two ANCHORS (guitar, an amp jack, or a specific
 * jack on a hub pedal).
 *
 * Consumers:
 * - calculateCables: walks segments to emit cable connections
 * - routing-cost: walks segments to score candidate placements
 * - the placement planner: places segment-by-segment (primary chain,
 *   amp-anchored clusters, hub-anchored clusters)
 *
 * This replaces three divergent re-derivations of the same flow (cable
 * generation, cost function, and location-based placement zones).
 */

import type { Amp, Pedal, PlacedPedal, RoutingConfig } from '@/types';
import { findJack } from '../cables/endpoints';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExternalAnchorType = 'guitar' | 'amp_input' | 'amp_send' | 'amp_return';

export type Anchor =
  | { kind: 'external'; type: ExternalAnchorType }
  | { kind: 'pedal'; pedalId: string; jack: 'input' | 'output' | 'send' | 'return' };

export interface Segment {
  /** Stable identifier, e.g. 'front', 'amp-loop', 'hub-loop' */
  id: string;
  /** Pedals in signal order (may be empty - a direct anchor-to-anchor cable) */
  pedals: PlacedPedal[];
  from: Anchor;
  to: Anchor;
}

export type TopologyMode = 'standard' | 'pedal-loop' | '4cm';

export interface SignalTopology {
  mode: TopologyMode;
  segments: Segment[];
  /**
   * Pedals that act as wiring hubs (anchors of other segments) and are NOT
   * inside any segment's pedals list. They belong to the primary chain
   * spatially (their chainPosition slots them between segments).
   */
  hub: PlacedPedal | null;
  /** True when the amp effects loop participates in the topology */
  effectsLoopEnabled: boolean;
}

export const ext = (type: ExternalAnchorType): Anchor => ({ kind: 'external', type });
export const pedalAnchor = (pedalId: string, jack: 'input' | 'output' | 'send' | 'return'): Anchor =>
  ({ kind: 'pedal', pedalId, jack });

// ---------------------------------------------------------------------------
// 4-cable method category table (the ONE copy)
// ---------------------------------------------------------------------------

/** Categories that stay between guitar and the hub input */
export const FOUR_CM_BEFORE_HUB = ['tuner', 'filter', 'wah', 'pitch'];
/** Categories that run in the hub's own loop (into the amp preamp) */
export const FOUR_CM_IN_HUB_LOOP = ['overdrive', 'distortion', 'fuzz', 'boost'];
/** Categories that run in the amp's effects loop */
export const FOUR_CM_IN_AMP_LOOP = ['modulation', 'tremolo', 'delay', 'reverb'];
/** Categories after everything (loopers, master volume) */
export const FOUR_CM_AFTER_HUB = ['looper', 'volume'];

/** Drive categories auto-routed through an NS-2 style pedal loop */
export const PEDAL_LOOP_CATEGORIES = ['overdrive', 'distortion', 'fuzz', 'boost'];

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveSignalTopology(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  amp: Amp | null,
  useEffectsLoop: boolean,
  use4CableMethod: boolean,
  routingConfig?: RoutingConfig
): SignalTopology {
  const sorted = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);
  const dataOf = (p: PlacedPedal): Pedal | undefined => pedalsById[p.pedalId] || p.pedal;
  const effectsLoopEnabled = Boolean(useEffectsLoop && amp?.hasEffectsLoop);

  // --- 4-cable method: hub pedal spans the amp preamp -----------------------
  const hubPedal = use4CableMethod
    ? sorted.find((p) => p.location === 'four_cable_hub')
    : undefined;

  if (use4CableMethod && hubPedal && dataOf(hubPedal) && effectsLoopEnabled) {
    const beforeHub: PlacedPedal[] = [];
    const inHubLoop: PlacedPedal[] = [];
    const inAmpLoop: PlacedPedal[] = [];
    const afterHub: PlacedPedal[] = [];

    for (const placed of sorted) {
      if (placed.id === hubPedal.id) continue;
      const pedal = dataOf(placed);
      if (!pedal) continue;

      if (FOUR_CM_BEFORE_HUB.includes(pedal.category)) beforeHub.push(placed);
      else if (FOUR_CM_IN_HUB_LOOP.includes(pedal.category)) inHubLoop.push(placed);
      else if (FOUR_CM_IN_AMP_LOOP.includes(pedal.category)) inAmpLoop.push(placed);
      else if (FOUR_CM_AFTER_HUB.includes(pedal.category)) afterHub.push(placed);
      else inHubLoop.push(placed); // default: in front of the preamp
    }

    return {
      mode: '4cm',
      hub: hubPedal,
      effectsLoopEnabled,
      segments: [
        { id: 'before-hub', pedals: beforeHub, from: ext('guitar'), to: pedalAnchor(hubPedal.id, 'input') },
        { id: 'hub-loop', pedals: inHubLoop, from: pedalAnchor(hubPedal.id, 'send'), to: ext('amp_input') },
        { id: 'amp-loop', pedals: inAmpLoop, from: ext('amp_send'), to: pedalAnchor(hubPedal.id, 'return') },
        { id: 'after-hub', pedals: afterHub, from: pedalAnchor(hubPedal.id, 'output'), to: ext('amp_return') },
      ],
    };
  }

  // --- NS-2 style pedal loop -------------------------------------------------
  const loop = resolvePedalLoop(sorted, dataOf, routingConfig);
  if (loop) {
    const { loopPedal, memberIds } = loop;
    const beforeLoop: PlacedPedal[] = [];
    const inLoop: PlacedPedal[] = [];
    const afterLoop: PlacedPedal[] = [];

    for (const placed of sorted) {
      if (placed.id === loopPedal.id) continue;
      if (memberIds.includes(placed.id)) inLoop.push(placed);
      else if (placed.chainPosition < loopPedal.chainPosition) beforeLoop.push(placed);
      else afterLoop.push(placed);
    }

    if (inLoop.length > 0) {
      return {
        mode: 'pedal-loop',
        hub: loopPedal,
        effectsLoopEnabled,
        segments: [
          { id: 'before-hub', pedals: beforeLoop, from: ext('guitar'), to: pedalAnchor(loopPedal.id, 'input') },
          { id: 'hub-loop', pedals: inLoop, from: pedalAnchor(loopPedal.id, 'send'), to: pedalAnchor(loopPedal.id, 'return') },
          { id: 'after-hub', pedals: afterLoop, from: pedalAnchor(loopPedal.id, 'output'), to: ext('amp_input') },
        ],
      };
    }
  }

  // --- Standard (with optional amp effects loop) -----------------------------
  const loopPedals = effectsLoopEnabled
    ? sorted.filter((p) => p.location === 'effects_loop')
    : [];
  const front = effectsLoopEnabled
    ? sorted.filter((p) => p.location !== 'effects_loop')
    : sorted;

  const segments: Segment[] = [
    { id: 'front', pedals: front, from: ext('guitar'), to: ext('amp_input') },
  ];
  // The amp-loop segment exists only when it has pedals (no send->return
  // patch cable is suggested for an empty loop)
  if (loopPedals.length > 0) {
    segments.push({ id: 'amp-loop', pedals: loopPedals, from: ext('amp_send'), to: ext('amp_return') });
  }

  return { mode: 'standard', hub: null, effectsLoopEnabled, segments };
}

/**
 * NS-2 style pedal loop resolution: explicit routingConfig first, then
 * pedals with useLoop enabled (members auto-detected as drive categories).
 */
function resolvePedalLoop(
  sorted: PlacedPedal[],
  dataOf: (p: PlacedPedal) => Pedal | undefined,
  routingConfig?: RoutingConfig
): { loopPedal: PlacedPedal; memberIds: string[] } | null {
  if (routingConfig) {
    for (const config of routingConfig.pedalConfigs) {
      if (config.mode === 'loop' && config.loopPedalIds.length > 0) {
        const placed = sorted.find((p) => p.id === config.pedalId);
        const pedal = placed ? dataOf(placed) : undefined;
        if (placed && pedal && findJack(pedal, 'send') && findJack(pedal, 'return')) {
          return { loopPedal: placed, memberIds: config.loopPedalIds };
        }
      }
    }
  }

  for (const placed of sorted) {
    if (!placed.useLoop) continue;
    const pedal = dataOf(placed);
    if (pedal?.supports4Cable && findJack(pedal, 'send') && findJack(pedal, 'return')) {
      const memberIds = sorted
        .filter((p) => {
          const pd = dataOf(p);
          return pd && PEDAL_LOOP_CATEGORIES.includes(pd.category) && p.id !== placed.id;
        })
        .map((p) => p.id);
      return { loopPedal: placed, memberIds };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers for consumers
// ---------------------------------------------------------------------------

/** Whether a cable between these anchor kinds is an instrument cable */
export function isInstrumentRun(from: Anchor | 'pedal', to: Anchor | 'pedal'): boolean {
  const external = (a: Anchor | 'pedal') => a !== 'pedal' && a.kind === 'external';
  return external(from) || external(to);
}

/**
 * The primary chain in spatial order: pedals that flow guitar -> amp input,
 * with the hub pedal inline at its chain position. This is what the placer
 * lays out right-to-left as the main run.
 */
export function primaryChain(topology: SignalTopology): PlacedPedal[] {
  const byId = new Map<string, Segment>(topology.segments.map((s) => [s.id, s]));
  switch (topology.mode) {
    case '4cm': {
      // beforeHub -> hub -> drives (ends at amp input)
      return [
        ...(byId.get('before-hub')?.pedals ?? []),
        ...(topology.hub ? [topology.hub] : []),
        ...(byId.get('hub-loop')?.pedals ?? []),
      ];
    }
    case 'pedal-loop': {
      // beforeLoop -> hub -> afterLoop (ends at amp input); the hub's loop
      // members are a hub-anchored cluster, not part of the primary run
      return [
        ...(byId.get('before-hub')?.pedals ?? []),
        ...(topology.hub ? [topology.hub] : []),
        ...(byId.get('after-hub')?.pedals ?? []),
      ];
    }
    case 'standard':
      return byId.get('front')?.pedals ?? [];
  }
}

/** Segments that should be placed as amp-side clusters (in order) */
export function ampClusters(topology: SignalTopology): Segment[] {
  switch (topology.mode) {
    case '4cm':
      return topology.segments.filter((s) => s.id === 'amp-loop' || s.id === 'after-hub');
    case 'standard':
      return topology.segments.filter((s) => s.id === 'amp-loop');
    case 'pedal-loop':
      return [];
  }
}

/** Segments placed as clusters anchored at a hub pedal */
export function hubClusters(topology: SignalTopology): Segment[] {
  return topology.mode === 'pedal-loop'
    ? topology.segments.filter((s) => s.id === 'hub-loop')
    : [];
}
