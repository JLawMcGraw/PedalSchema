import type { Pedal, PlacedPedal } from '@/types';

/**
 * What to CALL each pedal on a board, when two of them are the same model.
 *
 * Two of a model is common - the `test` board has two CS-3s - and a bare model
 * name then identifies neither of them. The chain panel solved this locally;
 * so, differently, did the library rail's roster; and the Cables list did not
 * solve it at all, which is why it still read "CS-3 -> CS-3". Three call sites,
 * one question.
 *
 * THE ORDINALS COME FROM CHAIN POSITION, ALWAYS, AND THAT IS THE POINT.
 * A caller iterating cables and a caller iterating the chain would otherwise
 * number the same two pedals differently, and "CS-3 · 2" would mean one pedal
 * in the Chain panel and the other in Cables. Disambiguation that disagrees
 * with itself is worse than none: it invents a distinction and then gets it
 * wrong. So this sorts by `chainPosition` internally and ignores the order it
 * was handed.
 *
 * Only repeated names get a suffix. The common case stays clean.
 */
export interface PedalDisplayName {
  /** The catalogue model name, unchanged. */
  name: string;
  /** 1-based, in chain order, among pedals sharing this name. null when unique. */
  ordinal: number | null;
  /** How many pedals on this board share this name. */
  total: number;
  /** What to render: `name`, or `name · ordinal` when total > 1. */
  display: string;
}

/** The separator between a model name and its ordinal. */
export const ORDINAL_SEPARATOR = ' · ';

const nameOf = (
  placed: PlacedPedal,
  pedalsById: Record<string, Pedal>
): string | null => pedalsById[placed.pedalId]?.name ?? placed.pedal?.name ?? null;

/**
 * Keyed by PLACED pedal id (`placed.id`), not catalogue pedal id - the whole
 * problem is telling two rows with the same catalogue id apart.
 *
 * A placed pedal whose catalogue entry has not loaded yet is skipped rather
 * than given a placeholder: it has no name to be ambiguous about, and a
 * transient "undefined · 1" is a worse answer than no entry.
 */
export function derivePedalDisplayNames(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): Map<string, PedalDisplayName> {
  const inChainOrder = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);

  const total = new Map<string, number>();
  for (const placed of inChainOrder) {
    const name = nameOf(placed, pedalsById);
    if (name) total.set(name, (total.get(name) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const out = new Map<string, PedalDisplayName>();
  for (const placed of inChainOrder) {
    const name = nameOf(placed, pedalsById);
    if (!name) continue;
    const count = total.get(name) ?? 0;
    if (count > 1) {
      const ordinal = (seen.get(name) ?? 0) + 1;
      seen.set(name, ordinal);
      out.set(placed.id, {
        name,
        ordinal,
        total: count,
        display: `${name}${ORDINAL_SEPARATOR}${ordinal}`,
      });
    } else {
      out.set(placed.id, { name, ordinal: null, total: 1, display: name });
    }
  }
  return out;
}

/**
 * The display name for one placed pedal, for callers that have a map already.
 * Falls back to the bare model name so a missing entry degrades to today's
 * behaviour rather than to an empty string.
 */
export function displayNameFor(
  names: Map<string, PedalDisplayName>,
  placedPedalId: string,
  fallback: string
): string {
  return names.get(placedPedalId)?.display ?? fallback;
}
