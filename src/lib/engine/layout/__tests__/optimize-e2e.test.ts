/**
 * End-to-end: run the real optimizer on a real board and check that the
 * reported explanation matches the scores it actually chose with.
 */
import { describe, expect, it } from 'vitest';
import { calculateOptimalLayoutJoint } from '../index';
import { summarizeOptimization } from '../routing-cost';
import type { Board, Pedal, PlacedPedal } from '@/types';

const board: Board = {
  id: 'b1', name: 'Test', widthInches: 24, depthInches: 12,
  railWidthInches: 0.6, isSystem: true,
} as Board;

function pedal(id: string, category: string): Pedal {
  return {
    id, name: id, manufacturer: 'T', category,
    widthInches: 2.9, depthInches: 5.1, heightInches: 2.3,
    voltage: 9, currentMa: 10, isSystem: true,
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
      { jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
    ],
  } as unknown as Pedal;
}

/** Pedals deliberately scattered so optimizing has something to fix */
function scattered(): { placed: PlacedPedal[]; byId: Record<string, Pedal> } {
  const specs = [
    ['tuner', 'tuner', 18, 6], ['od', 'overdrive', 3, 1],
    ['dist', 'distortion', 15, 0.5], ['delay', 'delay', 1, 6],
    ['verb', 'reverb', 9, 3],
  ] as const;
  const byId: Record<string, Pedal> = {};
  const placed = specs.map(([id, cat, x, y], i) => {
    byId[id] = pedal(id, cat);
    return {
      id, pedalId: id, pedal: byId[id], xInches: x, yInches: y,
      rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
    } as unknown as PlacedPedal;
  });
  return { placed, byId };
}

describe('optimize end-to-end', () => {
  it('returns both costs, and the reported total is the sum of its dimensions', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);

    expect(result.baselineCost).toBeDefined();
    expect(result.cost).toBeDefined();

    for (const c of [result.baselineCost!, result.cost!]) {
      const sum = c.dimensions.reduce((s, d) => s + d.value, 0);
      expect(c.totalScore).toBeCloseTo(sum, 6);
      expect(c.dimensions.length).toBeGreaterThan(0);
    }
  });

  it('baseline scores the board as the user left it, not a re-placed one', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);

    // The baseline's cable length must reflect the scattered input. If it had
    // been computed from a greedy re-placement it would match the optimized
    // length, and the whole before/after comparison would be meaningless.
    expect(result.baselineCost!.totalLengthInches).not.toBeCloseTo(
      result.cost!.totalLengthInches, 3
    );
  });

  it('every routed cable records which strategy produced it', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);
    const details = result.cost!.cableDetails;

    expect(details.length).toBeGreaterThan(0);
    const known = new Set([
      'facing', 'direct', 'l-horizontal', 'l-vertical', 'channel',
      'above', 'below', 'safe-lane', 'astar', 'fallback-invalid',
    ]);
    for (const d of details) expect(known).toContain(d.strategy);
  });

  it('the summary describes the same numbers the optimizer compared', () => {
    const { placed, byId } = scattered();

    const result = calculateOptimalLayoutJoint(placed, byId, board);
    const s = summarizeOptimization(result.baselineCost!, result.cost!);

    expect(s.before).toBe(result.baselineCost!.totalScore);
    expect(s.after).toBe(result.cost!.totalScore);
    expect(s.delta).toBeCloseTo(result.cost!.totalScore - result.baselineCost!.totalScore, 6);
    // Each reported change must equal the actual per-dimension difference
    for (const c of s.changes) {
      const b = result.baselineCost!.dimensions.find((d) => d.key === c.key)!;
      const a = result.cost!.dimensions.find((d) => d.key === c.key)!;
      expect(c.delta).toBeCloseTo(a.value - b.value, 6);
    }
    expect(s.headline.length).toBeGreaterThan(0);
  });

  it('re-optimizing an already-optimized board reports no change', () => {
    const { placed, byId } = scattered();
    const first = calculateOptimalLayoutJoint(placed, byId, board);

    // Feed the optimized positions back in
    const settled = placed.map((p) => {
      const pl = first.placements.find((q) => q.id === p.id)!;
      return { ...p, xInches: pl.x, yInches: pl.y };
    });
    const second = calculateOptimalLayoutJoint(settled, byId, board);
    const s = summarizeOptimization(second.baselineCost!, second.cost!);

    expect(s.delta).toBeCloseTo(0, 6);
    expect(s.headline).toMatch(/already optimal/i);
  });
});

describe('optimize never returns a worse layout', () => {
  /** A board is "legal" when nothing overlaps and everything is on it. */
  const boards = {
    scattered,
    tidyRow: () => {
      const byId: Record<string, Pedal> = {};
      const cats = ['tuner', 'overdrive', 'distortion', 'delay', 'reverb'];
      const placed = cats.map((cat, i) => {
        const id = `p${i}`;
        byId[id] = pedal(id, cat);
        return {
          id, pedalId: id, pedal: byId[id],
          xInches: 19 - i * 3.4, yInches: 3,
          rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
        } as unknown as PlacedPedal;
      });
      return { placed, byId };
    },
  };

  for (const [name, build] of Object.entries(boards)) {
    it(`${name}: result score <= baseline score`, () => {
      const { placed, byId } = build();

      const r = calculateOptimalLayoutJoint(placed, byId, board);

      // THE invariant this fix establishes. Before it, the search was seeded
      // with a greedy re-placement, so a hand-tuned board could be replaced
      // by something strictly worse.
      expect(r.cost!.totalScore).toBeLessThanOrEqual(r.baselineCost!.totalScore + 1e-9);
    });
  }

  it('keeps the incumbent placements exactly when nothing beats them', () => {
    const { placed, byId } = boards.tidyRow();
    const first = calculateOptimalLayoutJoint(placed, byId, board);

    // Feed the optimized board back in
    const settled = placed.map((p) => {
      const pl = first.placements.find((q) => q.id === p.id)!;
      return { ...p, xInches: pl.x, yInches: pl.y };
    });
    const second = calculateOptimalLayoutJoint(settled, byId, board);

    // Not merely "an equal score" - the SAME coordinates, proving the
    // incumbent was kept rather than coincidentally recomputed
    for (const p of settled) {
      const out = second.placements.find((q) => q.id === p.id)!;
      expect(out.x, `${p.id} x moved`).toBe(p.xInches);
      expect(out.y, `${p.id} y moved`).toBe(p.yInches);
    }
    expect(summarizeOptimization(second.baselineCost!, second.cost!).delta).toBe(0);
  });

  it('still re-places a board whose pedals overlap', () => {
    // Every pedal stacked at the origin: scores well on cable length (they
    // are all touching) but is illegal, so the baseline must be rejected.
    const { placed, byId } = boards.tidyRow();
    const piled = placed.map((p) => ({ ...p, xInches: 0, yInches: 0 }));

    const r = calculateOptimalLayoutJoint(piled, byId, board);

    const moved = r.placements.filter((pl) => pl.x !== 0 || pl.y !== 0);
    expect(moved.length, 'a colliding pile must be re-placed, not kept').toBeGreaterThan(0);
  });
});

describe('optimize never returns an illegal layout', () => {
  /** True when any pedal overlaps another or leaves the board. */
  function illegal(placements: Array<{ id: string; x: number; y: number }>, b: Board) {
    const W = 2.9;
    const H = 5.1;
    for (const p of placements) {
      if (p.x < -0.01 || p.y < -0.01 || p.x + W > b.widthInches + 0.01 || p.y + H > b.depthInches + 0.01) {
        return true;
      }
    }
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i];
        const c = placements[j];
        const ox = Math.min(a.x + W, c.x + W) - Math.max(a.x, c.x);
        const oy = Math.min(a.y + H, c.y + H) - Math.max(a.y, c.y);
        if (ox > 0.01 && oy > 0.01) return true;
      }
    }
    return false;
  }

  /** n pedals hand-packed into rows on a tight board - legal by construction. */
  function tightBoard(n: number, widthInches: number, depthInches: number) {
    const b = {
      id: 'b', name: 'Tight', widthInches, depthInches, railWidthInches: 0.6, isSystem: true,
    } as Board;
    const cats = ['tuner', 'overdrive', 'distortion', 'fuzz', 'boost', 'delay', 'reverb', 'modulation'];
    const byId: Record<string, Pedal> = {};
    const perRow = Math.max(1, Math.floor(widthInches / 3.0));
    const placed = cats.slice(0, n).map((c, i) => {
      const id = `p${i}`;
      byId[id] = pedal(id, c);
      return {
        id, pedalId: id, pedal: byId[id],
        xInches: (i % perRow) * 3.0,
        yInches: Math.floor(i / perRow) * 5.4,
        rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
      } as unknown as PlacedPedal;
    });
    return { board: b, placed, byId };
  }

  // Cases found by probing tight boards. Each one previously came back with
  // pedals overlapping or off the board, scoring BETTER than the legal input
  // because the routing cost has no overlap term - stacked pedals have very
  // short cables. The early-return path returned greedy unconditionally, with
  // no collision guard at all.
  const cases: Array<[number, number, number]> = [
    [4, 12, 6],
    [5, 9, 11],
    [6, 9, 11],
    [7, 12, 11],
    [8, 12, 11],
  ];

  for (const [n, w, h] of cases) {
    it(`${n} pedals on a ${w}x${h} board: legal in, legal out`, () => {
      const { board: b, placed, byId } = tightBoard(n, w, h);
      const input = placed.map((p) => ({ id: p.id, x: p.xInches, y: p.yInches }));
      expect(illegal(input, b), 'fixture itself must be legal').toBe(false);

      const r = calculateOptimalLayoutJoint(placed, byId, b);

      expect(illegal(r.placements, b), 'optimize produced overlapping/off-board pedals').toBe(false);
    });
  }
});
