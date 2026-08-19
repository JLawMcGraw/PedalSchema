/**
 * Splitting the pedal library into category sections.
 *
 * Pure and tested because the ORDER is not the order the pedals arrive in and
 * not alphabetical either - it is the signal-chain order a player thinks in
 * (tuner, filter, compressor, ... delay, reverb), which lives in
 * PEDAL_CATEGORIES.defaultOrder. Getting that wrong looks like a working panel
 * with the reverbs above the overdrives.
 */
import { PEDAL_CATEGORIES, getFamilyColor } from '@/lib/constants/pedal-categories';
import type { Pedal, PedalCategory } from '@/types';

export interface PedalGroup {
  category: PedalCategory;
  label: string;
  color: string;
  pedals: Pedal[];
}

/**
 * Group pedals by category, in signal-chain order.
 *
 * Empty categories are dropped: a library filtered to "delay" should show one
 * section, not seventeen with sixteen of them empty.
 */
export function groupPedalsByCategory(pedals: Pedal[]): PedalGroup[] {
  const byCategory = new Map<PedalCategory, Pedal[]>();
  for (const pedal of pedals) {
    const bucket = byCategory.get(pedal.category);
    if (bucket) bucket.push(pedal);
    else byCategory.set(pedal.category, [pedal]);
  }

  const groups: PedalGroup[] = [];
  for (const cat of [...PEDAL_CATEGORIES].sort((a, b) => a.defaultOrder - b.defaultOrder)) {
    const found = byCategory.get(cat.value);
    if (!found || found.length === 0) continue;
    groups.push({
      category: cat.value,
      label: cat.label,
      color: getFamilyColor(cat.family),
      pedals: found,
    });
    byCategory.delete(cat.value);
  }

  // A category present in the data but absent from PEDAL_CATEGORIES would
  // otherwise vanish from the panel entirely - a pedal you cannot add and no
  // sign that it exists. Show it last, labelled with its raw value.
  for (const [category, found] of byCategory) {
    // An unknown category has no family, so it gets the neutral one.
    groups.push({ category, label: category, color: getFamilyColor('utility'), pedals: found });
  }

  return groups;
}

/**
 * Whether a group starts open.
 *
 * Collapsed by default is the point of the change - 67 pedals in one flat list
 * is four screens of scrolling. But a collapsed group during a SEARCH is the
 * failure case: you type "kl" and the panel answers with a wall of shut
 * headers. So an active search or an explicit category choice opens what it
 * matched, and only the unfiltered browse view starts closed.
 */
export function groupStartsOpen(
  hasSearch: boolean,
  selectedCategory: string,
  groupCount: number
): boolean {
  if (hasSearch) return true;
  if (selectedCategory !== 'all') return true;
  // One group is not a list to be navigated, it IS the list.
  return groupCount === 1;
}
