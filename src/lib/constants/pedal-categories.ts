import type { PedalCategory } from '@/types';

export const PEDAL_CATEGORIES: {
  value: PedalCategory;
  label: string;
  defaultOrder: number;
  color: string;
}[] = [
  { value: 'tuner', label: 'Tuner', defaultOrder: 10, color: '#64748b' },
  { value: 'filter', label: 'Filter / Wah', defaultOrder: 20, color: '#a855f7' },
  { value: 'compressor', label: 'Compressor', defaultOrder: 30, color: '#3b82f6' },
  { value: 'pitch', label: 'Pitch', defaultOrder: 40, color: '#06b6d4' },
  { value: 'boost', label: 'Boost', defaultOrder: 50, color: '#eab308' },
  { value: 'overdrive', label: 'Overdrive', defaultOrder: 60, color: '#22c55e' },
  { value: 'distortion', label: 'Distortion', defaultOrder: 70, color: '#f97316' },
  { value: 'fuzz', label: 'Fuzz', defaultOrder: 80, color: '#ef4444' },
  { value: 'noise_gate', label: 'Noise Gate', defaultOrder: 90, color: '#6b7280' },
  { value: 'eq', label: 'EQ', defaultOrder: 100, color: '#6366f1' },
  { value: 'modulation', label: 'Modulation', defaultOrder: 110, color: '#ec4899' },
  { value: 'tremolo', label: 'Tremolo', defaultOrder: 120, color: '#f43f5e' },
  { value: 'delay', label: 'Delay', defaultOrder: 130, color: '#14b8a6' },
  { value: 'reverb', label: 'Reverb', defaultOrder: 140, color: '#0ea5e9' },
  { value: 'looper', label: 'Looper', defaultOrder: 160, color: '#84cc16' },
  { value: 'volume', label: 'Volume', defaultOrder: 150, color: '#f59e0b' },
  { value: 'utility', label: 'Utility', defaultOrder: 200, color: '#78716c' },
  { value: 'multi_fx', label: 'Multi-FX', defaultOrder: 100, color: '#8b5cf6' },
];

export function getCategoryColor(category: PedalCategory): string {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.color || '#6b7280';
}

export function getCategoryLabel(category: PedalCategory): string {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.label || category;
}

export function getCategoryDefaultOrder(category: PedalCategory): number {
  return PEDAL_CATEGORIES.find((c) => c.value === category)?.defaultOrder || 100;
}
