/**
 * Configuration Matrix
 *
 * Sweeps boards x pedal sets x every meaningful combination of the
 * configuration settings (effects loop, 4-cable method, modulation-in-loop,
 * NS-2 pedal loop, locked pedals) through the app's full pipeline
 * (normalize -> optimize -> route) and asserts the invariants that every
 * regression so far has violated somewhere:
 *
 *  1. no pedal collisions; everything in bounds
 *  2. every cable valid; no path physically enters a pedal body
 *  3. no two parallel runs from different cables closer than one lane
 *  4. per-segment physical chain order (front right-to-left per row;
 *     loop cluster packed at the amp)
 *  5. determinism: identical output on repeat runs
 *  6. idempotence: re-running the pipeline on its own output is a no-op
 *
 * LENIENT tier: combos whose PLACEMENT is known to be naive until the
 * topology-driven placer lands (Phase 2 of the roadmap). They still must
 * not collide, must not silently draw cables through pedals (any cable that
 * does must be flagged invalid), and must be deterministic - but may have
 * invalid cables, lane crowding, or non-monotonic order.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PlacedPedal } from '@/types';
import {
  makeBoard,
  makePedalSet,
  makeAmp,
  requiredWidth,
  type BoardKind,
  type PedalSetKind,
} from './support/fixtures';
import { simulateConfiguration, type Scenario, type ScenarioFlags, type SimulationResult } from './support/simulate';
import {
  placementViolations,
  cableBodyViolations,
  laneViolations,
  chainOrderViolations,
} from './support/invariants';

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

interface Combo {
  board: BoardKind;
  set: PedalSetKind;
  flags: ScenarioFlags;
}

/** Usable rows per board (jr collapses to 2 via the safe-rows fallback) */
const BOARD_ROWS: Record<BoardKind, number> = { wide: 2, jr: 2, mini: 1 };

function* flagCombos(hasHub: boolean): Generator<ScenarioFlags> {
  for (const withLockedPedals of [false, true]) {
    // Effects loop off
    for (const ns2UseLoop of hasHub ? [false, true] : [false]) {
      yield { useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false, ns2UseLoop, withLockedPedals };
    }
    // Effects loop on
    for (const modulationInLoop of [false, true]) {
      for (const ns2UseLoop of hasHub ? [false, true] : [false]) {
        yield { useEffectsLoop: true, use4CableMethod: false, modulationInLoop, ns2UseLoop, withLockedPedals };
      }
      if (hasHub) {
        yield { useEffectsLoop: true, use4CableMethod: true, modulationInLoop, ns2UseLoop: false, withLockedPedals };
      }
    }
  }
}

function* combos(): Generator<Combo> {
  const pairs: Array<[BoardKind, PedalSetKind]> = [
    ['wide', 'trio'],
    ['wide', 'seven'],
    ['wide', 'twelve'],
    ['jr', 'trio'],
    ['jr', 'seven'],
    ['mini', 'trio'],
  ];
  for (const [board, set] of pairs) {
    const hasHub = set !== 'trio';
    for (const flags of flagCombos(hasHub)) {
      yield { board, set, flags };
    }
  }
}

function flagLabel(f: ScenarioFlags): string {
  const parts = [
    f.useEffectsLoop ? 'loop' : 'no-loop',
    f.use4CableMethod ? '4cm' : null,
    f.modulationInLoop ? 'modInLoop' : null,
    f.ns2UseLoop ? 'ns2loop' : null,
    f.withLockedPedals ? 'locked' : null,
  ].filter(Boolean);
  return parts.join('+');
}

function buildScenario(combo: Combo): Scenario | null {
  const board = makeBoard(combo.board);
  const set = makePedalSet(combo.set);

  // Skip combos where the pedals physically cannot fit
  if (requiredWidth(set) > BOARD_ROWS[combo.board] * board.widthInches) {
    return null;
  }

  let placedPedals = set.placedPedals;

  // Apply scenario knobs to SOURCE state (builder responsibility, so the
  // simulate pipeline stays pure and idempotence is testable)
  if (combo.flags.ns2UseLoop) {
    placedPedals = placedPedals.map((p) =>
      set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p
    );
  }
  if (combo.flags.withLockedPedals && placedPedals.length >= 4) {
    const lockedIds = new Set([placedPedals[1].id, placedPedals[3].id]);
    placedPedals = placedPedals.map((p) =>
      lockedIds.has(p.id) ? { ...p, chainPositionLocked: true } : p
    );
  }

  return {
    label: `${combo.board}/${combo.set}: ${flagLabel(combo.flags)}`,
    board,
    amp: makeAmp(true),
    pedalsById: set.pedalsById,
    placedPedals,
    flags: combo.flags,
  };
}

/**
 * Combos with knowingly-naive PLACEMENT until Phase 2 (topology-driven
 * placement) lands: the placer doesn't understand 4-cable-method or NS-2
 * pedal-loop topology yet, so their layouts may force invalid cables or
 * lane crowding. Flip these to strict as Phase 2 completes.
 */
const isLenient = (f: ScenarioFlags): boolean => f.use4CableMethod || f.ns2UseLoop;

// ---------------------------------------------------------------------------
// Snapshots for determinism/idempotence comparison
// ---------------------------------------------------------------------------

function positionSnapshot(pedals: PlacedPedal[]): Array<[string, number, number, number, string]> {
  return [...pedals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => [p.id, round(p.xInches), round(p.yInches), p.chainPosition, p.location]);
}

function fullSnapshot(r: SimulationResult): unknown {
  return {
    pedals: positionSnapshot(r.pedals),
    paths: r.derived.routedCables.map((rc) => ({
      valid: rc.valid,
      path: rc.path.map((p) => [round(p.x), round(p.y)]),
    })),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const scenarios = [...combos()]
  .map((combo) => ({ combo, scenario: buildScenario(combo) }))
  .filter((s): s is { combo: Combo; scenario: Scenario } => s.scenario !== null);

describe(`configuration matrix (${scenarios.length} scenarios)`, () => {
  beforeAll(() => {
    // The jr board intentionally triggers the rails-too-close fallback;
    // keep matrix output readable
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  for (const { combo, scenario } of scenarios) {
    const lenient = isLenient(combo.flags);

    it(`${scenario.label}${lenient ? ' [lenient]' : ''}`, () => {
      const r1 = simulateConfiguration(scenario);

      // 1. Placement: no collisions, in bounds - ALWAYS
      expect(placementViolations(r1.pedals, scenario.pedalsById, scenario.board)).toEqual([]);
      expect(r1.derived.collisions).toEqual([]);

      // 2. No cable physically enters a pedal body.
      //    Strict: no cable at all. Lenient: cables that do must at least be
      //    FLAGGED invalid (rendered red) - never silently wrong.
      expect(
        cableBodyViolations(r1.derived.routedCables, r1.pedals, scenario.pedalsById, scenario.board, {
          onlyValidCables: true,
        })
      ).toEqual([]);

      if (!lenient) {
        // 2b. ...and in strict mode every cable must actually be valid
        const invalid = r1.derived.routedCables.filter((rc) => !rc.valid);
        expect(
          invalid.map((rc) => `${rc.cable.fromType}:${rc.cable.fromPedalId ?? ''}→${rc.cable.toType}:${rc.cable.toPedalId ?? ''}`)
        ).toEqual([]);

        // 3. Lane separation between different cables
        expect(laneViolations(r1.derived.routedCables)).toEqual([]);

        // 4. Physical chain order per segment
        expect(
          chainOrderViolations(r1.pedals, scenario.pedalsById, combo.flags.useEffectsLoop)
        ).toEqual([]);
      }

      // 5. Determinism - ALWAYS
      const r2 = simulateConfiguration(scenario);
      expect(fullSnapshot(r2)).toEqual(fullSnapshot(r1));

      // 6. Idempotence: pipeline applied to its own output is a no-op - ALWAYS
      const r3 = simulateConfiguration({ ...scenario, placedPedals: r1.pedals });
      expect(positionSnapshot(r3.pedals)).toEqual(positionSnapshot(r1.pedals));
    });
  }
});
