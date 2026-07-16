import type {
  Pedal,
  PlacedPedal,
  Cable,
  Board,
  Amp,
  RoutingConfig,
} from '@/types';

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
        lengthDisplay: formatLength(cable.calculatedLengthInches),
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

function formatLength(inches: number): string {
  if (inches < 12) {
    return `${inches}"`;
  } else if (inches % 12 === 0) {
    return `${inches / 12}'`;
  } else {
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;
    return `${feet}'${remainingInches}"`;
  }
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

/**
 * Calculate total cable length for cost estimation
 */
export function calculateTotalCableLength(cables: CableConnection[]): {
  patch: number;
  instrument: number;
  power: number;
  total: number;
} {
  const result = { patch: 0, instrument: 0, power: 0, total: 0 };

  for (const cable of cables) {
    result[cable.cableType] += cable.calculatedLengthInches;
    result.total += cable.calculatedLengthInches;
  }

  return result;
}

// ============================================================================
// ENHANCED CABLE DISPLAY
// ============================================================================

/**
 * Enhanced cable representation for detailed wiring checklists
 */
export interface EnhancedCable {
  cableNumber: string;          // "1", "2a", "2b", etc.
  groupId: number;
  fromLabel: string;            // "Guitar output", "NS-2 SEND"
  toLabel: string;              // "NS-2 INPUT", "Wah INPUT"
  cableTypeLabel: string;       // "Instrument (10-15ft)", "Patch (6\")"
  lengthInches: number;
  cableType: 'patch' | 'instrument';
  isSubCable: boolean;
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
 * Signal flow segment for text-based diagram
 */
export interface SignalFlowSegment {
  label: string;                // "Guitar", "NS-2 INPUT", "[PREAMP]"
  isExternal: boolean;          // true for Guitar, Amp, Preamp markers
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
  pedalsById: Record<string, Pedal>,
  useEffectsLoop: boolean,
  amp: Amp | null
): EnhancedCable[] {
  if (cables.length === 0) return [];

  const result: EnhancedCable[] = [];
  let groupNumber = 1;
  let subIndex = 0;
  let lastCableType: 'patch' | 'instrument' | null = null;
  let inEffectsLoop = false;

  // Filter out power cables (not part of signal chain) and sort by sortOrder
  const sorted = [...cables]
    .filter(c => c.cableType !== 'power')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const cable of sorted) {
    // Detect effects loop section
    const isEffectsLoopCable = cable.fromType === 'amp_send' || cable.toType === 'amp_return';
    if (isEffectsLoopCable && !inEffectsLoop) {
      inEffectsLoop = true;
      // Start new group for effects loop
      groupNumber++;
      subIndex = 0;
      lastCableType = null;
    }

    // Determine if this starts a new group or continues as sub-cable
    const startsNewGroup = cable.cableType === 'instrument' ||
      lastCableType === null ||
      (lastCableType === 'instrument' && cable.cableType === 'patch');

    if (startsNewGroup) {
      if (lastCableType !== null) {
        groupNumber++;
      }
      subIndex = 0;
    } else {
      subIndex++;
    }

    // Generate cable number
    let cableNumber: string;
    if (cable.cableType === 'instrument' || subIndex === 0) {
      cableNumber = String(groupNumber);
    } else {
      cableNumber = `${groupNumber}${String.fromCharCode(97 + subIndex)}`; // 97 = 'a'
    }

    // Generate labels
    const fromLabel = getCableEndpointLabel(cable.fromType, cable.fromPedalId, cable.fromJackType, placedPedals, pedalsById);
    const toLabel = getCableEndpointLabel(cable.toType, cable.toPedalId, cable.toJackType, placedPedals, pedalsById);

    // Generate cable type label with length
    const lengthStr = formatLengthRange(cable.calculatedLengthInches);
    const typeStr = cable.cableType === 'instrument' ? 'Instrument' : 'Patch';
    const cableTypeLabel = `${typeStr} (${lengthStr})`;

    result.push({
      cableNumber,
      groupId: groupNumber,
      fromLabel,
      toLabel,
      cableTypeLabel,
      lengthInches: cable.calculatedLengthInches,
      cableType: cable.cableType as 'patch' | 'instrument',
      isSubCable: subIndex > 0,
    });

    lastCableType = cable.cableType as 'patch' | 'instrument';
  }

  return result;
}

/**
 * Generate text-based signal flow diagram
 */
export function generateSignalFlowDiagram(
  cables: CableConnection[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  useEffectsLoop: boolean,
  amp: Amp | null
): SignalFlowSegment[] {
  if (cables.length === 0) return [];

  const segments: SignalFlowSegment[] = [];
  const sorted = [...cables].sort((a, b) => a.sortOrder - b.sortOrder);

  // Track if we've added the preamp marker
  let addedPreamp = false;

  for (let i = 0; i < sorted.length; i++) {
    const cable = sorted[i];

    // Add "from" segment for first cable or transitions
    if (i === 0 || cable.fromType !== sorted[i - 1].toType) {
      const fromLabel = getFlowLabel(cable.fromType, cable.fromPedalId, cable.fromJackType, placedPedals, pedalsById, 'from');
      const isExternal = cable.fromType === 'guitar' || cable.fromType === 'amp_send';
      segments.push({ label: fromLabel, isExternal });
    }

    // Add [PREAMP] marker when entering effects loop
    if (!addedPreamp && cable.fromType === 'amp_send') {
      // Insert [PREAMP] before the amp_send
      const lastIdx = segments.length - 1;
      if (lastIdx >= 0) {
        segments.splice(lastIdx, 0, { label: '[PREAMP]', isExternal: true });
      }
      addedPreamp = true;
    }

    // Add "to" segment
    const toLabel = getFlowLabel(cable.toType, cable.toPedalId, cable.toJackType, placedPedals, pedalsById, 'to');
    const isExternal = cable.toType === 'amp_input' || cable.toType === 'amp_return';
    segments.push({ label: toLabel, isExternal });
  }

  // Add final amp marker if ending with amp_input (not effects loop)
  const lastCable = sorted[sorted.length - 1];
  if (lastCable.toType === 'amp_return' && amp?.hasEffectsLoop) {
    segments.push({ label: '[POWER AMP]', isExternal: true });
    segments.push({ label: 'Speaker', isExternal: true });
  } else if (lastCable.toType === 'amp_input' && !useEffectsLoop) {
    segments.push({ label: 'Speaker', isExternal: true });
  }

  return segments;
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
  pedalsById: Record<string, Pedal>
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
            return `${pedal.name} ${jackLabel}`;
          }
        }
      }
      return `Pedal ${jackType?.toUpperCase() || 'INPUT'}`;
    default:
      return 'Unknown';
  }
}

/**
 * Get a label for signal flow diagram (shorter than wiring checklist)
 */
function getFlowLabel(
  type: CableConnection['fromType'] | CableConnection['toType'],
  pedalId: string | null,
  jackType: string | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  direction: 'from' | 'to'
): string {
  switch (type) {
    case 'guitar':
      return 'Guitar';
    case 'amp_input':
      return 'Amp INPUT';
    case 'amp_send':
      return 'SEND';
    case 'amp_return':
      return 'RETURN';
    case 'pedal':
      if (pedalId) {
        const placed = placedPedals.find(p => p.id === pedalId);
        if (placed) {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (pedal) {
            // For send/return jacks, show the jack type
            if (jackType === 'send' || jackType === 'return') {
              return `${pedal.name} ${jackType.toUpperCase()}`;
            }
            return pedal.name;
          }
        }
      }
      return 'Pedal';
    default:
      return 'Unknown';
  }
}

/**
 * Format cable length as a range (for practical purchasing)
 */
function formatLengthRange(inches: number): string {
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
