/**
 * Where an NS-2 style loop puts its members.
 *
 * They are laid out immediately after their hub, in the primary run - the same
 * shape 4-cable mode already used. Before this they were a separate cluster
 * placed AFTER the whole chain, so the chain's overflow took the space beside
 * the hub and the members got whatever was left: on the real 9-pedal board the
 * two drives landed at the far end of the back row while their hub sat
 * mid-front-row, and the send and return crossed everything in between. That
 * candidate scored worse than leaving the board alone, so Optimize did nothing
 * at all - which is how the bug was reported.
 *
 * Two things have to hold together, and they pull against each other on a
 * tight board, which is why the padding is a retry rather than a constant:
 *   - the group must not be BROKEN by a row wrap (a stranded member's send and
 *     return have to cross the board), and
 *   - the hub and the group's tail need corridor room, because two cables pass
 *     each of those gaps.
 */
import { describe, it, expect } from 'vitest';
import { calculateGreedyPlacement } from '../index';
import { deriveSignalTopology } from '../../topology';
import { COLLISION_SPACING } from '../../collision';
import type { Board, Pedal, PlacedPedal, RoutingConfig } from '@/types';

const NOW = '2024-01-01T00:00:00Z';

function pedal(id: string, name: string, category: Pedal['category'], w: number, d: number): Pedal {
  const gate = category === 'noise_gate';
  return {
    id, name, manufacturer: 'T', category,
    widthInches: w, depthInches: d, heightInches: 2.4,
    voltage: 9, currentMa: 50, polarity: 'center_negative',
    supports4Cable: gate, preferredLocation: 'front_of_amp',
    isSystem: true, createdAt: NOW, updatedAt: NOW,
    // A real NS-2: output and send on the LEFT, input and return on the RIGHT
    jacks: gate
      ? [
          { id: `${id}-o`, pedalId: id, jackType: 'output', side: 'left', positionPercent: 22, label: 'OUT' },
          { id: `${id}-s`, pedalId: id, jackType: 'send', side: 'left', positionPercent: 38, label: 'SEND' },
          { id: `${id}-i`, pedalId: id, jackType: 'input', side: 'right', positionPercent: 22, label: 'IN' },
          { id: `${id}-r`, pedalId: id, jackType: 'return', side: 'right', positionPercent: 54, label: 'RETURN' },
        ]
      : [
          { id: `${id}-i`, pedalId: id, jackType: 'input', side: 'right', positionPercent: 50, label: 'IN' },
          { id: `${id}-o`, pedalId: id, jackType: 'output', side: 'left', positionPercent: 50, label: 'OUT' },
        ],
  } as Pedal;
}

/** Chain in signal order; the gate is the hub and the drives run in its loop. */
function rig(boardWidth: number) {
  const specs: Array<[string, string, Pedal['category'], number, number]> = [
    ['tuner', 'TU-3', 'tuner', 2.9, 5.1],
    ['chorus', 'Chorus', 'modulation', 4.72, 3.7],
    ['gate', 'NS-2', 'noise_gate', 2.9, 5.1],
    ['od1', 'TS9', 'overdrive', 2.9, 5.1],
    ['od2', 'Conspiracy', 'overdrive', 2.4, 4.09],
    ['flanger', 'BF-3', 'modulation', 2.87, 5.08],
    ['delay', 'Aqua-Puss', 'delay', 2.4, 4.09],
    ['reverb', 'Flint', 'reverb', 4.0, 4.5],
    ['looper', 'RC-1', 'looper', 2.9, 5.1],
  ];
  const pedalsById: Record<string, Pedal> = {};
  const placedPedals = specs.map(([id, name, cat, w, d], i) => {
    const p = pedal(id, name, cat, w, d);
    pedalsById[id] = p;
    return {
      id: `placed-${id}`, configurationId: 'c', pedalId: id, pedal: p,
      xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: i + 1,
      location: 'front_of_amp', isActive: true, useLoop: cat === 'noise_gate',
      createdAt: NOW,
    } as PlacedPedal;
  });
  const board = {
    id: 'b', name: 'b', widthInches: boardWidth, depthInches: 12.5,
    railWidthInches: 0.6, isSystem: true, rails: [],
  } as unknown as Board;
  const routingConfig: RoutingConfig = {
    useLoopPedals: true, use4CableMethod: false, useEffectsLoop: false, pedalConfigs: [],
  };
  return { board, pedalsById, placedPedals, routingConfig };
}

function place(width: number) {
  const { board, pedalsById, placedPedals, routingConfig } = rig(width);
  const placements = calculateGreedyPlacement(placedPedals, pedalsById, board, routingConfig);
  const topo = deriveSignalTopology(placedPedals, pedalsById, null, false, false, routingConfig);
  const at = (id: string) => placements.find((p) => p.id === id)!;
  const members = (topo.segments.find((s) => s.id === 'hub-loop')?.pedals ?? []).map((p) => p.id);
  return { placements, topo, at, hub: at(topo.hub!.id), members, pedalsById, placedPedals, board };
}

describe('pedal-loop placement', () => {
  it('is in pedal-loop mode with the drives as members', () => {
    const { topo, members } = place(18);
    expect(topo.mode).toBe('pedal-loop');
    expect(members.sort()).toEqual(['placed-od1', 'placed-od2'].sort());
  });

  it('puts the members on the hub row, immediately after the hub', () => {
    // The whole point: the drives sit beside the gate they are wired into.
    const { at, hub, members } = place(18);
    for (const id of members) {
      expect(at(id).y, `${id} should share the hub's row`).toBeCloseTo(hub.y, 5);
    }
    // The run reads right-to-left, so members are to the LEFT of their hub
    for (const id of members) expect(at(id).x).toBeLessThan(hub.x);
  });

  it('leaves nothing foreign between the hub and its members', () => {
    const { at, hub, members, placedPedals } = place(18);
    const groupIds = new Set([...members, hub.id]);
    const xs = [hub.x, ...members.map((id) => at(id).x)];
    const lo = Math.min(...xs);
    for (const p of placedPedals) {
      if (groupIds.has(p.id)) continue;
      const pos = at(p.id);
      if (Math.abs(pos.y - hub.y) > 0.01) continue;
      const between = pos.x > lo && pos.x < hub.x;
      expect(between, `${p.pedalId} sits inside the loop group`).toBe(false);
    }
  });

  describe('the corridor padding is a retry, not a constant', () => {
    /*
     * The hub and the group's tail each have two cables crossing the gap beside
     * them - the send and the output at one end, the return and the output at
     * the other - so both get 0.5in of extra room. On a board with space that
     * is free; on a tight one it is what pushes the group past the end of the
     * row, and a split group costs two board-length cables to save two crowded
     * corridors. So it is given up rather than allowed to break the group.
     */
    it('keeps the padding when the row has room for it', () => {
      const { at, hub, members, pedalsById, placedPedals } = place(32);
      const gap = (aId: string, bId: string) => {
        const a = at(aId), b = at(bId);
        const left = a.x < b.x ? a : b;
        const leftPedal = pedalsById[placedPedals.find((p) => p.id === left.id)!.pedalId];
        return Math.abs(a.x - b.x) - leftPedal.widthInches;
      };
      // Nearest member sits a padded gap away, not the bare minimum
      const nearest = members.reduce((best, id) =>
        Math.abs(at(id).x - hub.x) < Math.abs(at(best).x - hub.x) ? id : best);
      expect(gap(hub.id, nearest)).toBeGreaterThan(COLLISION_SPACING + 1e-6);
    });

    it('gives the padding up rather than split the group on a tight board', () => {
      // 18in row: the run needs 17.82in bare and 18.82in padded. Padding must
      // lose, because a stranded member is the more expensive mistake.
      const { at, hub, members } = place(18);
      for (const id of members) {
        expect(at(id).y, 'group must stay on one row').toBeCloseTo(hub.y, 5);
      }
      const nearest = members.reduce((best, id) =>
        Math.abs(at(id).x - hub.x) < Math.abs(at(best).x - hub.x) ? id : best);
      const bareGap = Math.abs(at(nearest).x - hub.x) - 2.9;
      expect(bareGap).toBeCloseTo(COLLISION_SPACING, 5);
    });
  });
});
