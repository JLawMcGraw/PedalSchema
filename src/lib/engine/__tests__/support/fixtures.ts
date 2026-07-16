/**
 * Shared test fixtures for engine tests.
 *
 * Boards, pedal sets, and amps modeled on real gear so matrix scenarios
 * exercise realistic geometry (incl. the user's Pedaltrain Jr rail layout
 * that triggers the rails-too-close fallback, and top-mounted jacks).
 */

import type { Amp, Board, Pedal, PedalJack, PlacedPedal } from '@/types';

export const NOW = '2024-01-01T00:00:00Z';
export const SCALE = 40; // px per inch, matching the editor canvas

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export type BoardKind = 'wide' | 'jr' | 'mini';

export function makeBoard(kind: BoardKind): Board {
  const specs: Record<BoardKind, { name: string; w: number; d: number; rails: number[] }> = {
    // Two proper rows with a usable gap
    wide: { name: 'Wide 22', w: 22, d: 12.5, rails: [2, 8] },
    // The user's Pedaltrain Classic Jr: 4 rails too close for BOSS-depth
    // pedals - exercises the safe-rows fallback
    jr: { name: 'Pedaltrain Classic Jr', w: 18, d: 12.5, rails: [0, 3.1, 6.2, 9.3] },
    // Single-row mini board
    mini: { name: 'Mini 14', w: 14, d: 5.5, rails: [0.2] },
  };
  const s = specs[kind];
  return {
    id: `board-${kind}`,
    name: s.name,
    manufacturer: null,
    widthInches: s.w,
    depthInches: s.d,
    railWidthInches: 2,
    clearanceUnderInches: null,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    rails: s.rails.map((y, i) => ({
      id: `rail-${kind}-${i}`,
      boardId: `board-${kind}`,
      positionFromBackInches: y,
      sortOrder: i + 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pedals
// ---------------------------------------------------------------------------

function jack(
  pedalId: string,
  jackType: PedalJack['jackType'],
  side: PedalJack['side'],
  positionPercent: number
): PedalJack {
  return {
    id: `${pedalId}-${jackType}`,
    pedalId,
    jackType,
    side,
    positionPercent,
    label: jackType.toUpperCase(),
  };
}

interface PedalSpec {
  id: string;
  name: string;
  category: Pedal['category'];
  width?: number;
  depth?: number;
  supports4Cable?: boolean;
  jacks?: (id: string) => PedalJack[];
}

function buildPedal(spec: PedalSpec): Pedal {
  return {
    id: spec.id,
    name: spec.name,
    manufacturer: 'Test',
    category: spec.category,
    widthInches: spec.width ?? 2.87,
    depthInches: spec.depth ?? 5.08,
    heightInches: 2.37,
    voltage: 9,
    currentMa: 50,
    polarity: 'center_negative',
    defaultChainPosition: null,
    preferredLocation: 'front_of_amp',
    supports4Cable: spec.supports4Cable ?? false,
    needsBufferBefore: false,
    needsDirectPickup: false,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    notes: null,
    jacks: spec.jacks ? spec.jacks(spec.id) : [],
  } as Pedal;
}

const sideJacks = (id: string): PedalJack[] => [
  jack(id, 'input', 'right', 50),
  jack(id, 'output', 'left', 50),
];

const ns2Jacks = (id: string): PedalJack[] => [
  jack(id, 'input', 'right', 75),
  jack(id, 'output', 'left', 75),
  jack(id, 'send', 'right', 25),
  jack(id, 'return', 'left', 25),
];

// EQ-200-style: jacks on the TOP edge
const topJacks = (id: string): PedalJack[] => [
  jack(id, 'input', 'top', 75),
  jack(id, 'output', 'top', 25),
];

export type PedalSetKind = 'trio' | 'seven' | 'twelve';

const PEDAL_SPECS: Record<PedalSetKind, PedalSpec[]> = {
  trio: [
    { id: 'tuner', name: 'TU-3', category: 'tuner', jacks: sideJacks },
    { id: 'od', name: 'TS9', category: 'overdrive', jacks: sideJacks },
    { id: 'delay', name: 'DD-7', category: 'delay' },
  ],
  // Mirrors the user's board
  seven: [
    { id: 'tuner', name: 'TU-3', category: 'tuner', jacks: sideJacks },
    { id: 'od', name: 'TS9', category: 'overdrive', jacks: sideJacks },
    { id: 'dist', name: 'MT-2W', category: 'distortion' },
    { id: 'gate', name: 'NS-2', category: 'noise_gate', supports4Cable: true, jacks: ns2Jacks },
    { id: 'phaser', name: 'PH-3', category: 'modulation' },
    { id: 'flanger', name: 'BF-3', category: 'modulation' },
    { id: 'looper', name: 'RC-1', category: 'looper', jacks: sideJacks },
  ],
  twelve: [
    { id: 'tuner', name: 'TU-3', category: 'tuner', jacks: sideJacks },
    { id: 'comp', name: 'CP-1X', category: 'compressor' },
    { id: 'boost', name: 'BP-1W', category: 'boost' },
    { id: 'od', name: 'TS9', category: 'overdrive', jacks: sideJacks },
    { id: 'dist', name: 'MT-2W', category: 'distortion' },
    { id: 'gate', name: 'NS-2', category: 'noise_gate', supports4Cable: true, jacks: ns2Jacks },
    { id: 'eq', name: 'EQ-200', category: 'eq', width: 3.98, depth: 5.43, jacks: topJacks },
    { id: 'phaser', name: 'PH-3', category: 'modulation' },
    { id: 'delay', name: 'DD-7', category: 'delay' },
    { id: 'reverb', name: 'RV-6', category: 'reverb' },
    { id: 'volume', name: 'FV-500', category: 'volume' },
    { id: 'looper', name: 'RC-1', category: 'looper', jacks: sideJacks },
  ],
};

export interface PedalSet {
  pedalsById: Record<string, Pedal>;
  placedPedals: PlacedPedal[];
  /** Placed-pedal id of the NS-2 style pedal, if the set has one */
  hubId: string | null;
}

export function makePedalSet(kind: PedalSetKind): PedalSet {
  const pedalsById: Record<string, Pedal> = {};
  const placedPedals: PlacedPedal[] = [];
  let hubId: string | null = null;

  PEDAL_SPECS[kind].forEach((spec, i) => {
    const pedal = buildPedal(spec);
    pedalsById[pedal.id] = pedal;
    const placedId = `placed-${spec.id}`;
    if (spec.supports4Cable) hubId = placedId;
    placedPedals.push({
      id: placedId,
      configurationId: 'config-test',
      pedalId: pedal.id,
      xInches: 0,
      yInches: 0,
      rotationDegrees: 0,
      chainPosition: i + 1,
      location: 'front_of_amp',
      isActive: true,
      useLoop: false,
      createdAt: NOW,
    });
  });

  return { pedalsById, placedPedals, hubId };
}

/** Total width a pedal set needs at minimum spacing, in inches */
export function requiredWidth(set: PedalSet): number {
  const widths = set.placedPedals.map((p) => set.pedalsById[p.pedalId].widthInches);
  return widths.reduce((sum, w) => sum + w, 0) + (widths.length - 1) * 0.5;
}

// ---------------------------------------------------------------------------
// Amp
// ---------------------------------------------------------------------------

export function makeAmp(hasEffectsLoop: boolean): Amp {
  return {
    id: 'amp-test',
    name: hasEffectsLoop ? 'FX Loop Amp' : 'Plain Amp',
    manufacturer: 'Test',
    hasEffectsLoop,
    loopType: hasEffectsLoop ? 'series' : 'none',
    loopLevel: null,
    sendJackLabel: 'SEND',
    returnJackLabel: 'RETURN',
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    notes: null,
  };
}
