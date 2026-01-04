import type { Pedal, PlacedPedal, PedalJack } from '@/types';

/**
 * Routing option types
 */
export type RoutingMode = 'standard' | 'loop' | '4cable';

export interface PedalRoutingConfig {
  pedalId: string;
  mode: RoutingMode;
  // For loop mode: which pedals go in this pedal's loop
  loopPedalIds?: string[];
}

export interface RoutingOption {
  id: string;
  name: string;
  description: string;
  mode: RoutingMode;
}

export interface PedalJackInfo {
  pedalId: string;
  pedalName: string;
  jacks: {
    type: string;
    side: string;
    positionPercent: number;
    label: string | null;
  }[];
  hasLoop: boolean;
  supports4Cable: boolean;
  availableRoutingOptions: RoutingOption[];
}

/**
 * Analyze a pedal's jacks and determine available routing options
 */
export function analyzePedalRouting(pedal: Pedal): PedalJackInfo {
  const hasInput = pedal.jacks.some(j => j.jackType === 'input');
  const hasOutput = pedal.jacks.some(j => j.jackType === 'output');
  const hasSend = pedal.jacks.some(j => j.jackType === 'send');
  const hasReturn = pedal.jacks.some(j => j.jackType === 'return');
  const hasLoop = hasSend && hasReturn;

  const options: RoutingOption[] = [];

  // Standard routing is always available
  if (hasInput && hasOutput) {
    options.push({
      id: 'standard',
      name: 'Standard',
      description: 'Input → Output (bypass loop)',
      mode: 'standard',
    });
  }

  // Loop routing if pedal has send/return
  if (hasLoop) {
    options.push({
      id: 'loop',
      name: 'Use Send/Return Loop',
      description: 'Route pedals through this pedal\'s effects loop',
      mode: 'loop',
    });
  }

  // 4-cable method if pedal supports it
  if (pedal.supports4Cable && hasLoop) {
    options.push({
      id: '4cable',
      name: '4-Cable Method',
      description: 'Route amp preamp through pedal loop for better noise gating',
      mode: '4cable',
    });
  }

  return {
    pedalId: pedal.id,
    pedalName: pedal.name,
    jacks: pedal.jacks.map(j => ({
      type: j.jackType,
      side: j.side,
      positionPercent: j.positionPercent,
      label: j.label,
    })),
    hasLoop,
    supports4Cable: pedal.supports4Cable,
    availableRoutingOptions: options,
  };
}

/**
 * Get all pedals that could go in a loop pedal's send/return
 */
export function getLoopCandidates(
  loopPedal: Pedal,
  allPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): PlacedPedal[] {
  // Typically drive, distortion, fuzz, boost pedals go in noise gate loops
  const loopCategories = ['overdrive', 'distortion', 'fuzz', 'boost'];

  return allPedals.filter(placed => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return false;
    if (pedal.id === loopPedal.id) return false;
    return loopCategories.includes(pedal.category);
  });
}

/**
 * Calculate optimal placement position considering ALL jacks
 * and the pedals it needs to connect to
 */
export function calculateOptimalPosition(
  pedal: Pedal,
  connectedPedals: { placed: PlacedPedal; pedal: Pedal; connectionType: 'before' | 'after' | 'send' | 'return' }[],
  boardWidth: number,
  boardDepth: number
): { x: number; y: number } {
  if (connectedPedals.length === 0) {
    // No connections yet, place in center
    return {
      x: (boardWidth - pedal.widthInches) / 2,
      y: (boardDepth - pedal.depthInches) / 2,
    };
  }

  // Calculate center of mass of connected pedals, weighted by connection type
  let totalX = 0;
  let totalY = 0;
  let weight = 0;

  for (const conn of connectedPedals) {
    const centerX = conn.placed.xInches + conn.pedal.widthInches / 2;
    const centerY = conn.placed.yInches + conn.pedal.depthInches / 2;

    // Weight by connection type - direct connections matter more
    const w = conn.connectionType === 'before' || conn.connectionType === 'after' ? 2 : 1;
    totalX += centerX * w;
    totalY += centerY * w;
    weight += w;
  }

  const avgX = totalX / weight;
  const avgY = totalY / weight;

  // Offset based on signal flow direction (right to left)
  // If this is an "after" connection, move slightly left
  // If this is a "before" connection, move slightly right
  let offsetX = 0;
  const beforeCount = connectedPedals.filter(c => c.connectionType === 'before').length;
  const afterCount = connectedPedals.filter(c => c.connectionType === 'after').length;

  if (afterCount > beforeCount) {
    offsetX = -pedal.widthInches - 0.5; // Move left of connected pedals
  } else if (beforeCount > afterCount) {
    offsetX = pedal.widthInches + 0.5; // Move right of connected pedals
  }

  return {
    x: Math.max(0, Math.min(avgX + offsetX - pedal.widthInches / 2, boardWidth - pedal.widthInches)),
    y: Math.max(0, Math.min(avgY - pedal.depthInches / 2, boardDepth - pedal.depthInches)),
  };
}

/**
 * Find the optimal jack to use for a connection
 * Prefers jacks on the side facing the target
 */
export function findBestJack(
  sourcePedal: Pedal,
  sourcePlaced: PlacedPedal,
  targetPlaced: PlacedPedal,
  jackType: 'input' | 'output' | 'send' | 'return'
): PedalJack | null {
  const jacks = sourcePedal.jacks.filter(j => j.jackType === jackType);
  if (jacks.length === 0) return null;
  if (jacks.length === 1) return jacks[0];

  // Multiple jacks of same type - find one facing the target
  const sourceCenter = {
    x: sourcePlaced.xInches + sourcePedal.widthInches / 2,
    y: sourcePlaced.yInches + sourcePedal.depthInches / 2,
  };
  const targetCenter = {
    x: targetPlaced.xInches,
    y: targetPlaced.yInches,
  };

  // Determine which side faces the target
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  let preferredSide: 'left' | 'right' | 'top' | 'bottom';
  if (Math.abs(dx) > Math.abs(dy)) {
    preferredSide = dx > 0 ? 'right' : 'left';
  } else {
    preferredSide = dy > 0 ? 'bottom' : 'top';
  }

  // Account for rotation
  const rotationSteps = sourcePlaced.rotationDegrees / 90;
  const sides: ('top' | 'right' | 'bottom' | 'left')[] = ['top', 'right', 'bottom', 'left'];
  const adjustedSide = sides[(sides.indexOf(preferredSide) - rotationSteps + 4) % 4];

  // Find jack on preferred side, or any jack of the type
  return jacks.find(j => j.side === adjustedSide) || jacks[0];
}

/**
 * Generate all possible wiring paths for a set of pedals
 */
export interface WiringPath {
  id: string;
  name: string;
  description: string;
  connections: {
    from: { type: 'guitar' | 'pedal' | 'amp'; pedalId?: string; jack?: string };
    to: { type: 'guitar' | 'pedal' | 'amp'; pedalId?: string; jack?: string };
  }[];
  usesLoops: { pedalId: string; loopPedalIds: string[] }[];
}

export function generateWiringOptions(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  hasEffectsLoop: boolean
): WiringPath[] {
  const paths: WiringPath[] = [];

  // Find pedals with loops
  const loopPedals = placedPedals.filter(p => {
    const pedal = pedalsById[p.pedalId] || p.pedal;
    return pedal && pedal.jacks.some(j => j.jackType === 'send') &&
           pedal.jacks.some(j => j.jackType === 'return');
  });

  // Option 1: Standard linear chain
  paths.push({
    id: 'standard',
    name: 'Standard Chain',
    description: 'All pedals in series, no loops used',
    connections: [], // Will be calculated
    usesLoops: [],
  });

  // Option 2: For each loop pedal, offer to use its loop
  for (const loopPlaced of loopPedals) {
    const loopPedal = pedalsById[loopPlaced.pedalId] || loopPlaced.pedal;
    if (!loopPedal) continue;

    const candidates = getLoopCandidates(loopPedal, placedPedals, pedalsById);
    if (candidates.length > 0) {
      paths.push({
        id: `loop-${loopPlaced.id}`,
        name: `Use ${loopPedal.name} Loop`,
        description: `Route drive pedals through ${loopPedal.name}'s send/return`,
        connections: [],
        usesLoops: [{
          pedalId: loopPlaced.id,
          loopPedalIds: candidates.map(c => c.id),
        }],
      });
    }

    // 4-cable method option
    if (loopPedal.supports4Cable && hasEffectsLoop) {
      paths.push({
        id: `4cable-${loopPlaced.id}`,
        name: `4-Cable with ${loopPedal.name}`,
        description: 'Route amp preamp through pedal for better noise gating',
        connections: [],
        usesLoops: [{
          pedalId: loopPlaced.id,
          loopPedalIds: [], // Amp goes in loop, not pedals
        }],
      });
    }
  }

  return paths;
}
