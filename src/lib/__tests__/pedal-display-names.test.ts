import { describe, it, expect } from 'vitest';
import {
  derivePedalDisplayNames,
  displayNameFor,
  ORDINAL_SEPARATOR,
} from '@/lib/pedal-display-names';
import type { Pedal, PlacedPedal } from '@/types';

function placed(id: string, pedalId: string, chainPosition: number): PlacedPedal {
  return {
    id, pedalId, xInches: 0, yInches: 0, rotationDegrees: 0,
    chainPosition, location: 'front_of_amp', isActive: true,
  } as unknown as PlacedPedal;
}

const catalogue = (entries: Record<string, string>): Record<string, Pedal> =>
  Object.fromEntries(
    Object.entries(entries).map(([id, name]) => [id, { id, name } as unknown as Pedal])
  );

describe('derivePedalDisplayNames', () => {
  it('leaves a unique name alone', () => {
    const names = derivePedalDisplayNames(
      [placed('a', 'p1', 1), placed('b', 'p2', 2)],
      catalogue({ p1: 'PW-3', p2: 'OC-5' })
    );
    expect(names.get('a')).toMatchObject({ display: 'PW-3', ordinal: null, total: 1 });
    expect(names.get('b')!.display).toBe('OC-5');
  });

  it('numbers repeats, and only repeats', () => {
    const names = derivePedalDisplayNames(
      [placed('a', 'p1', 1), placed('b', 'p1', 2), placed('c', 'p2', 3)],
      catalogue({ p1: 'CS-3', p2: 'OC-5' })
    );
    expect(names.get('a')!.display).toBe(`CS-3${ORDINAL_SEPARATOR}1`);
    expect(names.get('b')!.display).toBe(`CS-3${ORDINAL_SEPARATOR}2`);
    expect(names.get('c')!.display).toBe('OC-5');
    expect(names.get('c')!.ordinal).toBeNull();
  });

  /*
   * THE REASON THIS MODULE EXISTS. The Chain panel iterates chain order and
   * the Cables list iterates cable order. If the ordinal came from the order
   * the caller happened to pass, "CS-3 · 2" would name one pedal in one panel
   * and the other pedal in the other - a distinction that is invented and then
   * wrong. Same input, shuffled, must give the same answer per pedal.
   */
  it('numbers by chain position regardless of the order it is handed', () => {
    const pedals = catalogue({ p1: 'CS-3' });
    const forwards = [placed('early', 'p1', 1), placed('late', 'p1', 9)];
    const backwards = [placed('late', 'p1', 9), placed('early', 'p1', 1)];

    for (const input of [forwards, backwards]) {
      const names = derivePedalDisplayNames(input, pedals);
      expect(names.get('early')!.ordinal).toBe(1);
      expect(names.get('late')!.ordinal).toBe(2);
    }
  });

  it('counts three of a kind', () => {
    const names = derivePedalDisplayNames(
      [placed('a', 'p1', 1), placed('b', 'p1', 2), placed('c', 'p1', 3)],
      catalogue({ p1: 'DS-1' })
    );
    expect([...names.values()].map((n) => n.display)).toEqual([
      `DS-1${ORDINAL_SEPARATOR}1`, `DS-1${ORDINAL_SEPARATOR}2`, `DS-1${ORDINAL_SEPARATOR}3`,
    ]);
    expect(names.get('b')!.total).toBe(3);
  });

  it('treats two catalogue entries sharing a name as duplicates', () => {
    // Same model re-imported under a second id is a real state in this
    // database. It is the NAME that is ambiguous on screen, not the id.
    const names = derivePedalDisplayNames(
      [placed('a', 'p1', 1), placed('b', 'p2', 2)],
      catalogue({ p1: 'CS-3', p2: 'CS-3' })
    );
    expect(names.get('a')!.display).toBe(`CS-3${ORDINAL_SEPARATOR}1`);
    expect(names.get('b')!.display).toBe(`CS-3${ORDINAL_SEPARATOR}2`);
  });

  it('skips a pedal whose catalogue entry has not loaded', () => {
    const names = derivePedalDisplayNames(
      [placed('a', 'p1', 1), placed('ghost', 'missing', 2)],
      catalogue({ p1: 'PW-3' })
    );
    expect(names.has('ghost')).toBe(false);
    expect(names.get('a')!.display).toBe('PW-3');
  });

  it('falls back to the bare model name for an unknown id', () => {
    const names = derivePedalDisplayNames([], {});
    expect(displayNameFor(names, 'nobody', 'CS-3')).toBe('CS-3');
  });

  it('reads the name off the embedded pedal when the lookup misses', () => {
    const p = placed('a', 'p1', 1) as PlacedPedal;
    (p as PlacedPedal).pedal = { id: 'p1', name: 'GE-7' } as unknown as Pedal;
    const names = derivePedalDisplayNames([p], {});
    expect(names.get('a')!.display).toBe('GE-7');
  });
});
