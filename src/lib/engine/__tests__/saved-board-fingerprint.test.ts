/**
 * Fingerprint the engine against the REAL saved boards, for before/after
 * comparison across a change that is supposed to be behaviour-neutral (or
 * whose behaviour change must be small and explainable).
 *
 * Two boards is a thin corpus. This proves "did not change the real boards",
 * NOT "is better in general" - for the general claim use config-matrix, which
 * sweeps boards x pedal sets x every configuration combination.
 *
 * Why a vitest file and not a standalone script: `tsx`, `vite-node` and
 * `ts-node` are all absent from node_modules/.bin - only `vite` and `vitest`
 * are there. vitest is the only TypeScript runner this repo has.
 *
 *   node .claude/scripts/dump-configs-offline.js /path/configs.json
 *   PEDAL_CONFIG_DUMP=/path/configs.json \
 *   PEDAL_FINGERPRINT_OUT=/path/fp-before.txt npx vitest run saved-board-fingerprint
 *
 * Skipped entirely without PEDAL_CONFIG_DUMP, so CI is unaffected.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE APP: the dump carries no amp (the
 * configurations query does not select one), so every config is replayed
 * against makeAmp(true). Where a real config's amp has no loop, the app would
 * compute fxLoopActive=false and this harness computes true. That makes the
 * fingerprint self-consistent - which is all a before/after diff needs - but
 * it is not a claim about what the user sees. Do not read absolute numbers
 * out of this file; read DIFFS.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Board, Pedal, PlacedPedal, ChainContext, RoutingConfig } from '@/types';
import { signalChainEngine } from '../signal-chain';
import { calculateOptimalLayoutJoint } from '../layout';
import { summarizeOptimization } from '../layout/routing-cost';
import { deriveBoardState } from '@/store/derived';
import { makeAmp } from './support/fixtures';

const DUMP = process.env.PEDAL_CONFIG_DUMP;

interface DumpedConfig {
  id: string;
  name: string;
  board: Board;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same shape config-matrix compares on, so the two harnesses stay legible together. */
function positionSnapshot(pedals: PlacedPedal[]): string[] {
  return [...pedals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) =>
      `${p.id} (${round2(p.xInches)},${round2(p.yInches)}) ` +
      `rot=${p.rotationDegrees} chain=${p.chainPosition} ${p.location}`
    );
}

describe.skipIf(!DUMP)('saved board fingerprint', () => {
  it('emits a comparable fingerprint for every saved configuration', () => {
    const configs: DumpedConfig[] = JSON.parse(fs.readFileSync(DUMP!, 'utf8'));
    expect(configs.length).toBeGreaterThan(0);

    const out: string[] = [];
    const perf: string[] = [];
    const emit = (s = '') => out.push(s);

    for (const config of configs) {
      const { board, pedalsById } = config;
      const amp = makeAmp(true);
      const routingConfig: RoutingConfig = {
        useLoopPedals: true,
        use4CableMethod: config.use4CableMethod,
        useEffectsLoop: config.useEffectsLoop,
        pedalConfigs: [],
      };
      const context: ChainContext = {
        ampHasEffectsLoop: amp.hasEffectsLoop,
        useEffectsLoop: config.useEffectsLoop,
        use4CableMethod: config.use4CableMethod,
        modulationInLoop: config.modulationInLoop,
        loopType: amp.loopType,
      };

      // Same pipeline as support/simulate.ts, but keeping the layout result -
      // simulateConfiguration discards it, and the cost breakdown IS the
      // fingerprint.
      let pedals: PlacedPedal[] = config.placedPedals.map((p) => ({ ...p }));
      pedals = signalChainEngine.calculate(pedals, pedalsById, context).orderedPedals;

      const t0 = performance.now();
      const layout = calculateOptimalLayoutJoint(pedals, pedalsById, board, routingConfig);
      const optimizeMs = performance.now() - t0;

      const placementById = new Map(layout.placements.map((p) => [p.id, p]));
      const rotationById = new Map((layout.rotations ?? []).map((r) => [r.id, r.rotationDegrees]));
      pedals = pedals.map((p) => {
        const placement = placementById.get(p.id);
        const rotation = rotationById.get(p.id);
        let next = p;
        if (placement) next = { ...next, xInches: placement.x, yInches: placement.y };
        if (rotation !== undefined) next = { ...next, rotationDegrees: rotation };
        return next;
      });
      if (layout.swappableGroups.length > 0) {
        const orderIndex = new Map(layout.chainOrder.map((id, i) => [id, i + 1]));
        pedals = pedals.map((p) => ({ ...p, chainPosition: orderIndex.get(p.id) ?? p.chainPosition }));
      }

      const derived = deriveBoardState({
        id: config.id,
        board,
        amp,
        useEffectsLoop: config.useEffectsLoop,
        use4CableMethod: config.use4CableMethod,
        modulationInLoop: config.modulationInLoop,
        placedPedals: pedals,
        pedalsById,
        routingConfig,
      });

      emit('='.repeat(78));
      emit(`CONFIG  ${config.name}  (${config.placedPedals.length} pedals on ` +
        `${board.name} ${board.widthInches}x${board.depthInches}, ` +
        `${board.rails?.length ?? 0} rails)`);
      emit(`flags   loop=${config.useEffectsLoop} 4cm=${config.use4CableMethod} ` +
        `modInLoop=${config.modulationInLoop}`);
      emit('='.repeat(78));

      const cost = layout.cost;
      const baseline = layout.baselineCost;
      if (!cost || !baseline) {
        emit('SCORE   (nothing to optimize - no cost recorded)');
      } else {
        emit(`SCORE   totalScore=${round2(cost.totalScore)} ` +
          `totalLengthInches=${round2(cost.totalLengthInches)} ` +
          `crossingCount=${cost.crossingCount}`);
        emit(`BASE    totalScore=${round2(baseline.totalScore)} ` +
          `totalLengthInches=${round2(baseline.totalLengthInches)} ` +
          `crossingCount=${baseline.crossingCount}`);
        emit('');
        emit('DIMENSIONS  (key: value [count]   before -> after)');
        const beforeByKey = new Map(baseline.dimensions.map((d) => [d.key, d]));
        for (const d of cost.dimensions) {
          const b = beforeByKey.get(d.key);
          emit(`  ${d.key.padEnd(16)} ${String(round2(b?.value ?? 0)).padStart(9)}` +
            ` -> ${String(round2(d.value)).padStart(9)}` +
            `   count ${b?.count ?? '-'} -> ${d.count ?? '-'}`);
        }
        emit('');
        emit('SCORED CABLES  (what the optimizer compared)');
        for (const d of cost.cableDetails) {
          emit(`  ${d.strategy.padEnd(16)} ${String(round2(d.routedDistance)).padStart(7)}in` +
            `  direct ${String(round2(d.directDistance)).padStart(7)}in  ${d.fromId} -> ${d.toId}`);
        }
        emit('');
        emit(`HEADLINE  ${summarizeOptimization(baseline, cost, layout.noLegalCandidate).headline}`);
      }

      emit('');
      emit('DRAWN CABLES  (what the user sees)');
      for (const rc of derived.routedCables) {
        emit(`  ${rc.strategy.padEnd(16)} valid=${String(rc.valid).padEnd(5)} ` +
          `${String(rc.path.length).padStart(3)}pts  ` +
          rc.path.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' '));
      }

      // Why the corridor router did or did not serve each cable. `strategy`
      // above names the rung that SUCCEEDED, so every corridor refusal looks
      // alike there; this is the only place 'evicted' - the assignLanes cliff -
      // is distinguishable from an ordinary unplannable cable.
      emit('');
      const outcomeTally = new Map<string, number>();
      for (const rc of derived.routedCables) {
        const key = rc.laneOutcome ?? '(lane router off)';
        outcomeTally.set(key, (outcomeTally.get(key) ?? 0) + 1);
      }
      emit('LANE OUTCOMES  (why the corridor router served it, or did not)');
      for (const key of [...outcomeTally.keys()].sort()) {
        emit(`  ${key.padEnd(18)} ${String(outcomeTally.get(key)).padStart(3)}`);
      }

      emit('');
      emit(`COUNTS  scored=${cost?.cableDetails.length ?? 0} drawn=${derived.routedCables.length}` +
        `  (a mismatch is the endpoint-drop asymmetry)`);
      emit('');
      emit('POSITIONS');
      for (const line of positionSnapshot(pedals)) emit(`  ${line}`);
      emit('');

      // Timing goes to the CONSOLE, never into the fingerprint. The gate on a
      // behaviour-neutral change is byte-identity of this file, and a
      // wall-clock number makes that impossible by construction.
      perf.push(`  ${config.name.padEnd(10)} ${config.placedPedals.length} pedals` +
        `   calculateOptimalLayoutJoint ${optimizeMs.toFixed(1)}ms`);
    }

    const target = process.env.PEDAL_FINGERPRINT_OUT
      ?? path.join(path.dirname(DUMP!), 'fingerprint.txt');
    fs.writeFileSync(target, out.join('\n'), 'utf8');
    console.log(`\nfingerprint -> ${target}  (${out.length} lines)`);
    console.log('PERF (not in the fingerprint - compare by eye across runs):');
    for (const line of perf) console.log(line);
  });
});
