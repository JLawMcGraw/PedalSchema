/**
 * Giving up the hub's corridor padding is GRADUATED, not all-or-nothing.
 *
 * The pad is worth 0.5in on each side of two pedals - the loop hub and the
 * pedal its group ends on - so up to 2.0in of row. It used to be a single
 * boolean: a run that overflowed the row by any amount at all surrendered the
 * lot, and the hub's gaps collapsed from 40px to 20px.
 *
 * The board that found it (2026-08-18), and the arithmetic that makes it a
 * cliff rather than a trade:
 *
 *   jr/seven, effects loop + NS-2 pedal loop, two pedals pinned mid-chain
 *
 *   padded   TU-3 2.87 | PH-3 2.87 | NS-2 3.87 | TS9 2.87 | MT-2W 3.87
 *            + 4 gaps x 0.5in  =  18.35in  of an 18.00in row   -> overflows
 *   hub only TU-3 2.87 | PH-3 2.87 | NS-2 3.87 | TS9 2.87 | MT-2W 2.87
 *            + 4 gaps x 0.5in  =  17.35in                      -> fits
 *
 * It misses by 0.35in. Dropping BOTH pads recovers 2.0in and costs the hub the
 * channel that three cables need at once on this board: the hub's SEND
 * reaching a member on its far side, the RETURN coming back from the tail, and
 * the hub's OUTPUT leaving to a pedal on the other row. At a 20px gap those
 * three came out 3-6px apart - three lane violations, which is one cable as
 * far as the eye is concerned.
 *
 * The tail gives its pad up first because it is the cheaper one: the hub has
 * four jacks and both of its gaps carry at least two runs, while the tail has
 * two, and when the tail ends the row - exactly when the row is tight - its
 * outer gap is the board edge and carries nothing at all.
 *
 * NOTE the tail's pad costs row width even when it sits at the board edge:
 * the packer's width for a pedal is `width + 2 * pad`, both sides, whether or
 * not a neighbour is there to use it. That is why recovering it is worth a
 * retry rung and not merely tidy.
 */
import { describe, it, expect } from 'vitest';
import { makeBoard, makePedalSet, makeAmp } from '../../__tests__/support/fixtures';
import { simulateConfiguration, type Scenario } from '../../__tests__/support/simulate';
import { laneViolations } from '../../__tests__/support/invariants';
import { deriveSignalTopology } from '../../topology';
import { COLLISION_SPACING } from '../../collision';
import type { PlacedPedal } from '@/types';

/** The config-matrix scenario `jr/seven: loop+ns2loop+locked`, exactly. */
function scenario(): Scenario {
  const board = makeBoard('jr');
  const set = makePedalSet('seven');
  let placedPedals = set.placedPedals.map((p) =>
    set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p
  );
  // The matrix pins the 2nd and 4th pedals of the source order
  const lockedIds = new Set([placedPedals[1].id, placedPedals[3].id]);
  placedPedals = placedPedals.map((p) =>
    lockedIds.has(p.id) ? { ...p, chainPositionLocked: true } : p
  );
  return {
    label: 'jr/seven: loop+ns2loop+locked',
    board,
    amp: makeAmp(true),
    pedalsById: set.pedalsById,
    placedPedals,
    flags: {
      useEffectsLoop: true,
      use4CableMethod: false,
      modulationInLoop: false,
      ns2UseLoop: true,
      withLockedPedals: true,
    },
  };
}

function run() {
  const s = scenario();
  const r = simulateConfiguration(s);
  const topo = deriveSignalTopology(
    r.pedals, s.pedalsById, s.amp, true, false,
    { useLoopPedals: true, use4CableMethod: false, useEffectsLoop: true, pedalConfigs: [] }
  );
  const at = (id: string) => r.pedals.find((p) => p.id === id)!;
  const widthOf = (p: PlacedPedal) => s.pedalsById[p.pedalId].widthInches;
  const memberIds = (topo.segments.find((seg) => seg.id === 'hub-loop')?.pedals ?? []).map((p) => p.id);
  const hub = at(topo.hub!.id);

  /** Edge-to-edge gap between two pedals, whichever order they sit in. */
  const gap = (aId: string, bId: string) => {
    const a = at(aId), b = at(bId);
    const left = a.xInches < b.xInches ? a : b;
    return Math.abs(a.xInches - b.xInches) - widthOf(left);
  };

  /** Same-row neighbours of a pedal, nearest first on each side. */
  const neighbours = (id: string) => {
    const me = at(id);
    const row = r.pedals.filter((p) => p.id !== id && Math.abs(p.yInches - me.yInches) < 0.01);
    const leftOf = row.filter((p) => p.xInches < me.xInches).sort((a, b) => b.xInches - a.xInches)[0];
    const rightOf = row.filter((p) => p.xInches > me.xInches).sort((a, b) => a.xInches - b.xInches)[0];
    return { leftOf, rightOf };
  };

  return { s, r, topo, at, hub, memberIds, gap, neighbours };
}

describe('graduated hub padding', () => {
  it('is a pedal loop with a hub and members, or this board proves nothing', () => {
    const { topo, memberIds } = run();
    expect(topo.mode).toBe('pedal-loop');
    expect(memberIds.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the loop group whole on one row', () => {
    // The outcome the pad was being dropped to protect. It must still hold -
    // a stranded member costs two board-length cables.
    const { at, hub, memberIds } = run();
    for (const id of memberIds) {
      expect(at(id).yInches, `${id} must share the hub's row`).toBeCloseTo(hub.yInches, 5);
    }
  });

  it('keeps the HUB corridor - the gap three cables have to share', () => {
    const { hub, gap, neighbours } = run();
    const { leftOf, rightOf } = neighbours(hub.id);
    // Both sides of the hub, wherever a neighbour exists, get the padded gap
    for (const n of [leftOf, rightOf].filter(Boolean)) {
      expect(
        gap(hub.id, n.id),
        `hub gap to ${n.id} must carry the corridor pad, not the bare minimum`
      ).toBeCloseTo(COLLISION_SPACING + 0.5, 5);
    }
  });

  it('gives the TAIL corridor up, which is what makes the row fit', () => {
    // 18.35in padded vs an 18.00in row: the tail's pad is the 1.0in that has
    // to go. If this ever reads 1.0 again the run no longer fits and the hub
    // will have lost its corridor instead.
    const { at, memberIds, gap, neighbours } = run();
    const tailId = memberIds[memberIds.length - 1];
    const { leftOf, rightOf } = neighbours(tailId);
    const inwardNeighbour = [leftOf, rightOf].find(
      (n) => n && Math.abs(n.xInches - at(tailId).xInches) > 0
    );
    expect(inwardNeighbour, 'tail should have a same-row neighbour to measure against').toBeTruthy();
    expect(gap(tailId, inwardNeighbour!.id)).toBeCloseTo(COLLISION_SPACING, 5);
  });

  it('draws no crowded lanes, which is the point of keeping the hub pad', () => {
    // Was 3 violations while the pad was all-or-nothing.
    const { r } = run();
    expect(laneViolations(r.derived.routedCables)).toEqual([]);
  });
});
