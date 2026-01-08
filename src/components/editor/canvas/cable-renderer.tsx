'use client';

import type { Cable, PlacedPedal, Pedal, Board } from '@/types';
import {
  Point,
  Box,
  STANDOFF,
  OBSTACLE_MARGIN,
  getStandoffPoint,
  dist,
  findPathAStar,
  validateRoute,
  smoothPath,
  lineIntersectsBox,
} from '@/lib/engine/pathfinding';

// Debug flags - set to false for production
const DEBUG_PATHS = false;

/**
 * Find a simple L-shaped path between two points.
 * Tries horizontal-then-vertical and vertical-then-horizontal.
 * Falls back to A* only if simple paths don't work.
 *
 * IMPORTANT: No exclusions - cables must never go through ANY pedal.
 */
function findSimpleLPath(
  from: Point,
  to: Point,
  boxes: Box[],
  excludeSet: Set<number>
): Point[] {
  const validBoxes = boxes.filter(b => b.width > 0 && b.height > 0);

  // Option 1: Horizontal first, then vertical (go across, then up/down)
  const midH = { x: to.x, y: from.y };
  const pathH = [from, midH, to];
  if (validateRoute(pathH, boxes, excludeSet)) {
    return pathH;
  }

  // Option 2: Vertical first, then horizontal (go up/down, then across)
  const midV = { x: from.x, y: to.y };
  const pathV = [from, midV, to];
  if (validateRoute(pathV, boxes, excludeSet)) {
    return pathV;
  }

  // Option 3: Route through a horizontal channel between pedal rows
  if (validBoxes.length > 0) {
    const yRanges = validBoxes.map(b => ({ top: b.y, bottom: b.y + b.height }));
    yRanges.sort((a, b) => a.top - b.top);

    // Try routing through Y gaps
    for (let i = 0; i < yRanges.length - 1; i++) {
      const gap = yRanges[i + 1].top - yRanges[i].bottom;
      if (gap > OBSTACLE_MARGIN * 2) {
        const channelY = yRanges[i].bottom + gap / 2;
        const pathChannel = [
          from,
          { x: from.x, y: channelY },
          { x: to.x, y: channelY },
          to
        ];
        if (validateRoute(pathChannel, boxes, excludeSet)) {
          return pathChannel;
        }
      }
    }

    // Try routing above all pedals
    const minY = Math.min(...yRanges.map(r => r.top));
    const aboveY = Math.max(10, minY - STANDOFF);
    const pathAbove = [from, { x: from.x, y: aboveY }, { x: to.x, y: aboveY }, to];
    if (validateRoute(pathAbove, boxes, excludeSet)) {
      return pathAbove;
    }

    // Try routing below all pedals
    const maxY = Math.max(...yRanges.map(r => r.bottom));
    const belowY = maxY + STANDOFF;
    const pathBelow = [from, { x: from.x, y: belowY }, { x: to.x, y: belowY }, to];
    if (validateRoute(pathBelow, boxes, excludeSet)) {
      return pathBelow;
    }
  }

  // Fallback: Use A* pathfinding with NO exclusions (must avoid all pedals)
  return findPathAStar(from, to, boxes, -1, -1);
}

// ============================================================================
// CABLE RENDERER COMPONENT
// ============================================================================

interface CableRendererProps {
  cable: Cable;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  board: Board;
  scale: number;
  cableIndex?: number;
  totalCables?: number;
  useEffectsLoop?: boolean;
}

export function CableRenderer({ cable, placedPedals, pedalsById, board, scale, useEffectsLoop }: CableRendererProps) {
  const boardWidth = board.widthInches * scale;
  const boardHeight = board.depthInches * scale;

  // Get jack position for a cable endpoint
  const getJackPosition = (type: string, pedalId: string | null, jackType: string | null): Point | null => {
    // External connections (guitar/amp)
    // When FX loop is enabled: return (top) -> send (middle) -> input (bottom)
    // When FX loop is disabled: input in center
    if (type === 'guitar') return { x: boardWidth + 60, y: boardHeight / 2 };
    if (type === 'amp_return') return { x: -60, y: boardHeight * 0.2 };  // Top - receives from last FX loop pedal
    if (type === 'amp_send') return { x: -60, y: boardHeight * 0.5 };    // Middle - sends to first FX loop pedal
    if (type === 'amp_input') return { x: -60, y: useEffectsLoop ? boardHeight * 0.8 : boardHeight * 0.5 };

    // Pedal jack connections
    if (type === 'pedal' && pedalId && jackType) {
      const placed = placedPedals.find((p) => p.id === pedalId);
      if (!placed) return null;

      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (!pedal) return { x: placed.xInches * scale + 50, y: placed.yInches * scale + 50 };

      // Find the specific jack or fall back to default positions
      let jack = pedal.jacks?.find((j) => j.jackType === jackType);
      if (!jack && pedal.jacks?.length) {
        jack = jackType === 'input' || jackType === 'send'
          ? pedal.jacks.find((j) => j.jackType === 'input') || pedal.jacks.find((j) => j.side === 'right')
          : pedal.jacks.find((j) => j.jackType === 'output') || pedal.jacks.find((j) => j.side === 'left');
      }

      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      const w = (isRotated ? pedal.depthInches : pedal.widthInches) * scale;
      const h = (isRotated ? pedal.widthInches : pedal.depthInches) * scale;
      const x = placed.xInches * scale;
      const y = placed.yInches * scale;

      if (!jack) {
        // Default jack positions: input on right, output on left
        return jackType === 'input' || jackType === 'send'
          ? { x: x + w, y: y + h / 2 }
          : { x, y: y + h / 2 };
      }

      // Calculate jack position based on side and rotation
      let side = jack.side;
      if (isRotated) {
        const steps = placed.rotationDegrees / 90;
        const sides = ['top', 'right', 'bottom', 'left'] as const;
        side = sides[(sides.indexOf(side) + steps) % 4];
      }

      switch (side) {
        case 'top': return { x: x + (w * jack.positionPercent) / 100, y };
        case 'bottom': return { x: x + (w * jack.positionPercent) / 100, y: y + h };
        case 'left': return { x, y: y + (h * jack.positionPercent) / 100 };
        case 'right': return { x: x + w, y: y + (h * jack.positionPercent) / 100 };
      }
    }
    return null;
  };

  // Get cable endpoints
  const fromPos = getJackPosition(cable.fromType, cable.fromPedalId, cable.fromJack);
  const toPos = getJackPosition(cable.toType, cable.toPedalId, cable.toJack);
  if (!fromPos || !toPos) return null;

  // Build obstacle boxes from placed pedals
  // IMPORTANT: Don't filter - indices must match placedPedals for fromBoxIdx/toBoxIdx
  const boxes: Box[] = placedPedals.map((placed) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return { x: 0, y: 0, width: 0, height: 0 };

    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    return {
      x: placed.xInches * scale,
      y: placed.yInches * scale,
      width: (isRotated ? pedal.depthInches : pedal.widthInches) * scale,
      height: (isRotated ? pedal.widthInches : pedal.depthInches) * scale,
    };
  });

  // Find box indices for source and destination pedals
  const fromBoxIdx = cable.fromPedalId
    ? placedPedals.findIndex(p => p.id === cable.fromPedalId)
    : -1;
  const toBoxIdx = cable.toPedalId
    ? placedPedals.findIndex(p => p.id === cable.toPedalId)
    : -1;

  if (DEBUG_PATHS) {
    const srcName = fromBoxIdx >= 0 ? (pedalsById[placedPedals[fromBoxIdx].pedalId]?.name || 'unknown') : cable.fromType;
    const dstName = toBoxIdx >= 0 ? (pedalsById[placedPedals[toBoxIdx].pedalId]?.name || 'unknown') : cable.toType;
    console.log(`[Cable] ${srcName} → ${dstName} | from:(${fromPos.x.toFixed(0)},${fromPos.y.toFixed(0)}) to:(${toPos.x.toFixed(0)},${toPos.y.toFixed(0)}) | boxes:${boxes.length} exclude:[${fromBoxIdx},${toBoxIdx}]`);

  }

  // Log boxes once - for cable from guitar (first cable)
  if (DEBUG_PATHS && cable.fromType === 'guitar') {
    const boxStr = boxes.map((box, i) => {
      const name = pedalsById[placedPedals[i]?.pedalId]?.name || `b${i}`;
      return `${i}:${name}(${box.x.toFixed(0)}-${(box.x+box.width).toFixed(0)},${box.y.toFixed(0)}-${(box.y+box.height).toFixed(0)})`;
    }).join(' ');
    console.log(`[BOXES] ${boxStr}`);
  }

  // NO EXCLUSIONS - cables must never go through ANY pedal
  const noExclusions = new Set<number>();

  // SIMPLIFIED ROUTING: Try simple paths first, only use A* as fallback
  let path: Point[];

  // Strategy 1: Direct line (for very close jacks)
  const jackDistance = dist(fromPos, toPos);
  if (jackDistance <= 80 && validateRoute([fromPos, toPos], boxes, noExclusions)) {
    path = [fromPos, toPos];
  } else {
    // Strategy 2: Simple L-shaped routing
    path = findSimpleLPath(fromPos, toPos, boxes, noExclusions);
  }

  if (DEBUG_PATHS) {
    const srcName = fromBoxIdx >= 0 ? (pedalsById[placedPedals[fromBoxIdx].pedalId]?.name || 'unknown') : cable.fromType;
    const dstName = toBoxIdx >= 0 ? (pedalsById[placedPedals[toBoxIdx].pedalId]?.name || 'unknown') : cable.toType;
    console.log(`[PATH] ${srcName} → ${dstName} (${path.length}pts): ${path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ')}`);
  }

  // Generate SVG path
  const pathD = 'M ' + path.map(p => `${p.x} ${p.y}`).join(' L ');

  // Cable colors by type
  const color = cable.cableType === 'instrument' ? '#f59e0b' :
                cable.cableType === 'power' ? '#ef4444' : '#22c55e';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Cable shadow for depth */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cable line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Jack connection points */}
      <circle cx={fromPos.x} cy={fromPos.y} r={5} fill={color} stroke="#000" strokeWidth={1} />
      <circle cx={toPos.x} cy={toPos.y} r={5} fill={color} stroke="#000" strokeWidth={1} />
    </g>
  );
}
