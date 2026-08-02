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
  /**
   * Current draw in mA. THREE-STATE - do not collapse it to a number:
   *   null = unknown (not published / not measured)
   *   0    = a real, measured zero
   *   n    = measured draw
   *
   * Only displayed today, never summed. When a power-budget feature lands,
   * `?? 0` anywhere in the total would report a supply as adequate while
   * silently ignoring every pedal whose draw nobody knows - the most
   * dangerous possible direction for that error to point. Unknown pedals
   * must be excluded from the denominator AND surfaced as unknown, not
   * folded in as zero.
   */
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

/**
 * One physical output on a power supply.
 *
 * `ratedMa` is NOT nullable, unlike `Pedal.currentMa`. That asymmetry is
 * deliberate: "we do not know what this pedal draws" is a real and important
 * state that the power engine reports rather than hides, but an output whose
 * rating is unknown cannot be compared against anything, so the honest record
 * is no supply at all rather than a supply of zero.
 */
export interface PowerOutput {
  id: string;
  supplyId: string;
  /** What the supply's own panel calls it, so the UI can say "Output 3". */
  label: string;
  /** The default mode's voltage and rating. */
  voltage: number;
  ratedMa: number;
  /**
   * Other modes this output can be switched to. Voltage and rating are stored
   * TOGETHER because they are inseparable: a switchable output derates as
   * voltage rises (Zuma outputs 8-9 give 500mA at 9V but 250mA at 18V), and a
   * bare voltage list would have this reporting twice the real headroom.
   */
  alternateModes: Array<{ voltage: number; ratedMa: number }>;
  /**
   * AC output. Not a voltage variant of DC - a 9V DC pedal on a 9Vac output is
   * wrong however well the numbers line up, so the plan treats this as a
   * mismatch rather than comparing ratings. (CS12 output 12, for old Line 6
   * and Digitech pedals.)
   */
  isAc: boolean;
  sortOrder: number;
}

export interface PowerSupply {
  id: string;
  name: string;
  manufacturer: string;
  /**
   * Isolated outputs have their own transformer winding. A daisy chain does
   * not, which is why noise complaints track it - recorded because it changes
   * the advice, not just the arithmetic.
   */
  isIsolated: boolean;
  isSystem: boolean;
  createdBy: string | null;
  notes: string | null;
  outputs: PowerOutput[];
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
  /** When true, user manually set location - signal chain rules won't override it */
  locationOverride?: boolean;
  /** When true, user manually pinned this pedal's chain position - rules won't reorder it */
  chainPositionLocked?: boolean;
  /**
   * When true, Optimize must leave this pedal facing forward, even where
   * turning it would route better. Per BOARD, not per catalogue pedal: whether
   * you mind a big reverb sitting sideways depends on the board it is on.
   * Defaults on for large pedals when added; manual rotation ignores it.
   */
  rotationLocked?: boolean;
  /**
   * Which supply output this pedal is plugged into, on THIS board.
   *
   * null means unassigned, and that is a state the UI must show rather than
   * quietly treat as powered - an unassigned pedal is the most likely reason a
   * board that "adds up" still will not run.
   */
  powerOutputId?: string | null;
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
  /**
   * May Optimize turn pedals to shorten cable runs? Defaults to true when
   * absent. Only pedals that pass canOptimizerRotate() are ever considered -
   * nothing you play with your foot, nothing the owner has locked - and a
   * rotation is kept only when it strictly improves the layout. Manual
   * rotation ignores this.
   */
  allowRotation?: boolean;
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
  /**
   * Optimized rotations for pedals where rotating changed jack facing
   * (e.g., top-jack pedals). Only pedals whose rotation CHANGED are listed.
   */
  rotations?: Array<{ id: string; rotationDegrees: number }>;
}
