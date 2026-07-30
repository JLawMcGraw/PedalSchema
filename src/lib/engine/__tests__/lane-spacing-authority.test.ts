import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANE_SPACING, MIN_LANE_SPACING } from '@/lib/engine/geometry';

const read = (p: string) => readFileSync(`${process.cwd()}/src/lib/engine/${p}`, 'utf8');

describe('lane spacing has exactly one authority', () => {
  it('geometry owns the values', () => {
    expect(LANE_SPACING).toBe(12);
    expect(MIN_LANE_SPACING).toBe(9);
  });

  it('neither consumer redefines them locally', () => {
    for (const f of ['lanes/index.ts', 'cables/route-cables.ts']) {
      expect(read(f)).not.toMatch(/const\s+(MIN_)?LANE_SPACING\s*=/);
    }
  });

  it('both consumers import them from geometry', () => {
    expect(read('lanes/index.ts')).toMatch(/import\s*\{[^}]*LANE_SPACING[^}]*\}\s*from\s*'\.\.\/geometry'/);
    expect(read('cables/route-cables.ts')).toMatch(/import\s*\{[^}]*LANE_SPACING[^}]*\}\s*from\s*'\.\.\/geometry'/);
  });
});
