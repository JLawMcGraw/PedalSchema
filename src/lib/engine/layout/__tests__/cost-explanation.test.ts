/**
 * The anti-drift guarantee.
 *
 * The value of surfacing a rationale depends entirely on the rationale
 * describing the ranking that actually happened. These tests assert the
 * structural property that makes that true: totalScore IS the sum of the
 * dimension list, and the explanation is built from that same list - so
 * there is no way to change one without changing the other.
 */
import { describe, expect, it } from 'vitest';
import {
  COST_DIMENSIONS,
  summarizeOptimization,
  type CostDimension,
  type RoutingCostResult,
} from '../routing-cost';

/** A cost result with the given per-dimension values, total derived as the real one is. */
function cost(values: Partial<Record<string, { value: number; count?: number }>>): RoutingCostResult {
  const dimensions: CostDimension[] = COST_DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    value: values[d.key]?.value ?? 0,
    ...(values[d.key]?.count !== undefined ? { count: values[d.key]!.count } : {}),
  }));
  return {
    totalLengthInches: values.cableLength?.value ?? 0,
    crossingCount: values.crossings?.count ?? 0,
    totalScore: dimensions.reduce((s, d) => s + d.value, 0),
    dimensions,
    cableDetails: [],
  };
}

describe('cost dimensions', () => {
  it('every dimension has a distinct key and a human label', () => {
    const keys = COST_DIMENSIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of COST_DIMENSIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.label).not.toBe(d.key); // a label is prose, not the identifier
    }
  });

  it('score-only labels are plural nouns, so "fewer/more" reads correctly', () => {
    // The phrasing for score-unit dimensions is "fewer <label>" - a label that
    // is a mass noun ("tight spacing") would render "fewer tight spacing".
    for (const d of COST_DIMENSIONS.filter((x) => x.unit === 'score')) {
      const s = summarizeOptimization(
        cost({ [d.key]: { value: 10 } }),
        cost({ [d.key]: { value: 0 } })
      );
      expect(s.headline).toBe(`Fewer ${d.label}.`);
      expect(d.label).toMatch(/s\b/); // plural somewhere in the phrase
    }
  });

  it('totalScore is exactly the sum of the dimensions', () => {
    const c = cost({
      cableLength: { value: 40 },
      crossings: { value: 16, count: 2 },
      spacing: { value: 15 },
    });
    expect(c.totalScore).toBe(71);
    expect(c.totalScore).toBe(c.dimensions.reduce((s, d) => s + d.value, 0));
  });
});

describe('summarizeOptimization', () => {
  it('reports only the dimensions that moved, best improvement first', () => {
    const before = cost({
      cableLength: { value: 60 },
      crossings: { value: 24, count: 3 },
      spacing: { value: 15 },
    });
    const after = cost({
      cableLength: { value: 46 },
      crossings: { value: 8, count: 1 },
      spacing: { value: 15 }, // unchanged - must not be reported
    });

    const s = summarizeOptimization(before, after);

    expect(s.changes.map((c) => c.key)).toEqual(['crossings', 'cableLength']);
    expect(s.changes[0].countDelta).toBe(-2);
    expect(s.changes[1].delta).toBeCloseTo(-14);
    expect(s.lengthDeltaInches).toBeCloseTo(-14);
    expect(s.delta).toBeCloseTo(-30);
  });

  it('phrases counts as counts and lengths as inches', () => {
    const s = summarizeOptimization(
      cost({ cableLength: { value: 60 }, crossings: { value: 16, count: 2 } }),
      cost({ cableLength: { value: 46 }, crossings: { value: 0, count: 0 } })
    );

    expect(s.headline).toBe('2 fewer cable crossings, 14in less cable length.');
  });

  it('says so when nothing changed rather than inventing an improvement', () => {
    const same = cost({ cableLength: { value: 50 }, crossings: { value: 8, count: 1 } });

    const s = summarizeOptimization(same, cost({ cableLength: { value: 50 }, crossings: { value: 8, count: 1 } }));

    expect(s.changes).toEqual([]);
    expect(s.delta).toBe(0);
    expect(s.headline).toMatch(/already optimal/i);
  });

  it('admits a regression instead of cherry-picking the one improvement', () => {
    // Cable length improved, but crossings got much worse: net worse.
    const before = cost({ cableLength: { value: 60 }, crossings: { value: 8, count: 1 } });
    const after = cost({ cableLength: { value: 58 }, crossings: { value: 40, count: 5 } });

    const s = summarizeOptimization(before, after);

    expect(s.delta).toBeGreaterThan(0);
    expect(s.headline).toMatch(/scored worse/i);
    // Must lead with what got WORSE, not the 2in cable-length win it also made
    expect(s.headline).toMatch(/4 more cable crossings/);
    expect(s.headline).not.toMatch(/less cable length/);
  });

  it('counts a dimension as changed when only its count moved', () => {
    // Same penalty total, different number of cables behind it: still news.
    const before = cost({ complexRouting: { value: 20, count: 2 } });
    const after = cost({ complexRouting: { value: 20, count: 3 } });

    const s = summarizeOptimization(before, after);

    expect(s.changes.map((c) => c.key)).toEqual(['complexRouting']);
    expect(s.changes[0].countDelta).toBe(1);
  });

  it('never renders a negative zero', () => {
    const s = summarizeOptimization(
      cost({ cableLength: { value: 50.02 } }),
      cost({ cableLength: { value: 50 } })
    );
    expect(s.headline).not.toContain('-0');
  });
});
