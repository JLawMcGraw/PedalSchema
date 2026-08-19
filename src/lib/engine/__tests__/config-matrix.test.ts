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
 * THERE IS NO LENIENT TIER ANY MORE. There was one, for combos whose
 * placement was naive until the topology-driven placer landed: they had to
 * avoid collisions and flag any cable drawn through a pedal, but were allowed
 * invalid cables, lane crowding and non-monotonic order. The placer now
 * understands 4-cable-method and NS-2 pedal-loop topology, so every combo is
 * STRICT and `isLenient` returns false unconditionally.
 *
 * The branching it feeds is vestigial and kept only so the strict/lenient
 * split can be reinstated for a new class of board without rebuilding it.
 * Nothing in the matrix takes the lenient path today.
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
import { deriveSignalTopology } from '../topology';

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
 * Permanently false - see the header. Topology-driven placement flipped every
 * combo to STRICT; this is the switch, not a live tier.
 */
const isLenient = (_f: ScenarioFlags): boolean => false;

/**
 * Scenarios that knowingly run cables closer together than MIN spacing.
 *
 * THIS TABLE IS EMPTY, and keeping it empty is the point - every entry it
 * ever held turned out to be a real defect with a measurable cause, never an
 * acceptable cosmetic residue:
 *
 *   wide/seven: loop+ns2loop+locked   1   closed 2026-08-18 by the row-corridor
 *                                         contract (OBSTACLE_MARGIN 8 -> 6):
 *                                         with a corridor the router will
 *                                         actually enter, that cable stopped
 *                                         being squeezed
 *   jr/seven:   loop+ns2loop+locked   3   closed 2026-08-18 by graduated hub
 *                                         padding (layout/index.ts). The
 *                                         diagnosis it carried - "pinned
 *                                         pedals leave the packer no room to
 *                                         end a row" - was WRONG. The packer
 *                                         had room; it had given up 2.0in of
 *                                         hub corridor to recover a 0.35in
 *                                         overflow, because the pad was a
 *                                         boolean. See hub-pad-graduated.test.ts
 *
 * So a new entry here is a bug that has not been read closely enough yet, not
 * a tolerance. Pin the count if one is genuinely unavoidable, and write down
 * the measurement beside it - a budget without one rots into a wrong story,
 * which is exactly what the jr/seven line above did for a fortnight.
 */
const LANE_VIOLATION_BUDGET: Record<string, number> = {};

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
        //
        // Zero everywhere except the scenarios in LANE_VIOLATION_BUDGET, and
        // there the count is pinned to what was measured - a scenario that
        // gets worse still fails, and one that gets fixed fails too, so the
        // budget cannot rot quietly.
        const budget = LANE_VIOLATION_BUDGET[scenario.label] ?? 0;
        const lanes = laneViolations(r1.derived.routedCables);
        if (budget === 0) {
          expect(lanes).toEqual([]);
        } else {
          expect(lanes.length, `lane violations for ${scenario.label}:\n${lanes.join('\n')}`)
            .toBe(budget);
        }

        // 4. Physical chain order per topology chain
        const topology = deriveSignalTopology(
          r1.pedals, scenario.pedalsById, scenario.amp,
          combo.flags.useEffectsLoop, combo.flags.use4CableMethod,
          {
            useLoopPedals: true,
            use4CableMethod: combo.flags.use4CableMethod,
            useEffectsLoop: combo.flags.useEffectsLoop,
            pedalConfigs: [],
          }
        );
        // No budget: a stranded loop member is never acceptable. The one
        // scenario that used to need an exception is fixed by the packer's
        // wrap-before-group retry (layout/index.ts).
        expect(
          chainOrderViolations(topology, r1.pedals, scenario.pedalsById, scenario.board)
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
