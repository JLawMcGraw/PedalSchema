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
import { ampClusters, deriveSignalTopology, primaryChain } from '../index';

function derive(use4CableMethod: boolean, useEffectsLoop: boolean, ns2UseLoop = false,
  modulationInLoop = false) {
  const set = makePedalSet('twelve');
  let pedals = set.placedPedals;
  if (ns2UseLoop) {
    pedals = pedals.map((p) =>
      set.pedalsById[p.pedalId]?.supports4Cable ? { ...p, useLoop: true } : p);
  }
  const ctx = {
    ampHasEffectsLoop: true, useEffectsLoop, use4CableMethod,
    modulationInLoop, loopType: 'series' as const,
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
    // Delay and reverb are post-gate because the method says so - the gate
    // must never chop their trails. The PHASER is not here: this fixture has
    // modulationInLoop false, and dirty modulation means the modulated signal
    // hits the dirt, so it belongs in front of the hub with the drives behind
    // it. Before 2026-08-18 it sat here regardless of the switch, which is
    // what made the switch look dead under 4CM.
    for (const fx of ['delay', 'reverb']) {
      expect(postGate).toContain(fx);
    }
    expect(postGate).not.toContain('phaser');
    expect(names(seg.get('before-hub')!.pedals)).toContain('phaser');
    expect(postGate).toContain('looper');
    // Time FX come before the looper (chain order preserved)
    expect(postGate.indexOf('delay')).toBeLessThan(postGate.indexOf('looper'));
  });

  it('puts CLEAN modulation in the amp loop, post-gate, with the other time FX', () => {
    // The other half of the switch: same rig, modulationInLoop on. Written
    // because the case above can only prove where dirty modulation goes, and
    // a one-directional rule passes half a round trip.
    const { topology } = derive(true, true, false, true);
    const seg = new Map(topology.segments.map((s) => [s.id, s]));
    expect(names(seg.get('after-hub')!.pedals)).toContain('phaser');
    expect(names(seg.get('before-hub')!.pedals)).not.toContain('phaser');
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

  /*
   * A GATE IN FRONT AND TIME EFFECTS IN THE AMP'S LOOP IS AN ORDINARY RIG.
   *
   * This branch used to return before it ever looked at the amp loop, so a
   * board with both said one thing in the Chain panel - delay and reverb
   * under Send/Return, because the chain rules had moved them there - and
   * wired another: every cable went to the amp INPUT and the amp's send and
   * return were never used. Measured in the app on 2026-08-21:
   *
   *   loop off   location=[]                  endpoints={guitar, amp_input}
   *   loop on    location=[Aqua-Puss, Flint]  endpoints={guitar, amp_input}
   *
   * The placer optimises against this topology, so the consequence was not
   * cosmetic: those two pedals were being packed into the primary run and
   * their cable cost scored against the wrong jacks.
   */
  it('wires the amp effects loop too, when the rig has one', () => {
    const { topology } = derive(false, true, true);
    expect(topology.mode).toBe('pedal-loop');
    const seg = new Map(topology.segments.map((s) => [s.id, s]));

    // The gate's own loop is unchanged - drives still inside it
    expect(names(seg.get('hub-loop')!.pedals)).toEqual(
      expect.arrayContaining(['boost', 'od', 'dist'])
    );

    // AMP SEND -> time FX -> AMP RETURN
    expect(seg.get('amp-loop')).toBeDefined();
    expect(seg.get('amp-loop')!.from).toEqual({ kind: 'external', type: 'amp_send' });
    expect(seg.get('amp-loop')!.to).toEqual({ kind: 'external', type: 'amp_return' });
    expect(names(seg.get('amp-loop')!.pedals)).toEqual(
      expect.arrayContaining(['delay', 'reverb'])
    );

    // and they are in the loop INSTEAD of the front run, not as well as it
    expect(names(seg.get('after-hub')!.pedals)).not.toContain('delay');
    expect(names(seg.get('after-hub')!.pedals)).not.toContain('reverb');
    expect(names(primaryChain(topology))).not.toContain('delay');

    // Every pedal is in exactly one place
    const everywhere = [
      ...topology.segments.flatMap((s) => names(s.pedals)),
      ...(topology.hub ? [topology.hub.pedalId] : []),
    ];
    expect(new Set(everywhere).size).toBe(everywhere.length);
    expect(everywhere.length).toBe(12);
  });

  it('hands the amp loop to the placer as an amp-side cluster', () => {
    // Same rule as standard mode: pedals wired to the amp's own jacks are
    // packed against the amp edge, not threaded into the primary run.
    const { topology } = derive(false, true, true);
    const clusters = ampClusters(topology);
    expect(clusters.map((c) => c.id)).toEqual(['amp-loop']);
  });

  it('adds no amp-loop segment when the amp loop is off', () => {
    const { topology } = derive(false, false, true);
    expect(topology.segments.find((s) => s.id === 'amp-loop')).toBeUndefined();
    expect(topology.segments.at(-1)!.to).toEqual({ kind: 'external', type: 'amp_input' });
    expect(ampClusters(topology)).toEqual([]);
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
