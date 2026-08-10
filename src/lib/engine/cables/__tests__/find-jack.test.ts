/**
 * WHICH jack a cable attaches to, when a pedal has two of the same kind.
 *
 * `findJack` used to be `pedal.jacks?.find((j) => j.jackType === jackType)` -
 * the first row of that type in an array whose order NOTHING specifies. The
 * jacks arrive from a PostgREST embed (`jacks:pedal_jacks(*)`) with no
 * ORDER BY, and Postgres may hand back an UPDATED row in a different place
 * than before.
 *
 * This is not hypothetical and it is not merely non-deterministic. Measured
 * against the catalogue: 39 of 59 pedals carry two rows of the same
 * `jack_type` - stereo A/B pairs, guitar/bass inputs, direct-outs - and 13 of
 * them sit on the two saved boards. On the DD-7 and the EQ-200 the row that
 * came back first was `OUTPUT B`, so the board was drawing a mono patch cable
 * into the STEREO-ONLY jack.
 *
 * A positional tie-break cannot fix it, which is the trap worth recording:
 *
 *     BF-3   [OUTPUT A (MONO)] @22   [OUTPUT B] @38
 *     DD-7   [OUTPUT B] @22          [OUTPUT A (MONO)] @38
 *
 * "lowest position_percent" picks the mono jack on one and the stereo jack on
 * the other. The position does not know which jack is which; the LABEL does,
 * because it is what is silkscreened on the enclosure.
 *
 * Every one of the 39 groups is distinguishable by label, in 12 patterns, and
 * every pattern here is a real one from the catalogue with its live count.
 */
import { describe, it, expect } from 'vitest';
import type { Pedal, PedalJack } from '@/types';
import { findJack } from '../endpoints';

/** The subset findJack accepts - PedalJack['jackType'] also admits 'power'. */
type SignalJack = 'input' | 'output' | 'send' | 'return';

const jack = (jackType: SignalJack, label: string, positionPercent: number): PedalJack => ({
  id: `${label}-${positionPercent}`,
  pedalId: 'p1',
  jackType,
  side: jackType === 'input' || jackType === 'send' ? 'right' : 'left',
  positionPercent,
  label,
});

const pedalWith = (jacks: PedalJack[]): Pedal =>
  ({ id: 'p1', name: 'Test', jacks, supports4Cable: false } as unknown as Pedal);

/** Every duplicate-label pattern in the catalogue, with the jack a mono guitar rig wants. */
const PATTERNS: Array<{ n: number; type: SignalJack; a: string; b: string; want: string }> = [
  { n: 11, type: 'output', a: 'OUTPUT A (MONO)', b: 'OUTPUT B', want: 'OUTPUT A (MONO)' },
  { n: 8, type: 'input', a: 'INPUT A (MONO)', b: 'INPUT B', want: 'INPUT A (MONO)' },
  { n: 3, type: 'output', a: 'OUTPUT A/MONO', b: 'OUTPUT B', want: 'OUTPUT A/MONO' },
  { n: 3, type: 'output', a: 'LEFT OUT', b: 'RIGHT OUT', want: 'LEFT OUT' },
  { n: 2, type: 'input', a: 'BASS IN', b: 'GUITAR IN', want: 'GUITAR IN' },
  { n: 2, type: 'output', a: 'DIRECT OUT', b: 'OUTPUT', want: 'OUTPUT' },
  { n: 2, type: 'output', a: 'OUTPUT-A (MONO)', b: 'OUTPUT-B', want: 'OUTPUT-A (MONO)' },
  { n: 2, type: 'input', a: 'INPUT A/MONO', b: 'INPUT B', want: 'INPUT A/MONO' },
  { n: 2, type: 'output', a: 'BYPASS', b: 'OUTPUT', want: 'OUTPUT' },
  { n: 2, type: 'input', a: 'LEFT IN', b: 'RIGHT IN', want: 'LEFT IN' },
  { n: 1, type: 'input', a: 'INPUT-A (MONO)', b: 'INPUT-B', want: 'INPUT-A (MONO)' },
  { n: 1, type: 'output', a: 'MONO OUT', b: 'STEREO OUT', want: 'MONO OUT' },
];

describe('findJack picks the right jack of a duplicated pair', () => {
  it.each(PATTERNS)('$type: $a | $b -> $want  ($n pedals)', ({ type, a, b, want }) => {
    // Both orders, because the database order is the thing we cannot rely on.
    for (const jacks of [
      [jack(type, a, 22), jack(type, b, 38)],
      [jack(type, b, 22), jack(type, a, 38)],
    ]) {
      expect(findJack(pedalWith(jacks), type).label).toBe(want);
    }
  });

  it('is immune to input order for every pattern at once', () => {
    for (const { type, a, b, want } of PATTERNS) {
      const forward = findJack(pedalWith([jack(type, a, 22), jack(type, b, 38)]), type);
      const reversed = findJack(pedalWith([jack(type, b, 38), jack(type, a, 22)]), type);
      expect(forward.label).toBe(want);
      expect(reversed.label).toBe(want);
      expect(forward.positionPercent).toBe(reversed.positionPercent);
    }
  });

  it('falls back to a STABLE choice when no label rule applies', () => {
    // Two jacks the rules say nothing about. Whichever is chosen, it must be
    // the same one in either input order - never the array's first element.
    const x = jack('output', 'WEIRD ONE', 70);
    const y = jack('output', 'ANOTHER', 30);
    const forward = findJack(pedalWith([x, y]), 'output');
    const reversed = findJack(pedalWith([y, x]), 'output');
    expect(forward.id).toBe(reversed.id);
  });

  it('leaves a single jack exactly as it was', () => {
    const only = jack('output', 'OUTPUT B', 38);
    expect(findJack(pedalWith([only]), 'output')).toEqual(only);
  });

  it('still synthesises a jack for a pedal with no jack data', () => {
    const synthetic = findJack(pedalWith([]), 'input');
    expect(synthetic.side).toBe('right');
    expect(synthetic.positionPercent).toBe(50);
  });

  it('does not let a MONO label on the WRONG TYPE win', () => {
    // An output labelled MONO must not be returned when an input was asked for.
    const jacks = [jack('output', 'OUTPUT A (MONO)', 22), jack('input', 'INPUT B', 38)];
    expect(findJack(pedalWith(jacks), 'input').jackType).toBe('input');
  });
});
