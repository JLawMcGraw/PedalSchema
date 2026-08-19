/**
 * The order here is the one a player thinks in, not the one the rows arrive
 * in and not alphabetical - getting it wrong looks like a working panel with
 * the reverbs above the overdrives.
 */
import { describe, it, expect } from 'vitest';
import { groupPedalsByCategory, groupStartsOpen } from '../pedal-grouping';
import type { Pedal, PedalCategory } from '@/types';

const pedal = (name: string, category: PedalCategory): Pedal =>
  ({ id: name, name, manufacturer: 'Acme', category } as unknown as Pedal);

describe('groupPedalsByCategory', () => {
  it('orders groups by signal chain, not by input order or the alphabet', () => {
    const groups = groupPedalsByCategory([
      pedal('Blue Sky', 'reverb'),
      pedal('Tube Screamer', 'overdrive'),
      pedal('Polytune', 'tuner'),
      pedal('Timeline', 'delay'),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      'tuner',
      'overdrive',
      'delay',
      'reverb',
    ]);
  });

  it('keeps every pedal, and puts each in exactly one group', () => {
    const input = [
      pedal('a', 'delay'),
      pedal('b', 'delay'),
      pedal('c', 'fuzz'),
    ];
    const groups = groupPedalsByCategory(input);
    const flat = groups.flatMap((g) => g.pedals);
    expect(flat).toHaveLength(input.length);
    expect(new Set(flat.map((p) => p.id)).size).toBe(input.length);
  });

  it('drops empty categories rather than listing seventeen with one filled', () => {
    const groups = groupPedalsByCategory([pedal('Timeline', 'delay')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Delay');
  });

  it('preserves the order pedals arrived in WITHIN a group', () => {
    // The caller sorts by manufacturer then name; grouping must not disturb it.
    const groups = groupPedalsByCategory([
      pedal('zebra', 'delay'),
      pedal('alpha', 'delay'),
    ]);
    expect(groups[0].pedals.map((p) => p.name)).toEqual(['zebra', 'alpha']);
  });

  it('still shows a category that is missing from PEDAL_CATEGORIES', () => {
    // Otherwise a migration adding an enum member makes those pedals
    // unreachable, with nothing on screen to say they exist.
    const groups = groupPedalsByCategory([
      pedal('Timeline', 'delay'),
      pedal('Weird', 'sub_octave' as PedalCategory),
    ]);
    expect(groups.map((g) => g.category)).toContain('sub_octave');
    expect(groups.flatMap((g) => g.pedals)).toHaveLength(2);
    // and it goes last, after everything known
    expect(groups[groups.length - 1].category).toBe('sub_octave');
  });

  it('returns nothing for nothing', () => {
    expect(groupPedalsByCategory([])).toEqual([]);
  });
});

describe('groupStartsOpen', () => {
  it('opens everything during a search', () => {
    // The failure this prevents: type "kl", get a wall of shut headers.
    expect(groupStartsOpen(true, 'all', 12)).toBe(true);
  });

  it('opens when a category has been chosen explicitly', () => {
    expect(groupStartsOpen(false, 'delay', 1)).toBe(true);
  });

  it('starts closed for the unfiltered browse view', () => {
    expect(groupStartsOpen(false, 'all', 12)).toBe(false);
  });

  it('opens a lone group - one section is not a list, it is the list', () => {
    expect(groupStartsOpen(false, 'all', 1)).toBe(true);
  });
});
