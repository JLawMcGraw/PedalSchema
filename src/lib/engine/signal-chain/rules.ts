import type { PlacedPedal, ChainRule } from '@/types';

/**
 * Signal chain rules ordered by priority (higher = applied first)
 */
export const SIGNAL_CHAIN_RULES: ChainRule[] = [
  // Rule: 4-Cable hub pedal (NS-2 style) acts as routing hub
  {
    id: 'four-cable-hub',
    name: '4-Cable Hub Pedal',
    description: 'NS-2 style pedals act as the hub in 4-cable method, routing drives and FX loop through noise gate',
    priority: 105, // Highest priority - determines routing topology
    condition: (pedal, context) =>
      pedal.supports4Cable === true && context.use4CableMethod === true,
    apply: (pedals, context) => {
      // Mark 4-cable capable pedals as hubs when 4-cable method is enabled
      return pedals.map((p) => {
        if (p.locationOverride) return p; // Respect manual override
        const pedal = p.pedal;
        if (pedal?.supports4Cable && context.use4CableMethod) {
          return { ...p, location: 'four_cable_hub' as const };
        }
        return p;
      });
    },
  },

  // Rule: 4-Cable method puts time-based effects in amp's FX loop
  {
    id: 'four-cable-fx-loop',
    name: '4-Cable FX Loop Effects',
    description: 'In 4-cable method, modulation, delay, and reverb go in the amp\'s effects loop for post-preamp processing',
    priority: 104, // Just below hub priority
    condition: (pedal, context) =>
      ['modulation', 'tremolo', 'delay', 'reverb'].includes(pedal.category) &&
      context.use4CableMethod === true &&
      context.ampHasEffectsLoop === true,
    apply: (pedals, context) => {
      // MODULATION IS NOT FINAL HERE. `modulation-flexible` runs after this
      // one (priority 50 against 104) and pulls modulation and tremolo back
      // to front_of_amp when the modulation switch is off - the owner's call,
      // 2026-08-18: delay and reverb belong post-preamp because that is the
      // point of the method, but modulation placement stays taste, and the
      // panel shows both switches at once so the modulation one has to keep
      // meaning what it says. A lower-priority rule overriding a higher one
      // looks like a bug from here; it is deliberate, so do not "fix" it.
      // In 4-cable method, time-based effects always go in amp's FX loop
      return pedals.map((p) => {
        if (p.locationOverride) return p; // Respect manual override
        const pedal = p.pedal;
        if (
          pedal &&
          ['modulation', 'tremolo', 'delay', 'reverb'].includes(pedal.category) &&
          context.use4CableMethod &&
          context.ampHasEffectsLoop
        ) {
          return { ...p, location: 'effects_loop' as const };
        }
        return p;
      });
    },
  },

  // Rule: Fuzz pedals that need direct pickup signal go FIRST
  {
    id: 'fuzz-first',
    name: 'Fuzz Before Buffer',
    description: 'Classic fuzz pedals (like Fuzz Face) need unbuffered signal directly from pickups for best response',
    priority: 100,
    condition: (pedal) => pedal.category === 'fuzz' && pedal.needsDirectPickup,
    apply: (pedals, _context) => {
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
    apply: (pedals, _context) => {
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
    apply: (pedals, _context) => {
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
      // Skip pedals with manual location override
      return pedals.map((p) => {
        if (p.locationOverride) return p; // Respect user's manual choice

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
      // SYMMETRIC BY DESIGN. This rule used to move modulation INTO the loop
      // when the flag was on and do nothing when it was off, under a comment
      // claiming "Default: keep modulation in front of amp" that no code
      // carried out. So a pedal that had ever been in the loop could never
      // come back, and "Dirty: modulation before preamp" - which the panel
      // renders for the off state (routing-options-panel.tsx) - was
      // unreachable for it. The flag is a two-position switch; both positions
      // have to mean something.
      //
      // The no-loop case is NOT handled here. calculate()'s step 3b already
      // rewrites every effects_loop pedal to front_of_amp when the rig has no
      // loop, for every category. Writing the same location from two places is
      // how the duplicated jack policy started - leave it to the one that
      // already owns it.
      // DIRTY MODULATION IS AN ORDER, NOT JUST A LOCATION. The owner's
      // definition, 2026-08-18: dirty modulation puts phaser, flanger and
      // chorus BEFORE the distortion, overdrive and fuzz - the modulated
      // signal is what hits the dirt. The category defaults order modulation
      // at 110, after overdrive (60), distortion (70) and fuzz (80), so "off"
      // used to mean only "not in the loop" and no pedal ever moved. That is
      // the "it should move cables AND pedals" report: half the switch was
      // missing, not just one direction of it.
      const isModulation = (p: PlacedPedal) =>
        p.pedal?.category === 'modulation' || p.pedal?.category === 'tremolo';

      // The switch only exists when the rig has a usable loop - the panel
      // renders it under exactly this condition. With no loop there is no
      // clean/dirty choice to honour, the flag sits at its `false` default
      // that the user never saw, and the conventional category order
      // (modulation after the drives) is the right answer. Reordering on an
      // unseen default would have re-cabled every loopless board.
      const switchAvailable = context.ampHasEffectsLoop && context.useEffectsLoop;

      const located = switchAvailable
        ? pedals.map((p) => {
            if (p.locationOverride) return p; // Respect user's manual choice
            if (!isModulation(p)) return p;
            const target = context.modulationInLoop
              ? ('effects_loop' as const)
              : ('front_of_amp' as const);
            return p.location === target ? p : { ...p, location: target };
          })
        : pedals;

      // Clean: the loop decides where they sit, and category order is right
      // for anything left in front. Only DIRTY reorders.
      if (context.modulationInLoop || !switchAvailable) return located;

      // A direct-pickup fuzz has to see the pickups unbuffered - that is the
      // whole point of `fuzz-first` (priority 100) - so dirty modulation goes
      // before the drives but never in front of one of those.
      const isDrive = (p: PlacedPedal) =>
        p.pedal !== undefined &&
        ['overdrive', 'distortion', 'fuzz'].includes(p.pedal.category) &&
        !(p.pedal.category === 'fuzz' && p.pedal.needsDirectPickup);

      const moving = located.filter((p) => isModulation(p) && p.location === 'front_of_amp');
      if (moving.length === 0) return located;

      const rest = located.filter((p) => !moving.includes(p));
      const firstDrive = rest.findIndex(isDrive);
      if (firstDrive < 0) return located; // no drives: nothing to be in front of

      return [...rest.slice(0, firstDrive), ...moving, ...rest.slice(firstDrive)];
    },
  },

  // Rule: Looper always last
  {
    id: 'looper-last',
    name: 'Looper at End',
    description: 'Loopers should be last in the chain to capture your complete processed sound',
    priority: 40,
    condition: (pedal) => pedal.category === 'looper',
    apply: (pedals, _context) => {
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
    apply: (pedals, _context) => {
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
