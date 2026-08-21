import type { PedalCategory } from '@/types';

/**
 * COLOUR ENCODES THE SIGNAL FAMILY, NOT THE CATEGORY.
 *
 * There are 18 categories and there used to be 18 hues - one raw Tailwind-500
 * for each, straight round the wheel. Measured in the running app they were the
 * single loudest colour event on screen: 18 saturated dots against a palette
 * whose whole point is one accent.
 *
 * 18 is also just past what colour can carry. Eight is roughly the ceiling for
 * hues a reader can tell apart, and far fewer than that survive protanopia and
 * deuteranopia. So colour drops to the coarser thing it can actually encode -
 * what the pedal DOES to the signal - and the exact category is carried by the
 * label, which is present at every single site a dot is: the library groups
 * under a category heading, the chain rows name the pedal, the properties panel
 * spells the category out.
 *
 * The four chromatic families were validated, not eyeballed, on all pairs:
 *
 *   lightness band   all 4 inside L 0.48-0.67   PASS
 *   chroma floor     all 4 >= 0.1               PASS
 *   CVD separation   worst pair dE 9.9 (deutan) PASS  (target 8)
 *   normal vision    worst pair dE 16.9         PASS  (floor 15)
 *   contrast         all 4 >= 3:1 on both surfaces
 *
 * Re-run before changing any value:
 *   node <dataviz>/scripts/validate_palette.js \
 *     "#2a75ba,#d37e01,#b94082,#1faaa4" --mode dark --surface "#191c20" --pairs all
 *
 * `utility` is deliberately BELOW the chroma floor. It is not a fifth hue that
 * failed to be colourful - it is the "this is not one effect" bucket (tuner,
 * gate, volume, looper, multi-FX), and grey says that better than a colour.
 */
export type PedalFamily = 'shaping' | 'gain' | 'modulation' | 'time' | 'utility';

export const PEDAL_FAMILIES: {
  value: PedalFamily;
  label: string;
  /** What this family does to the signal. Used as the legend gloss. */
  description: string;
  color: string;
}[] = [
  {
    value: 'shaping',
    label: 'Shaping',
    description: 'Level and frequency, before anything is added',
    color: '#2a75ba', // oklch(0.55 0.13 250)
  },
  {
    value: 'gain',
    label: 'Gain',
    description: 'Adds harmonics - the dirt',
    color: '#d37e01', // oklch(0.67 0.15 65)
  },
  {
    value: 'modulation',
    label: 'Modulation',
    description: 'Moves the signal against a copy of itself',
    color: '#b94082', // oklch(0.56 0.17 350)
  },
  {
    value: 'time',
    label: 'Time',
    description: 'Repeats and space',
    color: '#1faaa4', // oklch(0.67 0.11 190)
  },
  {
    value: 'utility',
    label: 'Utility',
    description: 'Does not colour the signal, or contains many that do',
    color: '#81878d', // oklch(0.62 0.012 250) - the neutral, on purpose
  },
];

/**
 * THE STAGES OF A SIGNAL CHAIN, which is the vocabulary players actually use.
 *
 * "Tuner first, then wah and pitch, then compression, then the dirt, then EQ,
 * then modulation, then delay and reverb last" is how every pedal-order guide
 * on earth explains a board, and it is the level a routing diagram should
 * talk at: `18 pedals` is honest and says nothing, while
 * `DYNAMICS 3 · GAIN 5 · EQ 3` is the shape of the chain.
 *
 * This is a BANDING OF `defaultOrder`, not a second opinion about order.
 * `defaultOrder` stays the single source of truth for what goes where; a
 * stage only says which of those positions get read out under one heading.
 * It is a column on the table below rather than a lookup beside it, so a new
 * category cannot be added without deciding which stage it belongs to.
 *
 * ONE DELIBERATE DIVERGENCE from the common guides: they place BOOST after
 * the dirt ("boost your solos"), and this app orders it at 50, in front of
 * it ("push the drive harder"). Both are real practice. The app already
 * decided, `defaultOrder` is what the engine sorts by, and a display grouping
 * does not get to re-litigate it - so boost is read out under GAIN, where the
 * engine puts it.
 */
export type ChainStage =
  | 'tuner'
  | 'filter'
  | 'dynamics'
  | 'gain'
  | 'eq'
  | 'modulation'
  | 'time'
  | 'utility';

export const CHAIN_STAGES: {
  value: ChainStage;
  label: string;
  /** For a 287px panel, where the full label does not fit beside content. */
  short: string;
}[] = [
  { value: 'tuner', label: 'Tuner', short: 'Tuner' },
  { value: 'filter', label: 'Filter & pitch', short: 'Filter' },
  { value: 'dynamics', label: 'Dynamics', short: 'Dynamics' },
  { value: 'gain', label: 'Gain', short: 'Gain' },
  { value: 'eq', label: 'EQ', short: 'EQ' },
  { value: 'modulation', label: 'Modulation', short: 'Mod' },
  { value: 'time', label: 'Time', short: 'Time' },
  { value: 'utility', label: 'Utility', short: 'Util' },
];

export const PEDAL_CATEGORIES: {
  value: PedalCategory;
  label: string;
  defaultOrder: number;
  family: PedalFamily;
  stage: ChainStage;
}[] = [
  { value: 'tuner', label: 'Tuner', defaultOrder: 10, family: 'utility', stage: 'tuner' },
  { value: 'filter', label: 'Filter / Wah', defaultOrder: 20, family: 'shaping', stage: 'filter' },
  { value: 'compressor', label: 'Compressor', defaultOrder: 30, family: 'shaping', stage: 'dynamics' },
  { value: 'pitch', label: 'Pitch', defaultOrder: 40, family: 'shaping', stage: 'filter' },
  { value: 'boost', label: 'Boost', defaultOrder: 50, family: 'gain', stage: 'gain' },
  { value: 'overdrive', label: 'Overdrive', defaultOrder: 60, family: 'gain', stage: 'gain' },
  { value: 'distortion', label: 'Distortion', defaultOrder: 70, family: 'gain', stage: 'gain' },
  { value: 'fuzz', label: 'Fuzz', defaultOrder: 80, family: 'gain', stage: 'gain' },
  { value: 'noise_gate', label: 'Noise Gate', defaultOrder: 90, family: 'utility', stage: 'utility' },
  { value: 'eq', label: 'EQ', defaultOrder: 100, family: 'shaping', stage: 'eq' },
  { value: 'modulation', label: 'Modulation', defaultOrder: 110, family: 'modulation', stage: 'modulation' },
  { value: 'tremolo', label: 'Tremolo', defaultOrder: 120, family: 'modulation', stage: 'modulation' },
  { value: 'delay', label: 'Delay', defaultOrder: 130, family: 'time', stage: 'time' },
  { value: 'reverb', label: 'Reverb', defaultOrder: 140, family: 'time', stage: 'time' },
  { value: 'looper', label: 'Looper', defaultOrder: 160, family: 'utility', stage: 'utility' },
  { value: 'volume', label: 'Volume', defaultOrder: 150, family: 'utility', stage: 'utility' },
  { value: 'utility', label: 'Utility', defaultOrder: 200, family: 'utility', stage: 'utility' },
  { value: 'multi_fx', label: 'Multi-FX', defaultOrder: 100, family: 'utility', stage: 'utility' },
];

/** Short forms, for the places that have no room for the full label. */
export const CATEGORY_SHORT_LABELS: Record<PedalCategory, string> = {
  tuner: 'Tuner',
  filter: 'Filter',
  compressor: 'Comp',
  pitch: 'Pitch',
  boost: 'Boost',
  overdrive: 'OD',
  distortion: 'Dist',
  fuzz: 'Fuzz',
  noise_gate: 'Gate',
  eq: 'EQ',
  modulation: 'Mod',
  tremolo: 'Trem',
  delay: 'Delay',
  reverb: 'Verb',
  looper: 'Loop',
  volume: 'Vol',
  utility: 'Util',
  multi_fx: 'Multi',
};

const UNKNOWN_FAMILY: PedalFamily = 'utility';

export function getCategoryFamily(category: PedalCategory): PedalFamily {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.family ?? UNKNOWN_FAMILY;
}

export function getFamilyColor(family: PedalFamily): string {
  // Non-null: PEDAL_FAMILIES covers the union, and getCategoryFamily is the
  // only other way in.
  return PEDAL_FAMILIES.find((f) => f.value === family)!.color;
}

export function getFamilyLabel(family: PedalFamily): string {
  return PEDAL_FAMILIES.find((f) => f.value === family)!.label;
}

/**
 * The colour for a pedal. Kept as `getCategoryColor` because every call site
 * asks the same question - "what colour is this pedal?" - and none of them
 * cares that the answer now comes from the family.
 */
export function getCategoryColor(category: PedalCategory): string {
  return getFamilyColor(getCategoryFamily(category));
}

export function getCategoryLabel(category: PedalCategory): string {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.label || category;
}

export function getCategoryShortLabel(category: PedalCategory): string {
  return CATEGORY_SHORT_LABELS[category] || category;
}

export function getCategoryDefaultOrder(category: PedalCategory): number {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.defaultOrder || 100;
}

const UNKNOWN_STAGE: ChainStage = 'utility';

/** Which stage of the chain a category is read out under. */
export function getCategoryStage(category: PedalCategory): ChainStage {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.stage ?? UNKNOWN_STAGE;
}

export function getStageLabel(stage: ChainStage): string {
  return CHAIN_STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export function getStageShortLabel(stage: ChainStage): string {
  return CHAIN_STAGES.find((s) => s.value === stage)?.short ?? stage;
}
