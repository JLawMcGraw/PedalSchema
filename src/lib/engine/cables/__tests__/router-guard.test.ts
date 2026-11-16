/**
 * THE BOARD THAT IS DRAWN IS NEVER WORSE THAN EITHER ROUTER'S - on anything.
 *
 * Every board is routed twice, by the corridor ("lane") router and by the
 * strategy cascade, and one picture is kept. Until 2026-11-16 the choice was
 * made on crossings alone, and a tie went to the lane router. That guaranteed
 * exactly one thing, and left the rest to luck:
 *
 *                           lane router    cascade      (216 boards, each
 *   total drawn length        14,228in     9,365in       router on its own)
 *   fewer crossings on        28 boards    88 boards     tie on 100
 *   lane conflicts                 8            4
 *
 * On the 100 ties the lane picture was more than 3in longer on 93, by 19.4in
 * on average, with no lane conflict on the cascade's side to justify it. On
 * the three-pedal board below the guitar cable left the board, ran along
 * underneath it and came back up - 20.1in where a plain L is 14.0in - and the
 * amp cable ran 127px along the face of the amp, a shape the cascade had been
 * fixed to stop drawing back in July.
 *
 * It mattered twice over: the optimizer scores this geometry, so its biggest
 * dimension was partly measuring router detours; and the shopping list quotes
 * the drawn length, so the detour was a cable you were told to buy.
 *
 * The guard now compares the whole outcome, in order: invalid cables,
 * crossings, lane conflicts, length. See compareRoutingOutcomes.
 *
 * Everything below the two unit blocks was run against the old rule first:
 * 8 of the 9 boards fail there, every one on length alone with invalid cables,
 * crossings and lane conflicts all level, and both picture tests fail
 * (`expected 521 to be less than or equal to 500`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Board, Cable, Pedal, PlacedPedal } from '@/types';
import {
  makeAmp, makeBoard, makePedalSet, SCALE, type BoardKind, type PedalSetKind,
} from '../../__tests__/support/fixtures';
import { simulateConfiguration, type ScenarioFlags } from '../../__tests__/support/simulate';
import { STANDOFF } from '../../geometry';
import { generateObstacles } from '../../obstacles';
import {
  routeAllCables, routeBothWays, routingOutcome, compareRoutingOutcomes,
  type RoutedCable, type RoutedPath, type RoutingOutcome,
} from '../route-cables';

const outcome = (partial: Partial<RoutingOutcome>): RoutingOutcome => ({
  invalid: 0, crossings: 0, laneConflicts: 0, lengthPx: 1000, ...partial,
});

describe('compareRoutingOutcomes', () => {
  it('prefers fewer invalid cables over everything else', () => {
    const a = outcome({ invalid: 0, crossings: 9, laneConflicts: 9, lengthPx: 9000 });
    const b = outcome({ invalid: 1, crossings: 0, laneConflicts: 0, lengthPx: 100 });
    expect(compareRoutingOutcomes(a, b)).toBeLessThan(0);
    expect(compareRoutingOutcomes(b, a)).toBeGreaterThan(0);
  });

  it('then fewer crossings', () => {
    const a = outcome({ crossings: 1, laneConflicts: 5, lengthPx: 9000 });
    const b = outcome({ crossings: 2, laneConflicts: 0, lengthPx: 100 });
    expect(compareRoutingOutcomes(a, b)).toBeLessThan(0);
  });

  it('then fewer lane conflicts - a shorter board does not win by stacking cables', () => {
    // The case the lane router exists for: the cascade puts two runs on one
    // line and is shorter for it. That must still lose.
    const lanes = outcome({ laneConflicts: 0, lengthPx: 1400 });
    const cascade = outcome({ laneConflicts: 1, lengthPx: 1000 });
    expect(compareRoutingOutcomes(lanes, cascade)).toBeLessThan(0);
  });

  it('then less cable', () => {
    expect(compareRoutingOutcomes(outcome({ lengthPx: 1000 }), outcome({ lengthPx: 1400 }))).toBeLessThan(0);
    expect(compareRoutingOutcomes(outcome({ lengthPx: 1400 }), outcome({ lengthPx: 1000 }))).toBeGreaterThan(0);
  });

  it('calls a sub-pixel length difference a tie', () => {
    // Both routers sum the same segments in a different order; that is
    // arithmetic, not a shorter board.
    expect(compareRoutingOutcomes(outcome({ lengthPx: 1000 }), outcome({ lengthPx: 1000.2 }))).toBe(0);
    expect(compareRoutingOutcomes(outcome({ lengthPx: 1000.2 }), outcome({ lengthPx: 1000 }))).toBe(0);
  });
});

describe('routingOutcome', () => {
  const path = (...pts: Array<[number, number]>) => ({
    path: pts.map(([x, y]) => ({ x, y })), strategy: 'direct' as const, valid: true,
    fromPedalId: null, toPedalId: null,
  });

  it('measures length, crossings and invalid cables', () => {
    const result = routingOutcome([
      path([0, 50], [200, 50]),
      path([100, 0], [100, 100]),
      { ...path([300, 0], [300, 40]), valid: false },
    ]);
    expect(result).toEqual({ invalid: 1, crossings: 1, laneConflicts: 0, lengthPx: 340 });
  });

  it('counts two cables drawn on one line as a lane conflict', () => {
    // 5px apart, sharing 100px: one thick line as far as the eye is concerned.
    expect(routingOutcome([path([0, 50], [200, 50]), path([100, 55], [300, 55])]).laneConflicts).toBe(1);
  });

  it('does not count runs a full lane apart, or runs that barely overlap', () => {
    expect(routingOutcome([path([0, 50], [200, 50]), path([100, 62], [300, 62])]).laneConflicts).toBe(0);
    expect(routingOutcome([path([0, 50], [200, 50]), path([195, 52], [400, 52])]).laneConflicts).toBe(0);
  });

  it('does not count a cable against itself', () => {
    // A hairpin: out, a 5px step, and back along the same stretch.
    expect(routingOutcome([path([0, 50], [200, 50], [200, 55], [0, 55])]).laneConflicts).toBe(0);
  });
});

const off: ScenarioFlags = {
  useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false,
  ns2UseLoop: false, withLockedPedals: false,
};

interface Routed {
  board: Board;
  /** What the app draws */
  drawn: RoutedCable[];
  /** The same cables by each router on its own - the two things the guard chooses between */
  lanes: RoutedPath[];
  cascade: RoutedPath[];
}

/** normalize -> optimize, as the app does, then route the result both ways. */
function route(boardKind: BoardKind, setKind: PedalSetKind, partial: Partial<ScenarioFlags>): Routed {
  const flags = { ...off, ...partial };
  const board = makeBoard(boardKind);
  const amp = makeAmp(true);
  const set = makePedalSet(setKind);
  const placedPedals: PlacedPedal[] = flags.ns2UseLoop
    ? set.placedPedals.map((p) => (set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p))
    : set.placedPedals;
  const { pedals, derived } = simulateConfiguration({
    label: 'router-guard', board, amp, pedalsById: set.pedalsById, placedPedals, flags,
  });
  const cables: Cable[] = derived.cables;
  const pedalsById: Record<string, Pedal> = set.pedalsById;
  const drawn = routeAllCables(cables, pedals, pedalsById, board, SCALE, flags.useEffectsLoop);
  const { lanes, cascade } = routeBothWays(
    drawn.map((r) => ({
      from: r.fromPos, to: r.toPos,
      fromPedalId: r.cable.fromPedalId ?? null, toPedalId: r.cable.toPedalId ?? null,
    })),
    generateObstacles(pedals, pedalsById, board, SCALE)
  );
  return { board, drawn, lanes, cascade };
}

const cases: Array<[BoardKind, PedalSetKind, Partial<ScenarioFlags>]> = [
  ['wide', 'trio', {}],
  ['wide', 'trio', { useEffectsLoop: true }],
  ['wide', 'seven', { useEffectsLoop: true }],
  ['wide', 'seven', { useEffectsLoop: true, use4CableMethod: true }],
  ['wide', 'twelve', { useEffectsLoop: true }],
  ['wide', 'twelve', { useEffectsLoop: true, use4CableMethod: true }],
  ['jr', 'seven', { useEffectsLoop: true }],
  ['jr', 'seven', { ns2UseLoop: true }],
  ['mini', 'trio', { useEffectsLoop: true }],
];

describe('the drawn board is never worse than either router on its own', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  let lanePicturesKept = 0;
  let cascadePicturesKept = 0;

  for (const [boardKind, setKind, partial] of cases) {
    const label = Object.entries(partial).filter(([, v]) => v).map(([k]) => k).join('+') || 'plain';

    it(`${boardKind}/${setKind}: ${label}`, () => {
      const { drawn, lanes, cascade } = route(boardKind, setKind, partial);
      const d = routingOutcome(drawn);
      const c = routingOutcome(cascade);
      const l = routingOutcome(lanes);

      expect(
        compareRoutingOutcomes(d, c),
        `drawn ${JSON.stringify(d)} against cascade ${JSON.stringify(c)}`
      ).toBeLessThanOrEqual(0);
      expect(
        compareRoutingOutcomes(d, l),
        `drawn ${JSON.stringify(d)} against lane router ${JSON.stringify(l)}`
      ).toBeLessThanOrEqual(0);

      if (drawn.some((r) => r.laneOutcome === 'outrouted')) cascadePicturesKept++;
      else lanePicturesKept++;
    });
  }

  it('still keeps the lane router where its picture is the better one', () => {
    // The guard is a choice between two routers, not a way of switching one
    // off. If this reaches zero the comparison has degenerated into "always
    // the cascade" and the second routing pass is being paid for nothing.
    expect(lanePicturesKept).toBeGreaterThan(0);
    expect(cascadePicturesKept).toBeGreaterThan(0);
  });
});

/**
 * The picture that made the defect visible, pinned as a picture: three pedals
 * in a row on a 22 x 12.5in board, nothing in anybody's way.
 */
describe('three pedals in a row: no cable takes the long way round', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  const lengthInches = (r: RoutedCable) =>
    r.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - r.path[i].x, p.y - r.path[i].y), 0) / SCALE;

  it('keeps the guitar cable on the board instead of looping underneath it', () => {
    const { board, drawn } = route('wide', 'trio', {});
    const guitar = drawn.find((r) => r.cable.fromType === 'guitar')!;
    const bottom = board.depthInches * SCALE;
    // It dipped to y=521 on a 500px board, ran 278px along there and came back.
    for (const p of guitar.path) expect(p.y).toBeLessThanOrEqual(bottom);
    expect(lengthInches(guitar)).toBeLessThan(15); // was 20.1in; a plain L is 14.0in
  });

  it('does not run the amp cable along the face of the amp', () => {
    const { drawn } = route('wide', 'trio', {});
    const amp = drawn.find((r) => r.cable.toType === 'amp_input')!;
    const jack = amp.path[amp.path.length - 1];
    // The last leg is the plug going in: a standoff's length, square to the
    // amp. It was a 127px vertical run down the amp's own jack column.
    const before = amp.path[amp.path.length - 2];
    expect(Math.abs(before.y - jack.y)).toBeLessThan(0.5);
    expect(Math.abs(before.x - jack.x)).toBeLessThanOrEqual(STANDOFF + 0.5);
    expect(lengthInches(amp)).toBeLessThan(6); // was 11.4in; a plain L is 5.1in
  });
});
