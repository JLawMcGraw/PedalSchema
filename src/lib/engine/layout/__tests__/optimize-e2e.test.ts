/**
 * End-to-end: run the real optimizer on a real board and check that the
 * reported explanation matches the scores it actually chose with.
 */
import { describe, expect, it } from 'vitest';
import { calculateGreedyPlacement, calculateOptimalLayoutJoint } from '../index';
import { summarizeOptimization } from '../routing-cost';
import { ROUTING_STRATEGIES } from '../../cables/routing-strategies';
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
    // Derived from the strategy declaration, never hand-listed. The previous
    // hardcoded set omitted 'perimeter' and passed only because no fixture
    // board needed one - a stale test list masquerading as a passing check.
    // 'lane-router' is not a cascade strategy, so it is added explicitly.
    const known = new Set<string>([...ROUTING_STRATEGIES, 'lane-router']);
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

describe('when nothing legal can be placed', () => {
  it('says so instead of claiming the board is already optimal', () => {
    // 21 standard pedals on a Pedaltrain Classic Jr (18x12.5in): two rows of
    // five is a real capacity of ~10, so no legal arrangement exists. That is
    // NOT "already optimal" - saying so would tell the user their overloaded
    // board is fine when the optimizer simply could not place it.
    //
    // NB this deliberately uses the SMALL board. On a 32x16 Classic Pro these
    // 21 now fit, since row count is derived from board depth.
    const cats = [
      'wah', 'compressor', 'compressor', 'compressor', 'pitch', 'pitch',
      'distortion', 'distortion', 'distortion', 'distortion', 'fuzz', 'utility',
      'eq', 'eq', 'eq', 'modulation', 'phaser', 'delay', 'delay', 'delay', 'utility',
    ];
    const byId: Record<string, Pedal> = {};
    const small = {
      id: 'b', name: 'Classic Jr', widthInches: 18, depthInches: 12.5,
      railWidthInches: 0.6, isSystem: true,
    } as Board;
    const placed = cats.map((c, i) => {
      const id = `p${i}`;
      byId[id] = pedal(id, c);
      return {
        id, pedalId: id, pedal: byId[id],
        xInches: (i % 10) * 3.0, yInches: Math.floor(i / 10) * 5.4,
        rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
      } as unknown as PlacedPedal;
    });

    const r = calculateOptimalLayoutJoint(placed, byId, small);
    const s = summarizeOptimization(r.baselineCost!, r.cost!, r.noLegalCandidate);

    expect(r.noLegalCandidate).toBe(true);
    expect(s.headline).not.toMatch(/already optimal/i);
    expect(s.headline).toMatch(/could not fit/i);
  });
});


describe('row count follows board depth', () => {
  /** Distinct row y-positions the placer actually used. */
  const rowsUsed = (pl: Array<{ y: number }>) =>
    [...new Set(pl.map((p) => Math.round(p.y * 10) / 10))].sort((a, b) => a - b);

  function board(widthInches: number, depthInches: number) {
    return { id: 'b', name: 'B', widthInches, depthInches, railWidthInches: 0.6, isSystem: true } as Board;
  }
  function pedals(n: number) {
    const cats = ['wah', 'compressor', 'pitch', 'distortion', 'fuzz', 'utility', 'eq', 'modulation', 'delay'];
    const byId: Record<string, Pedal> = {};
    const placed = Array.from({ length: n }, (_, i) => {
      const id = `p${i}`;
      byId[id] = pedal(id, cats[i % cats.length]);
      return {
        id, pedalId: id, pedal: byId[id],
        xInches: (i % 9) * 3.4, yInches: Math.floor(i / 9) * 5.4,
        rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
      } as unknown as PlacedPedal;
    });
    return { placed, byId };
  }

  it('uses a third row on a 16in-deep board when the pedals need one', () => {
    // The bug: rows were hardcoded to two at 55%/5% of depth regardless of
    // how deep the board was, capping a 32x16 Classic Pro at 18 pedals and
    // wasting 2.1in at the back. 20 pedals then had no legal placement.
    const b = board(32, 16);
    const { placed, byId } = pedals(20);

    const placements = calculateGreedyPlacement(placed, byId, b, undefined);

    expect(rowsUsed(placements).length).toBe(3);
    // and every pedal is legally placed
    const W = 2.9;
    const H = 5.1;
    for (const p of placements) {
      expect(p.x).toBeGreaterThanOrEqual(-0.01);
      expect(p.y).toBeGreaterThanOrEqual(-0.01);
      expect(p.x + W).toBeLessThanOrEqual(b.widthInches + 0.01);
      expect(p.y + H).toBeLessThanOrEqual(b.depthInches + 0.01);
    }
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i];
        const c = placements[j];
        const ox = Math.min(a.x + W, c.x + W) - Math.max(a.x, c.x);
        const oy = Math.min(a.y + H, c.y + H) - Math.max(a.y, c.y);
        expect(ox > 0.01 && oy > 0.01, `${a.id} overlaps ${c.id}`).toBe(false);
      }
    }
  });

  it('does not invent rows a shallow board cannot hold', () => {
    // 12.5in holds exactly two rows of 5.1in pedals - a third would hang off.
    const { placed, byId } = pedals(10);
    expect(rowsUsed(calculateGreedyPlacement(placed, byId, board(18, 12.5), undefined)).length)
      .toBeLessThanOrEqual(2);
  });

  it('does not spread onto more rows than the pedals need', () => {
    // 8 pedals fit one row of a 32in board; using three would stretch cables.
    const { placed, byId } = pedals(8);
    expect(rowsUsed(calculateGreedyPlacement(placed, byId, board(32, 16), undefined)).length)
      .toBeLessThanOrEqual(2);
  });
});

describe('one deep pedal does not collapse the board', () => {
  it('derives rows from typical depth, not the deepest outlier', () => {
    // A real saved config: eighteen 2.87x5.08 pedals, one 3.98x5.43, one
    // 3.15x7.56. Sizing every row for the 7.56in outlier gave TWO rows and no
    // legal placement, so Optimize refused to act on a board arrangeable by
    // hand. Row sizing now uses the 80th-percentile depth, so the outlier
    // straddles bands instead of dictating all of them.
    const b = {
      id: 'b', name: 'Classic Pro', widthInches: 32, depthInches: 16,
      railWidthInches: 0.6, isSystem: true,
    } as Board;
    const spec = [
      ...Array.from({ length: 18 }, () => [2.87, 5.08]),
      [3.98, 5.43],
      [3.15, 7.56],
    ] as Array<[number, number]>;
    const byId: Record<string, Pedal> = {};
    const placed = spec.map(([w, d], i) => {
      const id = `p${i}`;
      byId[id] = { ...pedal(id, 'utility'), widthInches: w, depthInches: d } as Pedal;
      return {
        id, pedalId: id, pedal: byId[id],
        xInches: (i % 9) * 3.4, yInches: Math.floor(i / 9) * 5.4,
        rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
      } as unknown as PlacedPedal;
    });

    const placements = calculateGreedyPlacement(placed, byId, b, undefined);
    const rows = [...new Set(placements.map((p) => Math.round(p.y * 10) / 10))];

    // Three usable bands, not two. (A fourth appears when the deep pedal
    // straddles two of them, which is the intended behaviour.)
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const dimOf = (id: string) => byId[placed.find((p) => p.id === id)!.pedalId];
    for (const p of placements) {
      const d = dimOf(p.id);
      expect(p.x + d.widthInches).toBeLessThanOrEqual(b.widthInches + 0.01);
      expect(p.y + d.depthInches).toBeLessThanOrEqual(b.depthInches + 0.01);
    }
    // Overlaps are asserted separately, by the sweep below.
  });
  /**
   * The dense-board overlap, fixed by ORDERING (roadmap phase 5).
   *
   * p19 is 7.56in deep - deeper than any row band (bands come out ~5.43/5.08),
   * so it cannot sit IN one and must straddle two, which needs a column with
   * nothing above or below it. Placed in chain order it arrived LAST, found
   * row1 already spanning x 2.17 to 32.0, and the fallback clamped it onto p9
   * at (28.85, 0.00) - overlapping by 2.87 x 1.92in.
   *
   * Making the fallback return null would not have fixed that; it would have
   * turned a wrong answer into no answer. Straddlers now claim their column
   * before the run packs the rows.
   */
  const DENSE_BOARD = {
    id: 'b', name: 'Classic Pro', widthInches: 32, depthInches: 16,
    railWidthInches: 0.6, isSystem: true,
  } as Board;

  /** Overlapping pairs, as readable strings, for a given placement. */
  function overlapsIn(
    placements: ReturnType<typeof calculateGreedyPlacement>,
    placed: PlacedPedal[],
    byId: Record<string, Pedal>
  ): string[] {
    const boxes = placements.map((p) => {
      const d = byId[placed.find((q) => q.id === p.id)!.pedalId];
      return { id: p.id, x: p.x, y: p.y, w: d.widthInches, h: d.depthInches };
    });
    const found: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
        const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
        if (ox > 0.01 && oy > 0.01) {
          found.push(`${a.id} overlaps ${c.id} by ${ox.toFixed(2)}x${oy.toFixed(2)}in`);
        }
      }
    }
    return found;
  }

  /**
   * Nineteen compacts plus one 7.56in straddler, with the straddler at chain
   * index `deepAt`. Deliberately the recorded repro's dimensions.
   */
  function denseSet(deepAt: number) {
    const spec: Array<[number, number]> = [
      ...Array.from({ length: 18 }, () => [2.87, 5.08] as [number, number]),
      [3.98, 5.43],
    ];
    spec.splice(deepAt, 0, [3.15, 7.56]);
    const byId: Record<string, Pedal> = {};
    const placed = spec.map(([w, d], i) => {
      const id = `p${i}`;
      byId[id] = { ...pedal(id, 'utility'), widthInches: w, depthInches: d } as Pedal;
      return {
        id, pedalId: id, pedal: byId[id],
        xInches: 0, yInches: 0,
        rotationDegrees: 0, chainPosition: i + 1, isInLoop: false,
      } as unknown as PlacedPedal;
    });
    return { placed, byId, deepId: `p${deepAt}` };
  }

  it('never returns a placement that overlaps, even on a dense board', () => {
    const { placed, byId } = denseSet(19); // the recorded repro: chain-LAST
    const placements = calculateGreedyPlacement(placed, byId, DENSE_BOARD, undefined);
    expect(overlapsIn(placements, placed, byId)).toEqual([]);
  });

  /**
   * The bug was never about the LAST position - it was that a straddler took
   * whatever column was left over. The board only ever escaped when the deep
   * pedal happened to be chain-FIRST. So sweep every position: one of these
   * passing proves nothing, all twenty passing is the actual claim.
   */
  it('places the straddler cleanly from ANY chain position', () => {
    const failures: string[] = [];
    for (let deepAt = 0; deepAt < 20; deepAt++) {
      const { placed, byId, deepId } = denseSet(deepAt);
      const placements = calculateGreedyPlacement(placed, byId, DENSE_BOARD, undefined);

      const bad = overlapsIn(placements, placed, byId);
      if (bad.length) failures.push(`deepAt=${deepAt}: ${bad.join('; ')}`);

      // ...and it must be ON the board, not merely un-overlapped
      for (const p of placements) {
        const d = byId[placed.find((q) => q.id === p.id)!.pedalId];
        if (p.x < -0.01 || p.y < -0.01 ||
            p.x + d.widthInches > DENSE_BOARD.widthInches + 0.01 ||
            p.y + d.depthInches > DENSE_BOARD.depthInches + 0.01) {
          failures.push(`deepAt=${deepAt}: ${p.id} off board at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        }
      }

      // Every pedal placed, exactly once
      if (placements.length !== 20) failures.push(`deepAt=${deepAt}: placed ${placements.length}/20`);
      if (!placements.find((p) => p.id === deepId)) failures.push(`deepAt=${deepAt}: straddler missing`);
    }
    expect(failures).toEqual([]);
  });

  /**
   * The straddler lands at the END OF THE BOARD its chain position calls for.
   *
   * These two cases are the ones that exist in the wild: the real 20-pedal
   * board's 7.56in PW-3 is chain-FIRST, and the recorded repro had it
   * chain-LAST. The run reads right-to-left, guitar side to amp side, so
   * first belongs at the right and last at the left. Getting this wrong is
   * what a naive "put it anywhere it fits" fix would do, and the cable would
   * cross the whole board to reach it.
   *
   * Deliberately NOT asserted: that the straddler's position moves smoothly
   * across the board as its chain index sweeps 0..19. It does not, and it is
   * not promised to - straddler-first placement is a RETRY that only runs when
   * the plain packing degrades (see calculateGreedyPlacement), so a mid-chain
   * straddler on a board that packs fine keeps whatever the ordinary packer
   * chose. An earlier version of this test asserted that smoothness and was
   * measuring the retry's coverage rather than any property of the layout.
   */
  it('anchors the straddler to the end of the board its chain position calls for', () => {
    const mid = DENSE_BOARD.widthInches / 2;

    const first = denseSet(0);
    const firstPlacements = calculateGreedyPlacement(first.placed, first.byId, DENSE_BOARD, undefined);
    const firstX = firstPlacements.find((p) => p.id === first.deepId)!.x;
    expect(firstX).toBeGreaterThan(mid);

    const last = denseSet(19);
    const lastPlacements = calculateGreedyPlacement(last.placed, last.byId, DENSE_BOARD, undefined);
    const lastX = lastPlacements.find((p) => p.id === last.deepId)!.x;
    expect(lastX).toBeLessThan(mid);

    // The chain-last case is the recorded repro, so pin it exactly: it must
    // sit past its predecessor, at the amp end, not stacked mid-board.
    const prevX = lastPlacements.find((p) => p.id === 'p18')!.x;
    expect(lastX).toBeLessThan(prevX);
  });
});
