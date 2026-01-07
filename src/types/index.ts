// Core domain types for PedalSchema

// ============================================
// Enums
// ============================================

export type PedalCategory =
  | 'tuner'
  | 'filter'
  | 'compressor'
  | 'pitch'
  | 'boost'
  | 'overdrive'
  | 'distortion'
  | 'fuzz'
  | 'noise_gate'
  | 'eq'
  | 'modulation'
  | 'tremolo'
  | 'delay'
  | 'reverb'
  | 'looper'
  | 'volume'
  | 'utility'
  | 'multi_fx';

export type JackSide = 'top' | 'bottom' | 'left' | 'right';

export type JackType =
  | 'input'
  | 'output'
  | 'send'
  | 'return'
  | 'power'
  | 'expression'
  | 'midi_in'
  | 'midi_out';

export type PowerPolarity = 'center_negative' | 'center_positive';

export type LoopType = 'series' | 'parallel' | 'switchable' | 'none';

export type ChainLocation =
  | 'front_of_amp'
  | 'effects_loop'
  | 'four_cable_hub'
  | 'flexible';

// ============================================
// Core Domain Models
// ============================================

export interface Board {
  id: string;
  name: string;
  manufacturer: string | null;
  widthInches: number;
  depthInches: number;
  railWidthInches: number;
  clearanceUnderInches: number | null;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  imageUrl: string | null;
  rails: BoardRail[];
}

export interface BoardRail {
  id: string;
  boardId: string;
  positionFromBackInches: number;
  sortOrder: number;
}

export interface PedalJack {
  id: string;
  pedalId: string;
  jackType: JackType;
  side: JackSide;
  positionPercent: number; // 0-100
  label: string | null;
}

export interface Pedal {
  id: string;
  name: string;
  manufacturer: string;
  category: PedalCategory;
  widthInches: number;
  depthInches: number;
  heightInches: number;
  voltage: number;
  currentMa: number | null;
  polarity: PowerPolarity;
  defaultChainPosition: number | null;
  preferredLocation: ChainLocation;
  supports4Cable: boolean;
  needsBufferBefore: boolean;
  needsDirectPickup: boolean;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  imageUrl: string | null;
  notes: string | null;
  jacks: PedalJack[];
}

export interface Amp {
  id: string;
  name: string;
  manufacturer: string;
  hasEffectsLoop: boolean;
  loopType: LoopType;
  loopLevel: string | null;
  sendJackLabel: string;
  returnJackLabel: string;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  notes: string | null;
}

export interface Configuration {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  boardId: string;
  ampId: string | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  /** When true, modulation pedals go in effects loop for cleaner sound */
  modulationInLoop: boolean;
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
  shareSlug: string | null;
  board?: Board;
  amp?: Amp;
  placedPedals?: PlacedPedal[];
  cables?: Cable[];
}

export interface PlacedPedal {
  id: string;
  configurationId: string;
  pedalId: string;
  xInches: number;
  yInches: number;
  rotationDegrees: number;
  chainPosition: number;
  location: ChainLocation;
  isActive: boolean;
  /** For pedals with send/return (like NS-2), whether to use the loop routing */
  useLoop: boolean;
  createdAt: string;
  pedal?: Pedal;
}

export interface Cable {
  id: string;
  configurationId: string;
  fromType: 'guitar' | 'pedal' | 'amp_input' | 'amp_send' | 'amp_return';
  fromPedalId: string | null;
  fromJack: string | null;
  toType: 'guitar' | 'pedal' | 'amp_input' | 'amp_send' | 'amp_return';
  toPedalId: string | null;
  toJack: string | null;
  calculatedLengthInches: number | null;
  cableType: 'patch' | 'instrument' | 'power';
  sortOrder: number;
  createdAt: string;
}

// ============================================
// UI/Editor Types
// ============================================

export interface Position {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Collision {
  pedalIds: [string, string];
  severity: 'overlap' | 'clearance';
}

export interface ChainWarning {
  type: 'noise' | 'tone' | 'routing' | 'power';
  message: string;
  suggestion: string;
  severity: 'info' | 'warning' | 'error';
  pedalIds?: string[];
}

export interface ChainSuggestion {
  type: 'routing' | 'optimization' | 'buffer';
  message: string;
  suggestion: string;
}

// ============================================
// Signal Chain Engine Types
// ============================================

export interface ChainContext {
  ampHasEffectsLoop: boolean;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  /** When true, modulation pedals go in effects loop for cleaner sound */
  modulationInLoop: boolean;
  loopType?: LoopType;
}

export interface SignalChainResult {
  orderedPedals: PlacedPedal[];
  frontOfAmpChain: PlacedPedal[];
  effectsLoopChain: PlacedPedal[];
  warnings: ChainWarning[];
  suggestions: ChainSuggestion[];
}

export interface ChainRule {
  id: string;
  name: string;
  description: string;
  condition: (pedal: Pedal, context: ChainContext) => boolean;
  apply: (pedals: PlacedPedal[], context: ChainContext) => PlacedPedal[];
  priority: number;
}

// ============================================
// Routing Configuration Types
// ============================================

export type RoutingMode = 'standard' | 'loop' | '4cable';

export interface PedalRoutingConfig {
  pedalId: string;
  mode: RoutingMode;
  loopPedalIds: string[]; // Pedals to route through this pedal's loop
}

export interface RoutingConfig {
  // Global routing mode
  useLoopPedals: boolean;
  use4CableMethod: boolean;
  useEffectsLoop?: boolean;
  // Per-pedal routing configurations
  pedalConfigs: PedalRoutingConfig[];
}

export interface WiringOption {
  id: string;
  name: string;
  description: string;
  isSelected: boolean;
}

// ============================================
// Optimization Types
// ============================================

export interface SwappableGroup {
  /** Pedal category (e.g., "overdrive", "delay") */
  category: PedalCategory;
  /** IDs of pedals in this group (placed pedal IDs) */
  pedalIds: string[];
  /** Index in signal chain where this group starts */
  chainStartIndex: number;
}

export interface PedalPlacement {
  id: string;
  x: number;
  y: number;
}

export interface JointOptimizationResult {
  /** Optimized pedal placements */
  placements: PedalPlacement[];
  /** Optimized signal chain order (placed pedal IDs) */
  chainOrder: string[];
  /** Swappable groups that were detected */
  swappableGroups: SwappableGroup[];
}
