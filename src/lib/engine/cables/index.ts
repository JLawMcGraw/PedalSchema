import type {
  Pedal,
  PlacedPedal,
  Cable,
  PedalJack,
  Board,
  Amp,
  ChainLocation,
  RoutingConfig,
} from '@/types';

// Standard patch cable lengths in inches
const STANDARD_CABLE_LENGTHS = [6, 12, 18, 24, 36, 48, 72, 120];

// Overhead factor for cable routing (cables don't go in straight lines)
const ROUTING_OVERHEAD = 1.2;

// PIXELS_PER_INCH for consistency with visual editor
const PIXELS_PER_INCH = 40;

interface JackPosition {
  x: number; // in inches
  y: number; // in inches
}

interface CableConnection {
  fromType: Cable['fromType'];
  fromPedalId: string | null;
  fromJackType: string | null;
  toType: Cable['toType'];
  toPedalId: string | null;
  toJackType: string | null;
  calculatedLengthInches: number;
  cableType: Cable['cableType'];
  sortOrder: number;
}

/**
 * Calculate the position of a jack on a placed pedal
 */
export function getJackPosition(
  placedPedal: PlacedPedal,
  jack: PedalJack,
  pedal: Pedal
): JackPosition {
  const isRotated = placedPedal.rotationDegrees === 90 || placedPedal.rotationDegrees === 270;

  // Get effective dimensions after rotation
  const effectiveWidth = isRotated ? pedal.depthInches : pedal.widthInches;
  const effectiveDepth = isRotated ? pedal.widthInches : pedal.depthInches;

  // Calculate jack position based on side and position percent
  let jackOffsetX = 0;
  let jackOffsetY = 0;

  // Map the original jack side through rotation
  const rotationSteps = placedPedal.rotationDegrees / 90;
  const sides: Array<'top' | 'right' | 'bottom' | 'left'> = ['top', 'right', 'bottom', 'left'];
  const originalSideIndex = sides.indexOf(jack.side);
  const rotatedSideIndex = (originalSideIndex + rotationSteps) % 4;
  const rotatedSide = sides[rotatedSideIndex];

  const positionRatio = jack.positionPercent / 100;

  switch (rotatedSide) {
    case 'top':
      jackOffsetX = effectiveWidth * positionRatio;
      jackOffsetY = 0;
      break;
    case 'bottom':
      jackOffsetX = effectiveWidth * positionRatio;
      jackOffsetY = effectiveDepth;
      break;
    case 'left':
      jackOffsetX = 0;
      jackOffsetY = effectiveDepth * positionRatio;
      break;
    case 'right':
      jackOffsetX = effectiveWidth;
      jackOffsetY = effectiveDepth * positionRatio;
      break;
  }

  return {
    x: placedPedal.xInches + jackOffsetX,
    y: placedPedal.yInches + jackOffsetY,
  };
}

/**
 * Calculate the distance between two points
 */
function calculateDistance(p1: JackPosition, p2: JackPosition): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Round up to the nearest standard cable length
 */
export function roundToStandardLength(lengthInches: number): number {
  for (const standard of STANDARD_CABLE_LENGTHS) {
    if (lengthInches <= standard) {
      return standard;
    }
  }
  // For very long cables, round up to nearest 12 inches
  return Math.ceil(lengthInches / 12) * 12;
}

/**
 * Find a jack of a specific type on a pedal
 * Returns a synthetic jack if not found (for pedals without that jack type)
 */
function findJack(pedal: Pedal, jackType: 'input' | 'output' | 'send' | 'return'): PedalJack {
  // Try to find the actual jack
  const jack = pedal.jacks?.find((j) => j.jackType === jackType);
  if (jack) return jack;

  // For send/return, only return synthetic if pedal supports it
  if (jackType === 'send' || jackType === 'return') {
    // Check if pedal actually has send/return capability
    const hasSend = pedal.jacks?.some(j => j.jackType === 'send');
    const hasReturn = pedal.jacks?.some(j => j.jackType === 'return');
    if (!hasSend && !hasReturn && !pedal.supports4Cable) {
      // This pedal doesn't have loop jacks - return a dummy that won't be used
      // but won't cause null errors
      return {
        id: `synthetic-${jackType}`,
        pedalId: pedal.id,
        jackType: jackType,
        side: jackType === 'send' ? 'right' : 'left',
        positionPercent: jackType === 'send' ? 25 : 25,
        label: jackType.toUpperCase(),
      };
    }
  }

  // Create synthetic jack for input/output (all pedals have these)
  // Input/send on right side, output/return on left side (standard layout)
  const isInput = jackType === 'input' || jackType === 'send';
  return {
    id: `synthetic-${jackType}`,
    pedalId: pedal.id,
    jackType: jackType,
    side: isInput ? 'right' : 'left',
    positionPercent: 50,
    label: jackType.toUpperCase(),
  };
}

/**
 * Check if a pedal category should go in a noise gate loop
 */
function shouldGoInNoiseGateLoop(category: string): boolean {
  return ['overdrive', 'distortion', 'fuzz', 'boost'].includes(category);
}

/**
 * Get guitar input position (assumed to be off-board to the right)
 */
function getGuitarPosition(board: Board): JackPosition {
  return {
    x: board.widthInches + 3, // 3 inches to the right of the board
    y: board.depthInches / 2,
  };
}

/**
 * Get amp input position (assumed to be off-board to the left)
 */
function getAmpInputPosition(board: Board): JackPosition {
  return {
    x: -3, // 3 inches to the left of the board
    y: board.depthInches / 2,
  };
}

/**
 * Get amp effects loop send position
 */
function getAmpSendPosition(board: Board): JackPosition {
  return {
    x: -3,
    y: board.depthInches * 0.3,
  };
}

/**
 * Get amp effects loop return position
 */
function getAmpReturnPosition(board: Board): JackPosition {
  return {
    x: -3,
    y: board.depthInches * 0.7,
  };
}

/**
 * Helper to add a cable connection
 */
function addCable(
  cables: CableConnection[],
  fromType: CableConnection['fromType'],
  fromPedalId: string | null,
  fromJackType: string | null,
  toType: CableConnection['toType'],
  toPedalId: string | null,
  toJackType: string | null,
  length: number,
  cableType: CableConnection['cableType'],
  sortOrder: number
): void {
  cables.push({
    fromType,
    fromPedalId,
    fromJackType,
    toType,
    toPedalId,
    toJackType,
    calculatedLengthInches: roundToStandardLength(length),
    cableType,
    sortOrder,
  });
}

/**
 * Categories that go before the 4-cable hub (tuner, wah, filters)
 */
const BEFORE_HUB_CATEGORIES = ['tuner', 'filter', 'wah', 'pitch'];

/**
 * Categories that go through the hub's send/return loop (drives)
 */
const IN_HUB_LOOP_CATEGORIES = ['overdrive', 'distortion', 'fuzz', 'boost'];

/**
 * Categories that go in the amp's FX loop (time-based effects)
 */
const IN_AMP_LOOP_CATEGORIES = ['modulation', 'tremolo', 'delay', 'reverb'];

/**
 * Categories that go after everything (looper)
 */
const AFTER_HUB_CATEGORIES = ['looper', 'volume'];

/**
 * Categorize pedals for 4-cable method routing
 */
function categorizeFor4Cable(
  pedals: PlacedPedal[],
  hubPedal: PlacedPedal,
  pedalsById: Record<string, Pedal>
): {
  beforeHub: PlacedPedal[];
  inHubLoop: PlacedPedal[];
  inAmpLoop: PlacedPedal[];
  afterHub: PlacedPedal[];
} {
  const beforeHub: PlacedPedal[] = [];
  const inHubLoop: PlacedPedal[] = [];
  const inAmpLoop: PlacedPedal[] = [];
  const afterHub: PlacedPedal[] = [];

  for (const placed of pedals) {
    if (placed.id === hubPedal.id) continue;

    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) continue;

    const category = pedal.category;

    if (BEFORE_HUB_CATEGORIES.includes(category)) {
      beforeHub.push(placed);
    } else if (IN_HUB_LOOP_CATEGORIES.includes(category)) {
      inHubLoop.push(placed);
    } else if (IN_AMP_LOOP_CATEGORIES.includes(category)) {
      inAmpLoop.push(placed);
    } else if (AFTER_HUB_CATEGORIES.includes(category)) {
      afterHub.push(placed);
    } else {
      // Default: put unknown categories in front of amp (hub loop)
      inHubLoop.push(placed);
    }
  }

  // Sort each group by chain position
  beforeHub.sort((a, b) => a.chainPosition - b.chainPosition);
  inHubLoop.sort((a, b) => a.chainPosition - b.chainPosition);
  inAmpLoop.sort((a, b) => a.chainPosition - b.chainPosition);
  afterHub.sort((a, b) => a.chainPosition - b.chainPosition);

  return { beforeHub, inHubLoop, inAmpLoop, afterHub };
}

/**
 * Calculate all cable connections for a configuration
 * Handles standard chains, effects loops, pedals with send/return loops (like NS-2),
 * and the full 4-cable method routing
 */
export function calculateCables(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  amp: Amp | null,
  useEffectsLoop: boolean,
  routingConfig?: RoutingConfig,
  use4CableMethod: boolean = false
): CableConnection[] {
  if (placedPedals.length === 0) {
    return [];
  }

  const cables: CableConnection[] = [];
  let sortOrder = 0;

  // Sort pedals by chain position
  const sortedPedals = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);

  // Find pedal with send/return loop that is configured to use its loop
  let loopPedal: PlacedPedal | null = null;
  let loopPedalData: Pedal | null = null;
  let configuredLoopPedalIds: string[] = [];

  // Check routing config for explicitly configured loop routing
  if (routingConfig) {
    for (const config of routingConfig.pedalConfigs) {
      if (config.mode === 'loop' && config.loopPedalIds.length > 0) {
        const placed = sortedPedals.find(p => p.id === config.pedalId);
        if (placed) {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (pedal && findJack(pedal, 'send') && findJack(pedal, 'return')) {
            loopPedal = placed;
            loopPedalData = pedal;
            configuredLoopPedalIds = config.loopPedalIds;
            break;
          }
        }
      }
    }
  }

  // If no explicit config, check for pedals with useLoop enabled
  if (!loopPedal) {
    for (const placed of sortedPedals) {
      // Only use loop if the pedal has useLoop explicitly enabled
      if (!placed.useLoop) continue;

      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (pedal?.supports4Cable) {
        const hasSend = findJack(pedal, 'send');
        const hasReturn = findJack(pedal, 'return');
        if (hasSend && hasReturn) {
          loopPedal = placed;
          loopPedalData = pedal;
          // Auto-detect which pedals should go in loop (drive pedals)
          configuredLoopPedalIds = sortedPedals
            .filter(p => {
              const pd = pedalsById[p.pedalId] || p.pedal;
              return pd && shouldGoInNoiseGateLoop(pd.category) && p.id !== placed.id;
            })
            .map(p => p.id);
          break;
        }
      }
    }
  }

  // Split pedals based on loop pedal presence
  let beforeLoop: PlacedPedal[] = [];
  let inLoop: PlacedPedal[] = [];
  let afterLoop: PlacedPedal[] = [];

  if (loopPedal && loopPedalData && configuredLoopPedalIds.length > 0) {
    // Categorize pedals relative to the loop pedal using configured IDs
    for (const placed of sortedPedals) {
      if (placed.id === loopPedal.id) continue;

      if (configuredLoopPedalIds.includes(placed.id)) {
        inLoop.push(placed);
      } else if (placed.chainPosition < loopPedal.chainPosition) {
        beforeLoop.push(placed);
      } else {
        afterLoop.push(placed);
      }
    }
  }

  // Split into front-of-amp and effects loop
  // IMPORTANT: If effects loop routing is disabled, treat ALL pedals as front-of-amp
  // This ensures pedals with location='effects_loop' still get cables
  const effectsLoopEnabled = useEffectsLoop && amp?.hasEffectsLoop;
  const effectsLoopPedals = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location === 'effects_loop')
    : [];
  const frontOfAmp = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location !== 'effects_loop')
    : sortedPedals; // All pedals when effects loop is disabled

  // === 4-CABLE METHOD ROUTING ===
  // Find 4-cable hub pedal (like NS-2) when 4-cable method is enabled
  const hubPedal = use4CableMethod
    ? sortedPedals.find((p) => p.location === 'four_cable_hub')
    : null;
  const hubPedalData = hubPedal
    ? (pedalsById[hubPedal.pedalId] || hubPedal.pedal)
    : null;

  if (use4CableMethod && hubPedal && hubPedalData && effectsLoopEnabled) {
    // Categorize pedals for 4-cable routing
    const { beforeHub, inHubLoop, inAmpLoop, afterHub } = categorizeFor4Cable(
      sortedPedals,
      hubPedal,
      pedalsById
    );

    // 1. Guitar → beforeHub pedals → HUB INPUT
    const firstPedal = beforeHub.length > 0 ? beforeHub[0] : hubPedal;
    const firstPedalData = beforeHub.length > 0
      ? (pedalsById[firstPedal.pedalId] || firstPedal.pedal)
      : hubPedalData;

    if (firstPedalData) {
      const inputJack = findJack(firstPedalData, 'input');
      if (inputJack) {
        const guitarPos = getGuitarPosition(board);
        const jackPos = getJackPosition(firstPedal, inputJack, firstPedalData);
        addCable(cables, 'guitar', null, null, 'pedal', firstPedal.id, 'input',
          calculateDistance(guitarPos, jackPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
      }
    }

    // Connect beforeHub pedals
    for (let i = 0; i < beforeHub.length - 1; i++) {
      const from = beforeHub[i];
      const to = beforeHub[i + 1];
      const fromPedal = pedalsById[from.pedalId] || from.pedal;
      const toPedal = pedalsById[to.pedalId] || to.pedal;
      if (fromPedal && toPedal) {
        const fromJack = findJack(fromPedal, 'output');
        const toJack = findJack(toPedal, 'input');
        addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
          calculateDistance(getJackPosition(from, fromJack, fromPedal), getJackPosition(to, toJack, toPedal)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }
    }

    // Last beforeHub to HUB INPUT
    if (beforeHub.length > 0) {
      const lastBefore = beforeHub[beforeHub.length - 1];
      const lastBeforePedal = pedalsById[lastBefore.pedalId] || lastBefore.pedal;
      if (lastBeforePedal) {
        const outJack = findJack(lastBeforePedal, 'output');
        const inJack = findJack(hubPedalData, 'input');
        addCable(cables, 'pedal', lastBefore.id, 'output', 'pedal', hubPedal.id, 'input',
          calculateDistance(getJackPosition(lastBefore, outJack, lastBeforePedal), getJackPosition(hubPedal, inJack, hubPedalData)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }
    }

    // 2. HUB SEND → inHubLoop (drives) → AMP INPUT
    const hubSendJack = findJack(hubPedalData, 'send');
    if (inHubLoop.length > 0) {
      const firstDrive = inHubLoop[0];
      const firstDrivePedal = pedalsById[firstDrive.pedalId] || firstDrive.pedal;
      if (firstDrivePedal) {
        const driveInputJack = findJack(firstDrivePedal, 'input');
        addCable(cables, 'pedal', hubPedal.id, 'send', 'pedal', firstDrive.id, 'input',
          calculateDistance(getJackPosition(hubPedal, hubSendJack, hubPedalData), getJackPosition(firstDrive, driveInputJack, firstDrivePedal)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }

      // Connect drives
      for (let i = 0; i < inHubLoop.length - 1; i++) {
        const from = inHubLoop[i];
        const to = inHubLoop[i + 1];
        const fromPedal = pedalsById[from.pedalId] || from.pedal;
        const toPedal = pedalsById[to.pedalId] || to.pedal;
        if (fromPedal && toPedal) {
          const fromJack = findJack(fromPedal, 'output');
          const toJack = findJack(toPedal, 'input');
          addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
            calculateDistance(getJackPosition(from, fromJack, fromPedal), getJackPosition(to, toJack, toPedal)) * ROUTING_OVERHEAD,
            'patch', sortOrder++);
        }
      }

      // Last drive → AMP INPUT
      const lastDrive = inHubLoop[inHubLoop.length - 1];
      const lastDrivePedal = pedalsById[lastDrive.pedalId] || lastDrive.pedal;
      if (lastDrivePedal) {
        const outJack = findJack(lastDrivePedal, 'output');
        addCable(cables, 'pedal', lastDrive.id, 'output', 'amp_input', null, null,
          calculateDistance(getJackPosition(lastDrive, outJack, lastDrivePedal), getAmpInputPosition(board)) * ROUTING_OVERHEAD,
          'instrument', sortOrder++);
      }
    } else {
      // No drives - HUB SEND goes directly to AMP INPUT
      addCable(cables, 'pedal', hubPedal.id, 'send', 'amp_input', null, null,
        calculateDistance(getJackPosition(hubPedal, hubSendJack, hubPedalData), getAmpInputPosition(board)) * ROUTING_OVERHEAD,
        'instrument', sortOrder++);
    }

    // 3. AMP SEND → inAmpLoop (modulation/time) → HUB RETURN
    const hubReturnJack = findJack(hubPedalData, 'return');
    if (inAmpLoop.length > 0) {
      const firstFx = inAmpLoop[0];
      const firstFxPedal = pedalsById[firstFx.pedalId] || firstFx.pedal;
      if (firstFxPedal) {
        const fxInputJack = findJack(firstFxPedal, 'input');
        addCable(cables, 'amp_send', null, null, 'pedal', firstFx.id, 'input',
          calculateDistance(getAmpSendPosition(board), getJackPosition(firstFx, fxInputJack, firstFxPedal)) * ROUTING_OVERHEAD,
          'instrument', sortOrder++);
      }

      // Connect FX loop pedals
      for (let i = 0; i < inAmpLoop.length - 1; i++) {
        const from = inAmpLoop[i];
        const to = inAmpLoop[i + 1];
        const fromPedal = pedalsById[from.pedalId] || from.pedal;
        const toPedal = pedalsById[to.pedalId] || to.pedal;
        if (fromPedal && toPedal) {
          const fromJack = findJack(fromPedal, 'output');
          const toJack = findJack(toPedal, 'input');
          addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
            calculateDistance(getJackPosition(from, fromJack, fromPedal), getJackPosition(to, toJack, toPedal)) * ROUTING_OVERHEAD,
            'patch', sortOrder++);
        }
      }

      // Last FX → HUB RETURN
      const lastFx = inAmpLoop[inAmpLoop.length - 1];
      const lastFxPedal = pedalsById[lastFx.pedalId] || lastFx.pedal;
      if (lastFxPedal) {
        const outJack = findJack(lastFxPedal, 'output');
        addCable(cables, 'pedal', lastFx.id, 'output', 'pedal', hubPedal.id, 'return',
          calculateDistance(getJackPosition(lastFx, outJack, lastFxPedal), getJackPosition(hubPedal, hubReturnJack, hubPedalData)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }
    } else {
      // No FX loop pedals - AMP SEND goes directly to HUB RETURN
      addCable(cables, 'amp_send', null, null, 'pedal', hubPedal.id, 'return',
        calculateDistance(getAmpSendPosition(board), getJackPosition(hubPedal, hubReturnJack, hubPedalData)) * ROUTING_OVERHEAD,
        'instrument', sortOrder++);
    }

    // 4. HUB OUTPUT → afterHub (looper) → AMP RETURN
    const hubOutputJack = findJack(hubPedalData, 'output');
    if (afterHub.length > 0) {
      const firstAfter = afterHub[0];
      const firstAfterPedal = pedalsById[firstAfter.pedalId] || firstAfter.pedal;
      if (firstAfterPedal) {
        const inputJack = findJack(firstAfterPedal, 'input');
        addCable(cables, 'pedal', hubPedal.id, 'output', 'pedal', firstAfter.id, 'input',
          calculateDistance(getJackPosition(hubPedal, hubOutputJack, hubPedalData), getJackPosition(firstAfter, inputJack, firstAfterPedal)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }

      // Connect afterHub pedals
      for (let i = 0; i < afterHub.length - 1; i++) {
        const from = afterHub[i];
        const to = afterHub[i + 1];
        const fromPedal = pedalsById[from.pedalId] || from.pedal;
        const toPedal = pedalsById[to.pedalId] || to.pedal;
        if (fromPedal && toPedal) {
          const fromJack = findJack(fromPedal, 'output');
          const toJack = findJack(toPedal, 'input');
          addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
            calculateDistance(getJackPosition(from, fromJack, fromPedal), getJackPosition(to, toJack, toPedal)) * ROUTING_OVERHEAD,
            'patch', sortOrder++);
        }
      }

      // Last afterHub → AMP RETURN
      const lastAfter = afterHub[afterHub.length - 1];
      const lastAfterPedal = pedalsById[lastAfter.pedalId] || lastAfter.pedal;
      if (lastAfterPedal) {
        const outJack = findJack(lastAfterPedal, 'output');
        addCable(cables, 'pedal', lastAfter.id, 'output', 'amp_return', null, null,
          calculateDistance(getJackPosition(lastAfter, outJack, lastAfterPedal), getAmpReturnPosition(board)) * ROUTING_OVERHEAD,
          'instrument', sortOrder++);
      }
    } else {
      // No afterHub - HUB OUTPUT goes directly to AMP RETURN
      addCable(cables, 'pedal', hubPedal.id, 'output', 'amp_return', null, null,
        calculateDistance(getJackPosition(hubPedal, hubOutputJack, hubPedalData), getAmpReturnPosition(board)) * ROUTING_OVERHEAD,
        'instrument', sortOrder++);
    }

    return cables;
  }

  // === ROUTING WITH LOOP PEDAL (NS-2 style) - Standard (non-4-cable) ===
  if (loopPedal && loopPedalData && inLoop.length > 0) {
    // Guitar to first pedal (either before loop or the loop pedal itself)
    const firstPedal = beforeLoop.length > 0 ? beforeLoop[0] : loopPedal;
    const firstPedalData = beforeLoop.length > 0
      ? (pedalsById[firstPedal.pedalId] || firstPedal.pedal)
      : loopPedalData;

    if (firstPedalData) {
      const inputJack = findJack(firstPedalData, 'input');
      if (inputJack) {
        const guitarPos = getGuitarPosition(board);
        const jackPos = getJackPosition(firstPedal, inputJack, firstPedalData);
        addCable(cables, 'guitar', null, null, 'pedal', firstPedal.id, 'input',
          calculateDistance(guitarPos, jackPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
      }
    }

    // Connect pedals before the loop pedal
    for (let i = 0; i < beforeLoop.length - 1; i++) {
      const from = beforeLoop[i];
      const to = beforeLoop[i + 1];
      const fromPedal = pedalsById[from.pedalId] || from.pedal;
      const toPedal = pedalsById[to.pedalId] || to.pedal;

      let fromPos: JackPosition;
      let toPos: JackPosition;

      if (fromPedal) {
        fromPos = getJackPosition(from, findJack(fromPedal, 'output'), fromPedal);
      } else {
        fromPos = { x: from.xInches, y: from.yInches + 2 };
      }

      if (toPedal) {
        toPos = getJackPosition(to, findJack(toPedal, 'input'), toPedal);
      } else {
        toPos = { x: to.xInches + 2, y: to.yInches + 2 };
      }

      addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
        calculateDistance(fromPos, toPos) * ROUTING_OVERHEAD, 'patch', sortOrder++);
    }

    // Last before-loop pedal to loop pedal input
    if (beforeLoop.length > 0) {
      const lastBefore = beforeLoop[beforeLoop.length - 1];
      const lastBeforePedal = pedalsById[lastBefore.pedalId] || lastBefore.pedal;
      if (lastBeforePedal) {
        const outJack = findJack(lastBeforePedal, 'output');
        const inJack = findJack(loopPedalData, 'input');
        if (outJack && inJack) {
          addCable(cables, 'pedal', lastBefore.id, 'output', 'pedal', loopPedal.id, 'input',
            calculateDistance(getJackPosition(lastBefore, outJack, lastBeforePedal), getJackPosition(loopPedal, inJack, loopPedalData)) * ROUTING_OVERHEAD,
            'patch', sortOrder++);
        }
      }
    }

    // Loop pedal SEND to first drive pedal
    const sendJack = findJack(loopPedalData, 'send');
    const firstDrive = inLoop[0];
    const firstDrivePedal = pedalsById[firstDrive.pedalId] || firstDrive.pedal;
    if (sendJack && firstDrivePedal) {
      const driveInputJack = findJack(firstDrivePedal, 'input');
      if (driveInputJack) {
        addCable(cables, 'pedal', loopPedal.id, 'send', 'pedal', firstDrive.id, 'input',
          calculateDistance(getJackPosition(loopPedal, sendJack, loopPedalData), getJackPosition(firstDrive, driveInputJack, firstDrivePedal)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }
    }

    // Connect drive pedals in loop
    for (let i = 0; i < inLoop.length - 1; i++) {
      const from = inLoop[i];
      const to = inLoop[i + 1];
      const fromPedal = pedalsById[from.pedalId] || from.pedal;
      const toPedal = pedalsById[to.pedalId] || to.pedal;

      let fromPos: JackPosition;
      let toPos: JackPosition;

      if (fromPedal) {
        fromPos = getJackPosition(from, findJack(fromPedal, 'output'), fromPedal);
      } else {
        fromPos = { x: from.xInches, y: from.yInches + 2 };
      }

      if (toPedal) {
        toPos = getJackPosition(to, findJack(toPedal, 'input'), toPedal);
      } else {
        toPos = { x: to.xInches + 2, y: to.yInches + 2 };
      }

      addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
        calculateDistance(fromPos, toPos) * ROUTING_OVERHEAD, 'patch', sortOrder++);
    }

    // Last drive pedal to loop pedal RETURN
    const returnJack = findJack(loopPedalData, 'return');
    const lastDrive = inLoop[inLoop.length - 1];
    const lastDrivePedal = pedalsById[lastDrive.pedalId] || lastDrive.pedal;
    if (returnJack && lastDrivePedal) {
      const driveOutputJack = findJack(lastDrivePedal, 'output');
      if (driveOutputJack) {
        addCable(cables, 'pedal', lastDrive.id, 'output', 'pedal', loopPedal.id, 'return',
          calculateDistance(getJackPosition(lastDrive, driveOutputJack, lastDrivePedal), getJackPosition(loopPedal, returnJack, loopPedalData)) * ROUTING_OVERHEAD,
          'patch', sortOrder++);
      }
    }

    // Loop pedal OUTPUT to next pedal or amp
    const loopOutputJack = findJack(loopPedalData, 'output');
    if (loopOutputJack) {
      if (afterLoop.length > 0) {
        const nextPedal = afterLoop[0];
        const nextPedalData = pedalsById[nextPedal.pedalId] || nextPedal.pedal;
        if (nextPedalData) {
          const inJack = findJack(nextPedalData, 'input');
          if (inJack) {
            addCable(cables, 'pedal', loopPedal.id, 'output', 'pedal', nextPedal.id, 'input',
              calculateDistance(getJackPosition(loopPedal, loopOutputJack, loopPedalData), getJackPosition(nextPedal, inJack, nextPedalData)) * ROUTING_OVERHEAD,
              'patch', sortOrder++);
          }
        }
      } else {
        // Loop pedal to amp
        addCable(cables, 'pedal', loopPedal.id, 'output', 'amp_input', null, null,
          calculateDistance(getJackPosition(loopPedal, loopOutputJack, loopPedalData), getAmpInputPosition(board)) * ROUTING_OVERHEAD,
          'instrument', sortOrder++);
      }
    }

    // Connect afterLoop pedals
    for (let i = 0; i < afterLoop.length - 1; i++) {
      const from = afterLoop[i];
      const to = afterLoop[i + 1];
      const fromPedal = pedalsById[from.pedalId] || from.pedal;
      const toPedal = pedalsById[to.pedalId] || to.pedal;

      let fromPos: JackPosition;
      let toPos: JackPosition;

      if (fromPedal) {
        fromPos = getJackPosition(from, findJack(fromPedal, 'output'), fromPedal);
      } else {
        fromPos = { x: from.xInches, y: from.yInches + 2 };
      }

      if (toPedal) {
        toPos = getJackPosition(to, findJack(toPedal, 'input'), toPedal);
      } else {
        toPos = { x: to.xInches + 2, y: to.yInches + 2 };
      }

      addCable(cables, 'pedal', from.id, 'output', 'pedal', to.id, 'input',
        calculateDistance(fromPos, toPos) * ROUTING_OVERHEAD, 'patch', sortOrder++);
    }

    // Last afterLoop pedal to amp
    if (afterLoop.length > 0) {
      const lastAfter = afterLoop[afterLoop.length - 1];
      const lastAfterPedal = pedalsById[lastAfter.pedalId] || lastAfter.pedal;
      if (lastAfterPedal) {
        const outJack = findJack(lastAfterPedal, 'output');
        if (outJack) {
          addCable(cables, 'pedal', lastAfter.id, 'output', 'amp_input', null, null,
            calculateDistance(getJackPosition(lastAfter, outJack, lastAfterPedal), getAmpInputPosition(board)) * ROUTING_OVERHEAD,
            'instrument', sortOrder++);
        }
      }
    }

    return cables;
  }

  // === STANDARD ROUTING (no loop pedal) ===

  // Guitar to first front-of-amp pedal
  if (frontOfAmp.length > 0) {
    const firstPlaced = frontOfAmp[0];
    const firstPedal = pedalsById[firstPlaced.pedalId] || firstPlaced.pedal;
    if (firstPedal) {
      const inputJack = findJack(firstPedal, 'input');
      const guitarPos = getGuitarPosition(board);
      const jackPos = getJackPosition(firstPlaced, inputJack, firstPedal);
      addCable(cables, 'guitar', null, null, 'pedal', firstPlaced.id, 'input',
        calculateDistance(guitarPos, jackPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
    } else {
      // Pedal data missing - still add cable with estimated position
      const guitarPos = getGuitarPosition(board);
      const estimatedPos = { x: firstPlaced.xInches + 2, y: firstPlaced.yInches + 2 };
      addCable(cables, 'guitar', null, null, 'pedal', firstPlaced.id, 'input',
        calculateDistance(guitarPos, estimatedPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
    }
  }

  // Connect front-of-amp pedals in chain - ALWAYS connect adjacent pedals
  for (let i = 0; i < frontOfAmp.length - 1; i++) {
    const fromPlaced = frontOfAmp[i];
    const toPlaced = frontOfAmp[i + 1];
    const fromPedal = pedalsById[fromPlaced.pedalId] || fromPlaced.pedal;
    const toPedal = pedalsById[toPlaced.pedalId] || toPlaced.pedal;

    // Calculate positions - use pedal data if available, otherwise estimate
    let fromPos: JackPosition;
    let toPos: JackPosition;

    if (fromPedal) {
      const outputJack = findJack(fromPedal, 'output');
      fromPos = getJackPosition(fromPlaced, outputJack, fromPedal);
    } else {
      fromPos = { x: fromPlaced.xInches, y: fromPlaced.yInches + 2 };
    }

    if (toPedal) {
      const inputJack = findJack(toPedal, 'input');
      toPos = getJackPosition(toPlaced, inputJack, toPedal);
    } else {
      toPos = { x: toPlaced.xInches + 2, y: toPlaced.yInches + 2 };
    }

    addCable(cables, 'pedal', fromPlaced.id, 'output', 'pedal', toPlaced.id, 'input',
      calculateDistance(fromPos, toPos) * ROUTING_OVERHEAD, 'patch', sortOrder++);
  }

  // Last front-of-amp pedal to amp input
  if (frontOfAmp.length > 0) {
    const lastPlaced = frontOfAmp[frontOfAmp.length - 1];
    const lastPedal = pedalsById[lastPlaced.pedalId] || lastPlaced.pedal;

    let pedalPos: JackPosition;
    if (lastPedal) {
      const outputJack = findJack(lastPedal, 'output');
      pedalPos = getJackPosition(lastPlaced, outputJack, lastPedal);
    } else {
      pedalPos = { x: lastPlaced.xInches, y: lastPlaced.yInches + 2 };
    }

    const ampPos = getAmpInputPosition(board);
    addCable(cables, 'pedal', lastPlaced.id, 'output', 'amp_input', null, null,
      calculateDistance(pedalPos, ampPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
  } else {
    // No pedals, guitar straight to amp
    const guitarPos = getGuitarPosition(board);
    const ampPos = getAmpInputPosition(board);
    addCable(cables, 'guitar', null, null, 'amp_input', null, null,
      calculateDistance(guitarPos, ampPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
  }

  // Effects loop routing
  if (useEffectsLoop && amp?.hasEffectsLoop && effectsLoopPedals.length > 0) {
    // Amp send to first effects loop pedal
    const firstLoopPedal = effectsLoopPedals[0];
    const firstPedal = pedalsById[firstLoopPedal.pedalId] || firstLoopPedal.pedal;
    if (firstPedal) {
      const inputJack = findJack(firstPedal, 'input');
      if (inputJack) {
        const sendPos = getAmpSendPosition(board);
        const jackPos = getJackPosition(firstLoopPedal, inputJack, firstPedal);
        addCable(cables, 'amp_send', null, null, 'pedal', firstLoopPedal.id, 'input',
          calculateDistance(sendPos, jackPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
      }
    }

    // Connect effects loop pedals
    for (let i = 0; i < effectsLoopPedals.length - 1; i++) {
      const fromPlaced = effectsLoopPedals[i];
      const toPlaced = effectsLoopPedals[i + 1];
      const fromPedal = pedalsById[fromPlaced.pedalId] || fromPlaced.pedal;
      const toPedal = pedalsById[toPlaced.pedalId] || toPlaced.pedal;

      if (fromPedal && toPedal) {
        const outputJack = findJack(fromPedal, 'output');
        const inputJack = findJack(toPedal, 'input');

        if (outputJack && inputJack) {
          const fromPos = getJackPosition(fromPlaced, outputJack, fromPedal);
          const toPos = getJackPosition(toPlaced, inputJack, toPedal);
          addCable(cables, 'pedal', fromPlaced.id, 'output', 'pedal', toPlaced.id, 'input',
            calculateDistance(fromPos, toPos) * ROUTING_OVERHEAD, 'patch', sortOrder++);
        }
      }
    }

    // Last effects loop pedal to amp return
    const lastLoopPedal = effectsLoopPedals[effectsLoopPedals.length - 1];
    const lastPedal = pedalsById[lastLoopPedal.pedalId] || lastLoopPedal.pedal;
    if (lastPedal) {
      const outputJack = findJack(lastPedal, 'output');
      if (outputJack) {
        const pedalPos = getJackPosition(lastLoopPedal, outputJack, lastPedal);
        const returnPos = getAmpReturnPosition(board);
        addCable(cables, 'pedal', lastLoopPedal.id, 'output', 'amp_return', null, null,
          calculateDistance(pedalPos, returnPos) * ROUTING_OVERHEAD, 'instrument', sortOrder++);
      }
    }
  }

  return cables;
}

/**
 * Generate a grouped cable list for shopping/display
 */
export interface CableListItem {
  lengthInches: number;
  lengthDisplay: string;
  cableType: 'patch' | 'instrument' | 'power';
  count: number;
  description: string;
}

export function generateCableList(cables: CableConnection[]): CableListItem[] {
  const grouped = new Map<string, CableListItem>();

  for (const cable of cables) {
    const key = `${cable.cableType}-${cable.calculatedLengthInches}`;

    if (grouped.has(key)) {
      grouped.get(key)!.count++;
    } else {
      grouped.set(key, {
        lengthInches: cable.calculatedLengthInches,
        lengthDisplay: formatLength(cable.calculatedLengthInches),
        cableType: cable.cableType,
        count: 1,
        description: getCableDescription(cable.cableType),
      });
    }
  }

  // Sort by cable type, then by length
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.cableType !== b.cableType) {
      const typeOrder = { patch: 0, instrument: 1, power: 2 };
      return typeOrder[a.cableType] - typeOrder[b.cableType];
    }
    return a.lengthInches - b.lengthInches;
  });
}

function formatLength(inches: number): string {
  if (inches < 12) {
    return `${inches}"`;
  } else if (inches % 12 === 0) {
    return `${inches / 12}'`;
  } else {
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;
    return `${feet}'${remainingInches}"`;
  }
}

function getCableDescription(cableType: 'patch' | 'instrument' | 'power'): string {
  switch (cableType) {
    case 'patch':
      return 'Patch cable (pedal to pedal)';
    case 'instrument':
      return 'Instrument cable (guitar/amp connections)';
    case 'power':
      return 'Power cable';
  }
}

/**
 * Calculate total cable length for cost estimation
 */
export function calculateTotalCableLength(cables: CableConnection[]): {
  patch: number;
  instrument: number;
  power: number;
  total: number;
} {
  const result = { patch: 0, instrument: 0, power: 0, total: 0 };

  for (const cable of cables) {
    result[cable.cableType] += cable.calculatedLengthInches;
    result.total += cable.calculatedLengthInches;
  }

  return result;
}

// ============================================================================
// ENHANCED CABLE DISPLAY
// ============================================================================

/**
 * Enhanced cable representation for detailed wiring checklists
 */
export interface EnhancedCable {
  cableNumber: string;          // "1", "2a", "2b", etc.
  groupId: number;
  fromLabel: string;            // "Guitar output", "NS-2 SEND"
  toLabel: string;              // "NS-2 INPUT", "Wah INPUT"
  cableTypeLabel: string;       // "Instrument (10-15ft)", "Patch (6\")"
  lengthInches: number;
  cableType: 'patch' | 'instrument';
  isSubCable: boolean;
}

/**
 * Cable count summary by type
 */
export interface CableSummary {
  instrumentCount: number;
  patchCount: number;
  longCableCount: number;       // Cables > 24" (typically board-to-amp)
  totalCount: number;
}

/**
 * Signal flow segment for text-based diagram
 */
export interface SignalFlowSegment {
  label: string;                // "Guitar", "NS-2 INPUT", "[PREAMP]"
  isExternal: boolean;          // true for Guitar, Amp, Preamp markers
}

/**
 * Generate enhanced cable list with logical groupings and numbered cables
 *
 * Numbering logic:
 * - Consecutive patch cables get sub-letters (2a, 2b, 2c)
 * - Segment transitions (instrument cables) get new numbers
 * - Effects loop section starts new numbering group
 */
export function generateEnhancedCableList(
  cables: CableConnection[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  useEffectsLoop: boolean,
  amp: Amp | null
): EnhancedCable[] {
  if (cables.length === 0) return [];

  const result: EnhancedCable[] = [];
  let groupNumber = 1;
  let subIndex = 0;
  let lastCableType: 'patch' | 'instrument' | null = null;
  let inEffectsLoop = false;

  // Filter out power cables (not part of signal chain) and sort by sortOrder
  const sorted = [...cables]
    .filter(c => c.cableType !== 'power')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const cable of sorted) {
    // Detect effects loop section
    const isEffectsLoopCable = cable.fromType === 'amp_send' || cable.toType === 'amp_return';
    if (isEffectsLoopCable && !inEffectsLoop) {
      inEffectsLoop = true;
      // Start new group for effects loop
      groupNumber++;
      subIndex = 0;
      lastCableType = null;
    }

    // Determine if this starts a new group or continues as sub-cable
    const startsNewGroup = cable.cableType === 'instrument' ||
      lastCableType === null ||
      (lastCableType === 'instrument' && cable.cableType === 'patch');

    if (startsNewGroup) {
      if (lastCableType !== null) {
        groupNumber++;
      }
      subIndex = 0;
    } else {
      subIndex++;
    }

    // Generate cable number
    let cableNumber: string;
    if (cable.cableType === 'instrument' || subIndex === 0) {
      cableNumber = String(groupNumber);
    } else {
      cableNumber = `${groupNumber}${String.fromCharCode(97 + subIndex)}`; // 97 = 'a'
    }

    // Generate labels
    const fromLabel = getCableEndpointLabel(cable.fromType, cable.fromPedalId, cable.fromJackType, placedPedals, pedalsById);
    const toLabel = getCableEndpointLabel(cable.toType, cable.toPedalId, cable.toJackType, placedPedals, pedalsById);

    // Generate cable type label with length
    const lengthStr = formatLengthRange(cable.calculatedLengthInches);
    const typeStr = cable.cableType === 'instrument' ? 'Instrument' : 'Patch';
    const cableTypeLabel = `${typeStr} (${lengthStr})`;

    result.push({
      cableNumber,
      groupId: groupNumber,
      fromLabel,
      toLabel,
      cableTypeLabel,
      lengthInches: cable.calculatedLengthInches,
      cableType: cable.cableType as 'patch' | 'instrument',
      isSubCable: subIndex > 0,
    });

    lastCableType = cable.cableType as 'patch' | 'instrument';
  }

  return result;
}

/**
 * Generate text-based signal flow diagram
 */
export function generateSignalFlowDiagram(
  cables: CableConnection[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  useEffectsLoop: boolean,
  amp: Amp | null
): SignalFlowSegment[] {
  if (cables.length === 0) return [];

  const segments: SignalFlowSegment[] = [];
  const sorted = [...cables].sort((a, b) => a.sortOrder - b.sortOrder);

  // Track if we've added the preamp marker
  let addedPreamp = false;

  for (let i = 0; i < sorted.length; i++) {
    const cable = sorted[i];

    // Add "from" segment for first cable or transitions
    if (i === 0 || cable.fromType !== sorted[i - 1].toType) {
      const fromLabel = getFlowLabel(cable.fromType, cable.fromPedalId, cable.fromJackType, placedPedals, pedalsById, 'from');
      const isExternal = cable.fromType === 'guitar' || cable.fromType === 'amp_send';
      segments.push({ label: fromLabel, isExternal });
    }

    // Add [PREAMP] marker when entering effects loop
    if (!addedPreamp && cable.fromType === 'amp_send') {
      // Insert [PREAMP] before the amp_send
      const lastIdx = segments.length - 1;
      if (lastIdx >= 0) {
        segments.splice(lastIdx, 0, { label: '[PREAMP]', isExternal: true });
      }
      addedPreamp = true;
    }

    // Add "to" segment
    const toLabel = getFlowLabel(cable.toType, cable.toPedalId, cable.toJackType, placedPedals, pedalsById, 'to');
    const isExternal = cable.toType === 'amp_input' || cable.toType === 'amp_return';
    segments.push({ label: toLabel, isExternal });
  }

  // Add final amp marker if ending with amp_input (not effects loop)
  const lastCable = sorted[sorted.length - 1];
  if (lastCable.toType === 'amp_return' && amp?.hasEffectsLoop) {
    segments.push({ label: '[POWER AMP]', isExternal: true });
    segments.push({ label: 'Speaker', isExternal: true });
  } else if (lastCable.toType === 'amp_input' && !useEffectsLoop) {
    segments.push({ label: 'Speaker', isExternal: true });
  }

  return segments;
}

/**
 * Calculate cable count summary by type
 */
export function calculateCableSummary(cables: CableConnection[]): CableSummary {
  let instrumentCount = 0;
  let patchCount = 0;
  let longCableCount = 0;

  for (const cable of cables) {
    if (cable.cableType === 'instrument') {
      instrumentCount++;
    } else if (cable.cableType === 'patch') {
      patchCount++;
    }

    // Long cables are typically > 24" (used for board-to-amp connections)
    if (cable.calculatedLengthInches > 24) {
      longCableCount++;
    }
  }

  return {
    instrumentCount,
    patchCount,
    longCableCount,
    totalCount: cables.length,
  };
}

// ============================================================================
// HELPER FUNCTIONS FOR ENHANCED DISPLAY
// ============================================================================

/**
 * Get a label for a cable endpoint (for wiring checklist)
 */
function getCableEndpointLabel(
  type: CableConnection['fromType'] | CableConnection['toType'],
  pedalId: string | null,
  jackType: string | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>
): string {
  switch (type) {
    case 'guitar':
      return 'Guitar output';
    case 'amp_input':
      return 'Amp INPUT';
    case 'amp_send':
      return 'Amp SEND';
    case 'amp_return':
      return 'Amp RETURN';
    case 'pedal':
      if (pedalId) {
        const placed = placedPedals.find(p => p.id === pedalId);
        if (placed) {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (pedal) {
            const jackLabel = jackType ? jackType.toUpperCase() : 'INPUT';
            return `${pedal.name} ${jackLabel}`;
          }
        }
      }
      return `Pedal ${jackType?.toUpperCase() || 'INPUT'}`;
    default:
      return 'Unknown';
  }
}

/**
 * Get a label for signal flow diagram (shorter than wiring checklist)
 */
function getFlowLabel(
  type: CableConnection['fromType'] | CableConnection['toType'],
  pedalId: string | null,
  jackType: string | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  direction: 'from' | 'to'
): string {
  switch (type) {
    case 'guitar':
      return 'Guitar';
    case 'amp_input':
      return 'Amp INPUT';
    case 'amp_send':
      return 'SEND';
    case 'amp_return':
      return 'RETURN';
    case 'pedal':
      if (pedalId) {
        const placed = placedPedals.find(p => p.id === pedalId);
        if (placed) {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (pedal) {
            // For send/return jacks, show the jack type
            if (jackType === 'send' || jackType === 'return') {
              return `${pedal.name} ${jackType.toUpperCase()}`;
            }
            return pedal.name;
          }
        }
      }
      return 'Pedal';
    default:
      return 'Unknown';
  }
}

/**
 * Format cable length as a range (for practical purchasing)
 */
function formatLengthRange(inches: number): string {
  if (inches <= 6) return '6"';
  if (inches <= 12) return '12"';
  if (inches <= 18) return '18"';
  if (inches <= 24) return '24"';
  if (inches <= 36) return '3ft';
  if (inches <= 48) return '4ft';
  if (inches <= 72) return '6ft';
  if (inches <= 120) return '10ft';
  if (inches <= 180) return '15ft';
  return `${Math.ceil(inches / 12)}ft`;
}
