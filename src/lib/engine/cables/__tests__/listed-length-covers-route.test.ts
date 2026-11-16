/**
 * THE CABLE YOU ARE TOLD TO BUY REACHES.
 *
 * Every cable on a board has two lengths the user can read: the route drawn on
 * the canvas, and the length the wiring list and "What to buy" quote for it.
 * They were computed by different functions at different times - the list from
 * straight-line jack distance x 1.2 before anything was routed, the canvas
 * from the router - and nothing held them together.
 *
 * So the list under-bought. Measured on 2026-11-16 over 216 boards, 165 of
 * about 1,330 pedal-to-pedal cables were drawn longer than the length listed;
 * the worst was a cable routed around the outside of the board, 55.4in on the
 * canvas and "12in patch" on the shopping list. A straight line is the one
 * path a patch cable on a full board almost never takes.
 *
 * This file reads only what the UI reads - `derived.cables` and
 * `derived.routedCables` - so it states the property rather than the
 * mechanism, and was run against the old derivation first to confirm it fails
 * there. The mechanism is in engine/cables/derive-cables.ts and tested beside
 * this file.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  makeAmp, makeBoard, makePedalSet, SCALE, type BoardKind, type PedalSetKind,
} from '../../__tests__/support/fixtures';
import { simulateConfiguration, type ScenarioFlags } from '../../__tests__/support/simulate';
import { calculatePathLength } from '../../geometry';

/** The lengths a cable is sold in, and the only values the list may quote up to 10ft. */
const STANDARD_LENGTHS = [6, 12, 18, 24, 36, 48, 72, 120];

const off: ScenarioFlags = {
  useEffectsLoop: false, use4CableMethod: false, modulationInLoop: false,
  ns2UseLoop: false, withLockedPedals: false,
};

const cases: Array<[BoardKind, PedalSetKind, Partial<ScenarioFlags>]> = [
  ['wide', 'trio', {}],
  ['wide', 'seven', {}],
  ['wide', 'seven', { ns2UseLoop: true }],
  ['wide', 'seven', { useEffectsLoop: true, use4CableMethod: true }],
  ['wide', 'twelve', { useEffectsLoop: true }],
  ['wide', 'twelve', { useEffectsLoop: true, modulationInLoop: true, ns2UseLoop: true }],
  ['jr', 'seven', { useEffectsLoop: true }],
  ['jr', 'seven', { ns2UseLoop: true }],
  ['mini', 'trio', { useEffectsLoop: true }],
];

describe('the listed length of a cable covers the route it is drawn on', () => {
  beforeAll(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => { vi.restoreAllMocks(); });

  let checked = 0;

  for (const [boardKind, setKind, partial] of cases) {
    const flags = { ...off, ...partial };
    const label = Object.entries(partial).filter(([, v]) => v).map(([k]) => k).join('+') || 'plain';

    it(`${boardKind}/${setKind}: ${label}`, () => {
      const set = makePedalSet(setKind);
      const placedPedals = flags.ns2UseLoop
        ? set.placedPedals.map((p) => (set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p))
        : set.placedPedals;
      const { derived } = simulateConfiguration({
        label, board: makeBoard(boardKind), amp: makeAmp(true),
        pedalsById: set.pedalsById, placedPedals, flags,
      });

      expect(derived.routedCables.length).toBe(derived.cables.length);

      for (const routed of derived.routedCables) {
        // An unroutable cable has no route to cover - see purchaseLengthInches.
        if (!routed.valid) continue;

        const drawn = calculatePathLength(routed.path) / SCALE;
        const listed = derived.cables.find((c) => c.id === routed.cable.id)!.calculatedLengthInches!;
        const name =
          `${routed.cable.fromType}${routed.cable.fromPedalId ? ':' + routed.cable.fromPedalId : ''} -> ` +
          `${routed.cable.toType}${routed.cable.toPedalId ? ':' + routed.cable.toPedalId : ''} [${routed.strategy}]`;

        // It reaches.
        expect(listed, `${name}: drawn ${drawn.toFixed(1)}in, listed ${listed}in`)
          .toBeGreaterThanOrEqual(drawn - 1e-6);

        // And it is the SHORTEST standard length that does - not merely a
        // generous one. Over-buying by a size is the same defect pointing the
        // other way, and the old estimate did that too.
        const shortest = STANDARD_LENGTHS.find((l) => drawn <= l + 1e-6) ?? Math.ceil(drawn / 12) * 12;
        expect(listed, `${name}: drawn ${drawn.toFixed(1)}in`).toBe(shortest);

        checked++;
      }
    });
  }

  it('checked a meaningful number of cables', () => {
    // Guards the loop above against passing by checking nothing.
    expect(checked).toBeGreaterThan(50);
  });
});
