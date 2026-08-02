import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANE_SPACING, MIN_LANE_SPACING, LANE_TOLERANCE } from '@/lib/engine/geometry';

const read = (p: string) => readFileSync(`${process.cwd()}/src/lib/engine/${p}`, 'utf8');

describe('lane spacing has exactly one authority', () => {
  it('geometry owns the values', () => {
    expect(LANE_SPACING).toBe(12);
    expect(MIN_LANE_SPACING).toBe(9);
    expect(LANE_TOLERANCE).toBe(9);
  });

  /**
   * The separation pass accepts a shift once runs are LANE_TOLERANCE apart;
   * laneViolations calls anything under MIN_LANE_SPACING a violation. If
   * acceptance sits above the floor, the pass can declare success while still
   * a pixel from a violation - which is exactly what happened when
   * route-cables declared LANE_TOLERANCE = 10 locally against a floor of 9.
   */
  it('acceptance is never looser than the invariant it is judged by', () => {
    expect(LANE_TOLERANCE).toBeGreaterThanOrEqual(MIN_LANE_SPACING);
  });

  it('neither consumer redefines them locally', () => {
    for (const f of ['lanes/index.ts', 'cables/route-cables.ts']) {
      expect(read(f)).not.toMatch(/const\s+(MIN_)?LANE_SPACING\s*=/);
      expect(read(f)).not.toMatch(/const\s+LANE_TOLERANCE\s*=/);
    }
  });

  it('both consumers import them from geometry', () => {
    expect(read('lanes/index.ts')).toMatch(/import\s*\{[^}]*LANE_SPACING[^}]*\}\s*from\s*'\.\.\/geometry'/);
    expect(read('cables/route-cables.ts')).toMatch(/import\s*\{[^}]*LANE_SPACING[^}]*\}\s*from\s*'\.\.\/geometry'/);
  });
});
