import type {
  Pedal,
  PlacedPedal,
  Cable,
  Board,
  Amp,
  RoutingConfig,
} from '@/types';
import {
  derivePedalDisplayNames,
  displayNameFor,
  type PedalDisplayName,
} from '@/lib/pedal-display-names';

// Standard patch cable lengths in inches
const STANDARD_CABLE_LENGTHS = [6, 12, 18, 24, 36, 48, 72, 120];

// Overhead factor for cable routing (cables don't go in straight lines)
const ROUTING_OVERHEAD = 1.2;

interface JackPosition {
  x: number; // in inches
  y: number; // in inches
}

interface CableConnection {
  fromType: Cable['fromType'];
  fromPedalId: string | null;
  fromJackType: string | null;
  toType: Cable['toType'];
  toPedalId: string | null;
  toJackType: string | null;
  calculatedLengthInches: number;
  cableType: Cable['cableType'];
  sortOrder: number;
}

// Jack position and endpoint geometry live in ./endpoints (single source of
// truth shared with the renderer and optimizer). Re-exported for existing
// importers.
import { getJackPosition, findJack, getExternalEndpointInches } from './endpoints';
export { getJackPosition, findJack } from './endpoints';

/**
 * Calculate the distance between two points
 */
function calculateDistance(p1: JackPosition, p2: JackPosition): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Round up to the nearest standard cable length
 */
export function roundToStandardLength(lengthInches: number): number {
  for (const standard of STANDARD_CABLE_LENGTHS) {
    if (lengthInches <= standard) {
      return standard;
    }
  }
  // For very long cables, round up to nearest 12 inches
  return Math.ceil(lengthInches / 12) * 12;
}

/**
 * External endpoint positions (guitar/amp), delegated to the shared
 * endpoints module so length estimates match what is actually drawn.
 */
function getGuitarPosition(board: Board): JackPosition {
  return getExternalEndpointInches('guitar', board);
}

function getAmpInputPosition(board: Board, useEffectsLoop: boolean = false): JackPosition {
  return getExternalEndpointInches('amp_input', board, useEffectsLoop);
}

function getAmpSendPosition(board: Board): JackPosition {
  return getExternalEndpointInches('amp_send', board);
}

function getAmpReturnPosition(board: Board): JackPosition {
  return getExternalEndpointInches('amp_return', board);
}

/**
 * Helper to add a cable connection
 */
function addCable(
  cables: CableConnection[],
  fromType: CableConnection['fromType'],
  fromPedalId: string | null,
  fromJackType: string | null,
  toType: CableConnection['toType'],
  toPedalId: string | null,
  toJackType: string | null,
  length: number,
  cableType: CableConnection['cableType'],
  sortOrder: number
): void {
  cables.push({
    fromType,
    fromPedalId,
    fromJackType,
    toType,
    toPedalId,
    toJackType,
    calculatedLengthInches: roundToStandardLength(length),
    cableType,
    sortOrder,
  });
}

// ---------------------------------------------------------------------------
// Topology-driven cable generation
// ---------------------------------------------------------------------------

import {
  deriveSignalTopology,
  type Anchor,
} from '../topology';

/**
 * Sub-index letters for cables that share a group number: 2, 2b, 2c...
 *
 * NOT `String.fromCharCode(97 + i)`. That walks straight through the alphabet
 * and the twelfth cable in a group came out as "2l" - a lowercase L sitting
 * next to a digit, which reads as "21". On a 24-cable board the list ran
 * ...2j, 2k, 21, 2m..., and the one that looked like a different number was
 * the one you would go hunting for.
 *
 * i, l and o are dropped for the same reason `share-link.ts` drops them, and
 * this is the second time that decision has had to be made in this repo.
 */


/**
 * Calculate all cable connections for a configuration by walking the signal
 * topology's segments (see ../topology - the single source of signal flow
 * for standard chains, amp effects loops, NS-2 pedal loops, and the
 * 4-cable method).
 * Every segment emits: entry cable (from-anchor -> first pedal), chain
 * cables (output -> input), exit cable (last pedal -> to-anchor); an empty
 * segment emits a single direct anchor-to-anchor cable.
 *
 * Cable type rule: any run touching an external endpoint (guitar/amp jack)
 * is an instrument cable; pedal-to-pedal runs (including hub send/return)
 * are patch cables.
 */
export function calculateCables(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  amp: Amp | null,
  useEffectsLoop: boolean,
  routingConfig?: RoutingConfig,
  use4CableMethod: boolean = false
): CableConnection[] {
  if (placedPedals.length === 0) return [];

  const topology = deriveSignalTopology(
    placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod, routingConfig
  );

  const cables: CableConnection[] = [];
  let sortOrder = 0;
  const placedById = new Map(placedPedals.map((p) => [p.id, p]));
  const dataOf = (p: PlacedPedal): Pedal | undefined => pedalsById[p.pedalId] || p.pedal;

  interface ResolvedAnchor {
    pos: JackPosition;
    type: CableConnection['fromType'];
    pedalId: string | null;
    jackType: string | null;
    external: boolean;
  }

  const resolveExternal = (type: 'guitar' | 'amp_input' | 'amp_send' | 'amp_return'): JackPosition => {
    switch (type) {
      case 'guitar': return getGuitarPosition(board);
      case 'amp_input': return getAmpInputPosition(board, useEffectsLoop);
      case 'amp_send': return getAmpSendPosition(board);
      case 'amp_return': return getAmpReturnPosition(board);
    }
  };

  const resolveAnchor = (anchor: Anchor): ResolvedAnchor => {
    if (anchor.kind === 'external') {
      return {
        pos: resolveExternal(anchor.type),
        type: anchor.type,
        pedalId: null,
        jackType: null,
        external: true,
      };
    }
    const placed = placedById.get(anchor.pedalId)!;
    const pedal = dataOf(placed);
    const pos = pedal
      ? getJackPosition(placed, findJack(pedal, anchor.jack), pedal)
      : { x: placed.xInches + 2, y: placed.yInches + 2 };
    return { pos, type: 'pedal', pedalId: anchor.pedalId, jackType: anchor.jack, external: false };
  };

  const jackPos = (placed: PlacedPedal, jackType: 'input' | 'output'): JackPosition => {
    const pedal = dataOf(placed);
    if (!pedal) {
      // Estimated position for missing pedal data (matches legacy behavior)
      return jackType === 'input'
        ? { x: placed.xInches + 2, y: placed.yInches + 2 }
        : { x: placed.xInches, y: placed.yInches + 2 };
    }
    return getJackPosition(placed, findJack(pedal, jackType), pedal);
  };

  for (const segment of topology.segments) {
    const from = resolveAnchor(segment.from);
    const to = resolveAnchor(segment.to);

    // Standard mode: an empty amp-loop segment is never derived; an empty
    // primary segment (or empty 4CM segment) becomes a direct cable
    if (segment.pedals.length === 0) {
      addCable(cables, from.type, from.pedalId, from.jackType, to.type, to.pedalId, to.jackType,
        calculateDistance(from.pos, to.pos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
      continue;
    }

    // Entry: from-anchor -> first pedal input
    const first = segment.pedals[0];
    addCable(cables, from.type, from.pedalId, from.jackType, 'pedal', first.id, 'input',
      calculateDistance(from.pos, jackPos(first, 'input')) * ROUTING_OVERHEAD,
      from.external ? 'instrument' : 'patch', sortOrder++);

    // Chain: output -> input between consecutive pedals
    for (let i = 0; i < segment.pedals.length - 1; i++) {
      const a = segment.pedals[i];
      const b = segment.pedals[i + 1];
      addCable(cables, 'pedal', a.id, 'output', 'pedal', b.id, 'input',
        calculateDistance(jackPos(a, 'output'), jackPos(b, 'input')) * ROUTING_OVERHEAD,
        'patch', sortOrder++);
    }

    // Exit: last pedal output -> to-anchor
    const last = segment.pedals[segment.pedals.length - 1];
    addCable(cables, 'pedal', last.id, 'output', to.type, to.pedalId, to.jackType,
      calculateDistance(jackPos(last, 'output'), to.pos) * ROUTING_OVERHEAD,
      to.external ? 'instrument' : 'patch', sortOrder++);
  }

  return cables;
}

/**
 * Generate a grouped cable list for shopping/display
 */
export interface CableListItem {
  lengthInches: number;
  lengthDisplay: string;
  cableType: 'patch' | 'instrument' | 'power';
  count: number;
  description: string;
}

export function generateCableList(cables: CableConnection[]): CableListItem[] {
  const grouped = new Map<string, CableListItem>();

  for (const cable of cables) {
    const key = `${cable.cableType}-${cable.calculatedLengthInches}`;

    if (grouped.has(key)) {
      grouped.get(key)!.count++;
    } else {
      grouped.set(key, {
        lengthInches: cable.calculatedLengthInches,
        /*
         * The PURCHASING vocabulary, and the same one the wiring rows use.
         *
         * This used `formatLength`, which is exact geometry - it renders 12in
         * as `1'` and 36in as `3'` while the row for that same cable said
         * `12"` and `3ft`. One cable, two notations, on one screen: someone
         * matching a row against the shopping list has to do the conversion
         * in their head to find out they are looking at the same thing.
         */
        lengthDisplay: formatLengthRange(cable.calculatedLengthInches),
        cableType: cable.cableType,
        count: 1,
        description: getCableDescription(cable.cableType),
      });
    }
  }

  // Sort by cable type, then by length
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.cableType !== b.cableType) {
      const typeOrder = { patch: 0, instrument: 1, power: 2 };
      return typeOrder[a.cableType] - typeOrder[b.cableType];
    }
    return a.lengthInches - b.lengthInches;
  });
}


function getCableDescription(cableType: 'patch' | 'instrument' | 'power'): string {
  switch (cableType) {
    case 'patch':
      return 'Patch cable (pedal to pedal)';
    case 'instrument':
      return 'Instrument cable (guitar/amp connections)';
    case 'power':
      return 'Power cable';
  }
}

// ============================================================================
// ENHANCED CABLE DISPLAY
// ============================================================================

/**
 * Enhanced cable representation for detailed wiring checklists
 */
export interface EnhancedCable {
  fromLabel: string;            // "Guitar output", "NS-2 SEND"
  toLabel: string;              // "NS-2 INPUT", "Wah INPUT"
  cableTypeLabel: string;       // "Instrument (10-15ft)", "Patch (6\")"
  lengthInches: number;
  cableType: 'patch' | 'instrument';
  /**
   * Which half of the rig this run belongs to.
   *
   * The boundary between them - the last pedal into the amp, then the amp's
   * SEND back out to the first loop pedal - is the biggest structural
   * transition on a board, and the list used to render it as just another row.
   */
  segment: 'front' | 'loop';
}

/**
 * Cable count summary by type
 */
export interface CableSummary {
  instrumentCount: number;
  patchCount: number;
  longCableCount: number;       // Cables > 24" (typically board-to-amp)
  totalCount: number;
}


/**
 * Generate enhanced cable list with logical groupings and numbered cables
 *
 * Numbering logic:
 * - Consecutive patch cables get sub-letters (2a, 2b, 2c)
 * - Segment transitions (instrument cables) get new numbers
 * - Effects loop section starts new numbering group
 */
export function generateEnhancedCableList(
  cables: CableConnection[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): EnhancedCable[] {
  if (cables.length === 0) return [];

  // Computed ONCE per list, not per endpoint: the ordinals must be consistent
  // across every label in the same render, and re-deriving per call would be
  // O(cables x pedals) for an answer that cannot change between them.
  const displayNames = derivePedalDisplayNames(placedPedals, pedalsById);

  const result: EnhancedCable[] = [];
  let inEffectsLoop = false;

  // Filter out power cables (not part of signal chain) and sort by sortOrder
  const sorted = [...cables]
    .filter(c => c.cableType !== 'power')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  /*
   * THE NUMBERING IS GONE, and it was not a loss.
   *
   * Every row used to carry a label from a group-and-sub-index scheme -
   * `1, 2, 2b, 2c ... 2t, 3, 4, 5, 5b, 5c, 6` on the 22-pedal board. That is
   * 24 labels encoding about four groups, with one group holding eighteen of
   * them, and the sub-letters were pure sequence - which the row order already
   * gives you. It cost a column and returned almost nothing, and it is the
   * scheme that once rendered the twelfth cable as "2l", a lowercase L beside
   * digits, reading as "21".
   *
   * What the grouping was really carrying - front of amp versus effects loop -
   * is kept, as a field that says so.
   */
  for (const cable of sorted) {
    if (cable.fromType === 'amp_send' || cable.toType === 'amp_return') {
      inEffectsLoop = true;
    } else if (cable.fromType === 'amp_return') {
      inEffectsLoop = false;
    }

    // Generate labels
    const fromLabel = getCableEndpointLabel(cable.fromType, cable.fromPedalId, cable.fromJackType, placedPedals, pedalsById, displayNames);
    const toLabel = getCableEndpointLabel(cable.toType, cable.toPedalId, cable.toJackType, placedPedals, pedalsById, displayNames);

    // Generate cable type label with length
    const lengthStr = formatLengthRange(cable.calculatedLengthInches);
    const typeStr = cable.cableType === 'instrument' ? 'Instrument' : 'Patch';
    const cableTypeLabel = `${typeStr} (${lengthStr})`;

    result.push({
      fromLabel,
      toLabel,
      cableTypeLabel,
      lengthInches: cable.calculatedLengthInches,
      cableType: cable.cableType as 'patch' | 'instrument',
      segment: inEffectsLoop ? 'loop' : 'front',
    });
  }

  return result;
}


/**
 * Calculate cable count summary by type
 */
export function calculateCableSummary(cables: CableConnection[]): CableSummary {
  let instrumentCount = 0;
  let patchCount = 0;
  let longCableCount = 0;

  for (const cable of cables) {
    if (cable.cableType === 'instrument') {
      instrumentCount++;
    } else if (cable.cableType === 'patch') {
      patchCount++;
    }

    // Long cables are typically > 24" (used for board-to-amp connections)
    if (cable.calculatedLengthInches > 24) {
      longCableCount++;
    }
  }

  return {
    instrumentCount,
    patchCount,
    longCableCount,
    totalCount: cables.length,
  };
}

// ============================================================================
// HELPER FUNCTIONS FOR ENHANCED DISPLAY
// ============================================================================

/**
 * Get a label for a cable endpoint (for wiring checklist)
 */
function getCableEndpointLabel(
  type: CableConnection['fromType'] | CableConnection['toType'],
  pedalId: string | null,
  jackType: string | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  displayNames: Map<string, PedalDisplayName>
): string {
  switch (type) {
    case 'guitar':
      return 'Guitar output';
    case 'amp_input':
      return 'Amp INPUT';
    case 'amp_send':
      return 'Amp SEND';
    case 'amp_return':
      return 'Amp RETURN';
    case 'pedal':
      if (pedalId) {
        const placed = placedPedals.find(p => p.id === pedalId);
        if (placed) {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (pedal) {
            const jackLabel = jackType ? jackType.toUpperCase() : 'INPUT';
            // Two CS-3s on a board used to produce "CS-3 OUTPUT -> CS-3 INPUT",
            // a row that names neither pedal. The ordinal comes from chain
            // position, so it is the SAME ordinal the Chain panel shows.
            return `${displayNameFor(displayNames, placed.id, pedal.name)} ${jackLabel}`;
          }
        }
      }
      return `Pedal ${jackType?.toUpperCase() || 'INPUT'}`;
    default:
      return 'Unknown';
  }
}


/**
 * Format cable length as a range (for practical purchasing)
 */
export function formatLengthRange(inches: number): string {
  if (inches <= 6) return '6"';
  if (inches <= 12) return '12"';
  if (inches <= 18) return '18"';
  if (inches <= 24) return '24"';
  if (inches <= 36) return '3ft';
  if (inches <= 48) return '4ft';
  if (inches <= 72) return '6ft';
  if (inches <= 120) return '10ft';
  if (inches <= 180) return '15ft';
  return `${Math.ceil(inches / 12)}ft`;
}
