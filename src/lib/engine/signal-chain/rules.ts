import type { Pedal, PlacedPedal, ChainContext, ChainRule } from '@/types';

/**
 * Signal chain rules ordered by priority (higher = applied first)
 */
export const SIGNAL_CHAIN_RULES: ChainRule[] = [
  // Rule: Fuzz pedals that need direct pickup signal go FIRST
  {
    id: 'fuzz-first',
    name: 'Fuzz Before Buffer',
    description: 'Classic fuzz pedals (like Fuzz Face) need unbuffered signal directly from pickups for best response',
    priority: 100,
    condition: (pedal) => pedal.category === 'fuzz' && pedal.needsDirectPickup,
    apply: (pedals, context) => {
      const directPickupFuzzes: PlacedPedal[] = [];
      const others: PlacedPedal[] = [];

      for (const p of pedals) {
        const pedal = p.pedal;
        if (pedal && pedal.category === 'fuzz' && pedal.needsDirectPickup) {
          directPickupFuzzes.push(p);
        } else {
          others.push(p);
        }
      }

      return [...directPickupFuzzes, ...others];
    },
  },

  // Rule: Tuner early in chain (but after direct-pickup fuzz)
  {
    id: 'tuner-early',
    name: 'Tuner Early in Chain',
    description: 'Tuners work best with clean, unprocessed signal for accurate readings',
    priority: 90,
    condition: (pedal) => pedal.category === 'tuner',
    apply: (pedals, context) => {
      const tuners: PlacedPedal[] = [];
      const directPickupFuzzes: PlacedPedal[] = [];
      const others: PlacedPedal[] = [];

      for (const p of pedals) {
        const pedal = p.pedal;
        if (!pedal) {
          others.push(p);
          continue;
        }

        if (pedal.category === 'tuner') {
          tuners.push(p);
        } else if (pedal.category === 'fuzz' && pedal.needsDirectPickup) {
          directPickupFuzzes.push(p);
        } else {
          others.push(p);
        }
      }

      return [...directPickupFuzzes, ...tuners, ...others];
    },
  },

  // Rule: Noise gate after last drive pedal
  {
    id: 'noise-gate-after-drive',
    name: 'Noise Gate After Gain',
    description: 'Noise gates are most effective when placed after high-gain pedals to tame their noise',
    priority: 70,
    condition: (pedal) => pedal.category === 'noise_gate',
    apply: (pedals, context) => {
      // Find the last drive/distortion/fuzz pedal
      let lastDriveIndex = -1;
      for (let i = 0; i < pedals.length; i++) {
        const pedal = pedals[i].pedal;
        if (pedal && ['overdrive', 'distortion', 'fuzz', 'boost'].includes(pedal.category)) {
          lastDriveIndex = i;
        }
      }

      // No drive pedals found - noise gates stay where category ordering put them
      if (lastDriveIndex === -1) return pedals;

      // Find noise gates that are BEFORE the last drive pedal
      // Only those need to be moved; gates already after drives should stay in place
      const noiseGatesToMove: PlacedPedal[] = [];
      const noiseGateIndices: Set<number> = new Set();

      for (let i = 0; i < pedals.length; i++) {
        const pedal = pedals[i].pedal;
        if (pedal && pedal.category === 'noise_gate') {
          if (i < lastDriveIndex) {
            // This noise gate is before the last drive - needs to move
            noiseGatesToMove.push(pedals[i]);
            noiseGateIndices.add(i);
          }
          // Noise gates already after lastDriveIndex stay in place
        }
      }

      // If no noise gates need to move, return original order
      if (noiseGatesToMove.length === 0) return pedals;

      // Build result: skip the noise gates we're moving, insert them after last drive
      const result: PlacedPedal[] = [];
      for (let i = 0; i < pedals.length; i++) {
        if (noiseGateIndices.has(i)) {
          // Skip - will be inserted after last drive
          continue;
        }
        result.push(pedals[i]);
        if (i === lastDriveIndex) {
          // Insert the moved noise gates right after the last drive
          result.push(...noiseGatesToMove);
        }
      }

      return result;
    },
  },

  // Rule: Time-based effects go in effects loop when available
  {
    id: 'time-effects-in-loop',
    name: 'Time Effects in Effects Loop',
    description: 'Delay and reverb sound cleaner in the effects loop, after the preamp distortion',
    priority: 60,
    condition: (pedal, context) =>
      ['delay', 'reverb'].includes(pedal.category) &&
      context.ampHasEffectsLoop &&
      context.useEffectsLoop,
    apply: (pedals, context) => {
      // This rule changes location, not order
      return pedals.map((p) => {
        const pedal = p.pedal;
        if (
          pedal &&
          ['delay', 'reverb'].includes(pedal.category) &&
          context.ampHasEffectsLoop &&
          context.useEffectsLoop
        ) {
          return { ...p, location: 'effects_loop' as const };
        }
        return p;
      });
    },
  },

  // Rule: Modulation can go in loop or front
  {
    id: 'modulation-flexible',
    name: 'Modulation Placement',
    description: 'Modulation effects can go before amp for more intense effect, or in loop for cleaner sound',
    priority: 50,
    condition: (pedal) => pedal.category === 'modulation' || pedal.category === 'tremolo',
    apply: (pedals, context) => {
      // If user has enabled "clean modulation" (modulationInLoop), move modulation to effects loop
      if (context.modulationInLoop && context.ampHasEffectsLoop && context.useEffectsLoop) {
        return pedals.map((p) => {
          const pedal = p.pedal;
          if (pedal && (pedal.category === 'modulation' || pedal.category === 'tremolo')) {
            return { ...p, location: 'effects_loop' as const };
          }
          return p;
        });
      }
      // Default: keep modulation in front of amp ("dirty modulation")
      return pedals;
    },
  },

  // Rule: Looper always last
  {
    id: 'looper-last',
    name: 'Looper at End',
    description: 'Loopers should be last in the chain to capture your complete processed sound',
    priority: 40,
    condition: (pedal) => pedal.category === 'looper',
    apply: (pedals, context) => {
      const loopers: PlacedPedal[] = [];
      const others: PlacedPedal[] = [];

      for (const p of pedals) {
        const pedal = p.pedal;
        if (pedal && pedal.category === 'looper') {
          loopers.push(p);
        } else {
          others.push(p);
        }
      }

      return [...others, ...loopers];
    },
  },

  // Rule: Volume pedal placement (at end for master volume)
  {
    id: 'volume-end',
    name: 'Volume Pedal Position',
    description: 'Volume pedal at end acts as master volume; earlier positions affect gain structure',
    priority: 30,
    condition: (pedal) => pedal.category === 'volume',
    apply: (pedals, context) => {
      // Keep volume near end but before looper
      const volume: PlacedPedal[] = [];
      const loopers: PlacedPedal[] = [];
      const others: PlacedPedal[] = [];

      for (const p of pedals) {
        const pedal = p.pedal;
        if (pedal && pedal.category === 'volume') {
          volume.push(p);
        } else if (pedal && pedal.category === 'looper') {
          loopers.push(p);
        } else {
          others.push(p);
        }
      }

      return [...others, ...volume, ...loopers];
    },
  },
];

/**
 * Get applicable rules for a pedal
 */
export function getApplicableRules(pedal: Pedal, context: ChainContext): ChainRule[] {
  return SIGNAL_CHAIN_RULES.filter((rule) => rule.condition(pedal, context));
}
