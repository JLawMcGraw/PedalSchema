import type {
  Pedal,
  PlacedPedal,
  ChainContext,
  ChainWarning,
  ChainSuggestion,
  SignalChainResult,
} from '@/types';
import { SIGNAL_CHAIN_RULES } from './rules';
import { getCategoryDefaultOrder } from '@/lib/constants/pedal-categories';

/**
 * Signal Chain Engine
 * Calculates optimal pedal ordering based on category defaults and special rules
 */
export class SignalChainEngine {
  private rules = SIGNAL_CHAIN_RULES;

  /**
   * Calculate the optimal signal chain for a set of pedals
   */
  calculate(
    placedPedals: PlacedPedal[],
    pedalsById: Record<string, Pedal>,
    context: ChainContext
  ): SignalChainResult {
    // Attach pedal data to placed pedals for easier processing
    let pedals: PlacedPedal[] = placedPedals.map((p) => ({
      ...p,
      pedal: pedalsById[p.pedalId] || p.pedal,
    }));

    // Step 1: Apply category-based default ordering
    pedals = this.applyDefaultOrdering(pedals);

    // Step 2: Apply rules in priority order
    const sortedRules = [...this.rules].sort((a, b) => b.priority - a.priority);
    for (const rule of sortedRules) {
      pedals = rule.apply(pedals, context);
    }

    // Step 3: Split by location
    const { frontOfAmp, effectsLoop } = this.splitByLocation(pedals, context);

    // Step 4: Assign final chain positions
    pedals = this.assignChainPositions(pedals);

    // Step 5: Detect warnings
    const warnings = this.detectWarnings(pedals, pedalsById, context);

    // Step 6: Generate suggestions
    const suggestions = this.generateSuggestions(pedals, pedalsById, context);

    return {
      orderedPedals: pedals,
      frontOfAmpChain: frontOfAmp,
      effectsLoopChain: effectsLoop,
      warnings,
      suggestions,
    };
  }

  /**
   * Apply category-based default ordering
   */
  private applyDefaultOrdering(pedals: PlacedPedal[]): PlacedPedal[] {
    return [...pedals].sort((a, b) => {
      const pedalA = a.pedal;
      const pedalB = b.pedal;

      if (!pedalA || !pedalB) return 0;

      const orderA = pedalA.defaultChainPosition ?? getCategoryDefaultOrder(pedalA.category);
      const orderB = pedalB.defaultChainPosition ?? getCategoryDefaultOrder(pedalB.category);

      return orderA - orderB;
    });
  }

  /**
   * Split pedals into front-of-amp and effects loop groups
   */
  private splitByLocation(
    pedals: PlacedPedal[],
    context: ChainContext
  ): { frontOfAmp: PlacedPedal[]; effectsLoop: PlacedPedal[] } {
    if (!context.useEffectsLoop) {
      return { frontOfAmp: pedals, effectsLoop: [] };
    }

    const frontOfAmp: PlacedPedal[] = [];
    const effectsLoop: PlacedPedal[] = [];

    for (const p of pedals) {
      if (p.location === 'effects_loop') {
        effectsLoop.push(p);
      } else {
        frontOfAmp.push(p);
      }
    }

    return { frontOfAmp, effectsLoop };
  }

  /**
   * Assign sequential chain positions
   */
  private assignChainPositions(pedals: PlacedPedal[]): PlacedPedal[] {
    return pedals.map((p, index) => ({
      ...p,
      chainPosition: index + 1,
    }));
  }

  /**
   * Detect potential issues in the signal chain
   */
  private detectWarnings(
    pedals: PlacedPedal[],
    pedalsById: Record<string, Pedal>,
    context: ChainContext
  ): ChainWarning[] {
    const warnings: ChainWarning[] = [];

    // Check for high-gain before delay without noise gate
    const hasHighGain = pedals.some((p) => {
      const pedal = p.pedal || pedalsById[p.pedalId];
      return pedal && ['distortion', 'fuzz'].includes(pedal.category);
    });
    const hasNoiseGate = pedals.some((p) => {
      const pedal = p.pedal || pedalsById[p.pedalId];
      return pedal && pedal.category === 'noise_gate';
    });
    const hasDelay = pedals.some((p) => {
      const pedal = p.pedal || pedalsById[p.pedalId];
      return pedal && pedal.category === 'delay';
    });

    if (hasHighGain && hasDelay && !hasNoiseGate) {
      warnings.push({
        type: 'noise',
        message: 'High-gain pedals before delay may cause noise in delay trails',
        suggestion: 'Consider adding a noise gate after your drive section',
        severity: 'info',
      });
    }

    // Check for fuzz after buffered pedal
    let hasBufferedPedal = false;
    for (const p of pedals) {
      const pedal = p.pedal || pedalsById[p.pedalId];
      if (!pedal) continue;

      // Tuners and some other pedals are typically buffered
      if (pedal.category === 'tuner' && !pedal.needsDirectPickup) {
        hasBufferedPedal = true;
      }

      // Fuzz that needs direct pickup after a buffered pedal
      if (pedal.category === 'fuzz' && pedal.needsDirectPickup && hasBufferedPedal) {
        warnings.push({
          type: 'tone',
          message: `${pedal.name} may not respond well after buffered pedals`,
          suggestion: 'Move this fuzz to the beginning of your chain for best tone',
          severity: 'warning',
          pedalIds: [p.id],
        });
      }
    }

    // Check for compressor after heavy distortion
    let lastDriveIndex = -1;
    let compressorAfterDrive = false;
    for (let i = 0; i < pedals.length; i++) {
      const pedal = pedals[i].pedal || pedalsById[pedals[i].pedalId];
      if (!pedal) continue;

      if (['distortion', 'fuzz'].includes(pedal.category)) {
        lastDriveIndex = i;
      }
      if (pedal.category === 'compressor' && lastDriveIndex >= 0 && i > lastDriveIndex) {
        compressorAfterDrive = true;
      }
    }

    if (compressorAfterDrive) {
      warnings.push({
        type: 'tone',
        message: 'Compressor after distortion is unusual',
        suggestion: 'Compressors typically go before drive for sustain, but after can work for limiting',
        severity: 'info',
      });
    }

    return warnings;
  }

  /**
   * Generate optimization suggestions
   */
  private generateSuggestions(
    pedals: PlacedPedal[],
    pedalsById: Record<string, Pedal>,
    context: ChainContext
  ): ChainSuggestion[] {
    const suggestions: ChainSuggestion[] = [];

    // Suggest effects loop for time-based effects
    if (context.ampHasEffectsLoop && !context.useEffectsLoop) {
      const hasTimeEffects = pedals.some((p) => {
        const pedal = p.pedal || pedalsById[p.pedalId];
        return pedal && ['delay', 'reverb'].includes(pedal.category);
      });

      if (hasTimeEffects) {
        suggestions.push({
          type: 'routing',
          message: 'Your amp has an effects loop',
          suggestion: 'Consider enabling the effects loop for cleaner delay and reverb',
        });
      }
    }

    // Suggest noise gate for high-gain setups
    const hasHighGain = pedals.some((p) => {
      const pedal = p.pedal || pedalsById[p.pedalId];
      return pedal && ['distortion', 'fuzz'].includes(pedal.category);
    });
    const hasNoiseGate = pedals.some((p) => {
      const pedal = p.pedal || pedalsById[p.pedalId];
      return pedal && pedal.category === 'noise_gate';
    });

    if (hasHighGain && !hasNoiseGate) {
      suggestions.push({
        type: 'optimization',
        message: 'High-gain setup detected',
        suggestion: 'A noise gate could help control noise from your drive pedals',
      });
    }

    // Suggest 4-cable method for NS-2 style pedals
    if (context.ampHasEffectsLoop && !context.use4CableMethod) {
      const has4CablePedal = pedals.some((p) => {
        const pedal = p.pedal || pedalsById[p.pedalId];
        return pedal && pedal.supports4Cable;
      });

      if (has4CablePedal) {
        suggestions.push({
          type: 'routing',
          message: 'You have a 4-cable capable pedal',
          suggestion: 'The 4-cable method can provide better noise gating by spanning the amp\'s preamp',
        });
      }
    }

    return suggestions;
  }
}

/**
 * Calculate optimal chain position for a new pedal
 */
export function calculateOptimalChainPosition(
  newPedal: Pedal,
  existingPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): number {
  const newOrder = newPedal.defaultChainPosition ?? getCategoryDefaultOrder(newPedal.category);

  let position = 1;
  for (const placed of existingPedals) {
    const existingPedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!existingPedal) continue;

    const existingOrder =
      existingPedal.defaultChainPosition ?? getCategoryDefaultOrder(existingPedal.category);
    if (existingOrder < newOrder) {
      position = Math.max(position, placed.chainPosition + 1);
    }
  }

  return position;
}

// Export singleton instance
export const signalChainEngine = new SignalChainEngine();
