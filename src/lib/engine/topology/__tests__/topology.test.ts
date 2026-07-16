/**
 * Signal Topology Semantics
 *
 * Locks in the WIRING semantics of each routing mode - especially the
 * BOSS-documented 4-cable method, where the hub's noise-reduction loop must
 * enclose ONLY the noise sources (drives + amp preamp). Time-based effects
 * go AFTER the hub output so the gate never chops delay/reverb trails.
 * (Regression: they were previously wired amp_send -> FX -> hub return,
 * INSIDE the gated loop.)
 */

import { describe, it, expect } from 'vitest';
import { makePedalSet, makeAmp } from '../../__tests__/support/fixtures';
import { signalChainEngine } from '../../signal-chain';
import { deriveSignalTopology } from '../index';

function derive(use4CableMethod: boolean, useEffectsLoop: boolean, ns2UseLoop = false) {
  const set = makePedalSet('twelve');
  let pedals = set.placedPedals;
  if (ns2UseLoop) {
    pedals = pedals.map((p) =>
      set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p);
  }
  const ctx = {
    ampHasEffectsLoop: true, useEffectsLoop, use4CableMethod,
    modulationInLoop: false, loopType: 'series' as const,
  };
  pedals = signalChainEngine.calculate(pedals, set.pedalsById, ctx).orderedPedals;
  const topology = deriveSignalTopology(
    pedals, set.pedalsById, makeAmp(true), useEffectsLoop, use4CableMethod,
    { useLoopPedals: true, use4CableMethod, useEffectsLoop, pedalConfigs: [] }
  );
  return { topology, set };
}

const names = (pedals: Array<{ pedalId: string }>) => pedals.map((p) => p.pedalId);

describe('4-cable method wiring (BOSS NS-2 X-pattern)', () => {
  it('gates only the noise sources; time FX run post-gate', () => {
    const { topology } = derive(true, true);
    expect(topology.mode).toBe('4cm');
    const seg = new Map(topology.segments.map((s) => [s.id, s]));

    // Guitar -> beforeHub -> HUB IN
    expect(seg.get('before-hub')!.from).toEqual({ kind: 'external', type: 'guitar' });
    expect(seg.get('before-hub')!.to).toMatchObject({ kind: 'pedal', jack: 'input' });
    expect(names(seg.get('before-hub')!.pedals)).toContain('tuner');

    // HUB SEND -> drives -> AMP IN (inside the gate's loop)
    const hubLoop = names(seg.get('hub-loop')!.pedals);
    expect(hubLoop).toEqual(expect.arrayContaining(['boost', 'od', 'dist']));
    expect(seg.get('hub-loop')!.to).toEqual({ kind: 'external', type: 'amp_input' });

    // AMP SEND -> HUB RETURN with NOTHING in between (the gated loop closes
    // around drives + preamp only)
    expect(seg.get('amp-loop')!.pedals).toEqual([]);
    expect(seg.get('amp-loop')!.from).toEqual({ kind: 'external', type: 'amp_send' });
    expect(seg.get('amp-loop')!.to).toMatchObject({ kind: 'pedal', jack: 'return' });

    // HUB OUT -> time FX -> loopers -> AMP RETURN (post-gate: trails survive)
    const postGate = names(seg.get('after-hub')!.pedals);
    expect(seg.get('after-hub')!.from).toMatchObject({ kind: 'pedal', jack: 'output' });
    expect(seg.get('after-hub')!.to).toEqual({ kind: 'external', type: 'amp_return' });
    for (const fx of ['phaser', 'delay', 'reverb']) {
      expect(postGate).toContain(fx);
    }
    expect(postGate).toContain('looper');
    // Time FX come before the looper (chain order preserved)
    expect(postGate.indexOf('delay')).toBeLessThan(postGate.indexOf('looper'));
  });
});

describe('NS-2 pedal loop wiring (non-4CM)', () => {
  it('routes only drive pedals through the hub loop', () => {
    const { topology } = derive(false, false, true);
    expect(topology.mode).toBe('pedal-loop');
    const seg = new Map(topology.segments.map((s) => [s.id, s]));

    const inLoop = names(seg.get('hub-loop')!.pedals);
    expect(inLoop).toEqual(expect.arrayContaining(['boost', 'od', 'dist']));
    expect(inLoop).not.toContain('delay');
    expect(inLoop).not.toContain('reverb');
    expect(seg.get('hub-loop')!.from).toMatchObject({ kind: 'pedal', jack: 'send' });
    expect(seg.get('hub-loop')!.to).toMatchObject({ kind: 'pedal', jack: 'return' });
  });
});

describe('standard mode', () => {
  it('splits front and amp-loop by location when the loop is enabled', () => {
    const { topology } = derive(false, true);
    expect(topology.mode).toBe('standard');
    const seg = new Map(topology.segments.map((s) => [s.id, s]));
    // delay/reverb moved to the loop by the chain rules
    const loop = names(seg.get('amp-loop')!.pedals);
    expect(loop).toEqual(expect.arrayContaining(['delay', 'reverb']));
    expect(names(seg.get('front')!.pedals)).toContain('od');
  });
});
