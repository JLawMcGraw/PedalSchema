/**
 * Runs the self-declaring corpus through the REAL detector and enforces
 * coverage in both directions:
 *   - no false negative: every specimen produces the status it declares
 *   - no blind spot: every status in the union has at least one specimen
 *
 * Adding a status to KnockoutStatus without a fixture fails the build here,
 * so the corpus cannot quietly fall behind the detector.
 */
import { describe, expect, it } from 'vitest';
import { knockOutBackground, type KnockoutStatus } from '../knockout';
import { ALL_STATUSES, SPECIMENS } from './fixtures';

describe('knockout corpus', () => {
  it.each(SPECIMENS.map((s) => [s.name, s] as const))(
    'produces the declared status: %s',
    (_name, specimen) => {
      const { status } = knockOutBackground(specimen.build());
      expect(status, specimen.why).toBe(specimen.expected);
    }
  );

  it('every status has at least one specimen', () => {
    const covered = new Set(SPECIMENS.map((s) => s.expected));
    const missing = (Object.keys(ALL_STATUSES) as KnockoutStatus[]).filter(
      (s) => !covered.has(s)
    );
    expect(missing, `statuses with no fixture: ${missing.join(', ')}`).toEqual([]);
  });

  it('every specimen explains why it exists', () => {
    for (const s of SPECIMENS) {
      expect(s.why.length, `${s.name} has no rationale`).toBeGreaterThan(20);
    }
  });

  it('only a knocked-out result actually changes pixels', () => {
    // The non-'knocked-out' statuses all mean "we did not touch this image".
    // If one of them started mutating alpha, uploads would silently degrade.
    for (const s of SPECIMENS.filter((x) => x.expected !== 'knocked-out')) {
      const input = s.build();
      const before = new Uint8ClampedArray(input.data);
      const { image: out, knocked } = knockOutBackground(input);
      expect(knocked, `${s.name} reported knocked pixels`).toBe(0);
      expect(out.data, `${s.name} mutated pixels`).toEqual(before);
    }
  });
});
