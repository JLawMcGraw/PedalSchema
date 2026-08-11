/**
 * Does every pedal in the LIVE catalogue resolve its jacks by a rule?
 *
 * `find-jack.test.ts` pins the twelve label patterns that existed on
 * 2026-08-10. This is the other half: it runs the real scoring over the real
 * catalogue and fails when a pedal turns up that none of those patterns cover.
 *
 * The failure it exists to catch is NOT "no jack found" - `findJack` always
 * returns one. It is "no RULE matched, so POSITION broke the tie", and the
 * DD-7 is standing proof that position gets it backwards:
 *
 *     BF-3   [OUTPUT A (MONO)] @22   [OUTPUT B] @38     lowest is right
 *     DD-7   [OUTPUT B] @22          [OUTPUT A (MONO)] @38   lowest is WRONG
 *
 * `/pedals/new` lets a user type any label they like, so this is a matter of
 * when rather than whether. When it fires, the fix is to add the pattern to
 * `monoAffinity` and to `find-jack.test.ts` - not to relax this check.
 *
 * Skipped without PEDAL_ALL_PEDALS, so CI and the normal suite are unaffected:
 *
 *   node .claude/scripts/dump-pedals-offline.js /tmp/pedals.json
 *   PEDAL_ALL_PEDALS=/tmp/pedals.json npx vitest run jack-resolution-catalogue
 *
 * A vitest file rather than a plain node script for the reason
 * saved-board-fingerprint.test.ts documents: vitest is the only TypeScript
 * runner this repo has, and importing the REAL `monoAffinity` is the whole
 * point. A script restating the scoring would be free to drift from the router
 * it claims to be checking.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type { Pedal, PedalJack } from '@/types';
import { findJack, monoAffinity } from '../endpoints';

const DUMP = process.env.PEDAL_ALL_PEDALS;

type SignalJack = 'input' | 'output' | 'send' | 'return';
const SIGNAL_TYPES: SignalJack[] = ['input', 'output', 'send', 'return'];

interface Group {
  pedal: string;
  type: SignalJack;
  candidates: PedalJack[];
  chosen: PedalJack;
}

function duplicateGroups(pedals: Pedal[]): Group[] {
  const groups: Group[] = [];
  for (const pedal of pedals) {
    for (const type of SIGNAL_TYPES) {
      const candidates = (pedal.jacks ?? []).filter((j) => j.jackType === type);
      if (candidates.length < 2) continue;
      groups.push({ pedal: pedal.name, type, candidates, chosen: findJack(pedal, type) });
    }
  }
  return groups;
}

describe.skipIf(!DUMP)('jack resolution over the live catalogue', () => {
  const pedals: Pedal[] = DUMP ? JSON.parse(fs.readFileSync(DUMP, 'utf8')) : [];

  it('resolves every duplicated jack group by a LABEL rule, never by position', () => {
    const groups = duplicateGroups(pedals);
    const unmatched = groups.filter((g) => monoAffinity(g.chosen.label) <= 0);

    // Reported in full, because the useful output of a failure here is the
    // pattern to go and add - not the count.
    for (const g of unmatched) {
      console.log(
        `  UNMATCHED  ${g.pedal} ${g.type}: ` +
        g.candidates.map((c) => `[${c.label}]@${c.positionPercent}`).join('  ') +
        `  -> chose [${g.chosen.label}] on position alone`
      );
    }
    console.log(`\n  duplicate groups: ${groups.length}   resolved by a label rule: ${groups.length - unmatched.length}   unmatched: ${unmatched.length}`);

    expect(groups.length).toBeGreaterThan(0); // the dump loaded and has jacks
    expect(unmatched).toEqual([]);
  });

  it('never picks a jack the label scores NEGATIVE when a better one exists', () => {
    // Stronger than the check above and independent of it: whatever rule fired,
    // the chosen jack must not be one the scoring actively rejects - a RIGHT,
    // a STEREO or a BASS jack - while a sibling scores higher.
    const wrong = duplicateGroups(pedals).filter((g) => {
      const best = Math.max(...g.candidates.map((c) => monoAffinity(c.label)));
      return monoAffinity(g.chosen.label) < best;
    });
    expect(wrong.map((g) => `${g.pedal} ${g.type} -> ${g.chosen.label}`)).toEqual([]);
  });

  it('is stable under any input order', () => {
    // The array order is the thing that cannot be trusted; prove the answer
    // does not depend on it, over real data rather than a fixture.
    for (const pedal of pedals) {
      for (const type of SIGNAL_TYPES) {
        const jacks = (pedal.jacks ?? []).filter((j) => j.jackType === type);
        if (jacks.length < 2) continue;
        const forward = findJack(pedal, type);
        const reversed = findJack({ ...pedal, jacks: [...(pedal.jacks ?? [])].reverse() }, type);
        expect(`${pedal.name}:${forward.id}`).toBe(`${pedal.name}:${reversed.id}`);
      }
    }
  });
});
