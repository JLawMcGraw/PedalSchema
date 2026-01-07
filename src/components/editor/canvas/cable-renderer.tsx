'use client';

import type { Cable, PlacedPedal, Pedal, Board } from '@/types';
import {
  Point,
  Box,
  STANDOFF,
  getStandoffPoint,
  dist,
  findPathAStar,
  validateRoute,
  smoothPath,
  lineIntersectsBox,
} from '@/lib/engine/pathfinding';

// Debug flags - set to false for production
const DEBUG_PATHS = false;

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

  // Calculate distance between jack positions
  const jackDistance = dist(fromPos, toPos);

  const fromBox = fromBoxIdx >= 0 ? boxes[fromBoxIdx] : null;
  const toBox = toBoxIdx >= 0 ? boxes[toBoxIdx] : null;

  // Determine routing strategy:
  // - Short distances (< 60px): direct routing, no standoffs needed - reduced from 120
  // - External connections: use standoff only on pedal side
  // - Long pedal-to-pedal: use standoffs on both sides
  const isShortDistance = jackDistance <= 60;
  const isFromExternal = !fromBox; // From guitar/amp
  const isToExternal = !toBox;     // To guitar/amp

  let path: Point[];

  if (isShortDistance) {
    // Short distance: route directly between jacks, excluding source/dest pedals
    path = findPathAStar(fromPos, toPos, boxes, fromBoxIdx, toBoxIdx);
  } else if (isFromExternal || isToExternal) {
    // External connection: try L-shaped routing first, fall back to A* if it collides
    const pedalBox = fromBox || toBox;
    const externalPos = fromBox ? toPos : fromPos;
    const pedalBoxIdx = fromBox ? fromBoxIdx : toBoxIdx;

    // Build exclude set for validation
    const extExcludeSet = new Set<number>();
    if (pedalBoxIdx >= 0) extExcludeSet.add(pedalBoxIdx);

    // Try multiple L-shaped path orientations
    let lPath: Point[] | null = null;

    if (fromBox) {
      // Pedal → External: jack → standoff → L-shape to external
      const pedalStandoff = getStandoffPoint(fromPos, fromBox, STANDOFF);
      const standoffIsVertical = Math.abs(pedalStandoff.x - fromPos.x) < 5;
      const midPoint = standoffIsVertical
        ? { x: externalPos.x, y: pedalStandoff.y }
        : { x: pedalStandoff.x, y: externalPos.y };
      const candidate = [fromPos, pedalStandoff, midPoint, externalPos];
      if (validateRoute(candidate, boxes, extExcludeSet)) {
        lPath = candidate;
      }
    } else {
      // External → Pedal: route through the open channel between pedal rows
      const box = boxes[toBoxIdx];

      // Find the best approach: from below the pedal (through the channel)
      const belowY = box.y + box.height + STANDOFF; // Below the pedal
      const aboveY = box.y - STANDOFF; // Above the pedal

      // Calculate approach point - prefer going through the channel
      const useBelow = fromPos.y > box.y; // External is below the pedal's top
      const approachY = useBelow ? belowY : aboveY;

      // Create approach point directly below/above the jack
      const approachPoint = { x: toPos.x, y: approachY };

      // Route: external → down to approach level → across to below pedal → up to jack
      const candidates: Point[][] = [];

      // Option 1: Go to approach Y first, then across, then to jack
      const route1Mid = { x: fromPos.x, y: approachY };
      candidates.push([fromPos, route1Mid, approachPoint, toPos]);

      // Option 2: Go across first, then down to approach, then to jack
      const route2Mid1 = { x: toPos.x, y: fromPos.y };
      candidates.push([fromPos, route2Mid1, approachPoint, toPos]);

      // Option 3: Use standoff-based approach as fallback
      const pedalStandoff = getStandoffPoint(toPos, toBox, STANDOFF);
      const horizMid = { x: pedalStandoff.x, y: fromPos.y };
      candidates.push([fromPos, horizMid, pedalStandoff, toPos]);

      for (const candidate of candidates) {
        if (validateRoute(candidate, boxes, extExcludeSet)) {
          lPath = candidate;
          break;
        }
      }
    }

    if (lPath) {
      path = lPath;
      if (DEBUG_PATHS) {
        console.log(`  [L-EXT] Using validated L-shaped external path`);
      }
    } else {
      // L-shaped paths collide - use A* pathfinding
      if (DEBUG_PATHS) {
        console.log(`  [A*-EXT] L-paths invalid, using A* for external connection`);
      }
      path = findPathAStar(fromPos, toPos, boxes, fromBoxIdx, toBoxIdx);
    }
  } else {
    // Long distance between two pedals: use standoffs on both sides
    const fromStandoff = getStandoffPoint(fromPos, fromBox, STANDOFF);
    const toStandoff = getStandoffPoint(toPos, toBox, STANDOFF);

    // Route between standoff points (which are outside pedal boxes)
    const routePath = findPathAStar(fromStandoff, toStandoff, boxes, -1, -1);

    // Build complete path: jack → standoff → [route] → standoff → jack
    path = [];

    // Add starting jack position
    path.push(fromPos);

    // Add from standoff if we have a source pedal
    if (fromBox) {
      path.push(fromStandoff);
    }

    // Add intermediate route points, skipping duplicates
    for (let i = 0; i < routePath.length; i++) {
      const pt = routePath[i];
      const lastPt = path[path.length - 1];
      // Skip if too close to last point
      if (Math.abs(pt.x - lastPt.x) > 15 || Math.abs(pt.y - lastPt.y) > 15) {
        path.push(pt);
      }
    }

    // Add to standoff if we have a destination pedal
    if (toBox) {
      const lastPt = path[path.length - 1];
      if (Math.abs(toStandoff.x - lastPt.x) > 15 || Math.abs(toStandoff.y - lastPt.y) > 15) {
        path.push(toStandoff);
      }
    }

    // Add ending jack position
    const lastPt = path[path.length - 1];
    if (Math.abs(toPos.x - lastPt.x) > 5 || Math.abs(toPos.y - lastPt.y) > 5) {
      path.push(toPos);
    }

    // Smooth out small zigzags
    path = smoothPath(path);
  }

  // Build exclude set for validation - ONLY exclude source and destination pedals
  const excludeSet = new Set<number>();
  if (fromBoxIdx >= 0) excludeSet.add(fromBoxIdx);
  if (toBoxIdx >= 0) excludeSet.add(toBoxIdx);

  // POST-VALIDATION: Check if the path collides with any non-excluded boxes
  const collisions: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
      if (excludeSet.has(boxIdx)) continue;
      const box = boxes[boxIdx];
      if (box.width === 0 || box.height === 0) continue;
      if (lineIntersectsBox(p1, p2, box, 0)) {
        const pedalName = pedalsById[placedPedals[boxIdx].pedalId]?.name || `box${boxIdx}`;
        collisions.push(`seg${i} hits ${pedalName}`);
      }
    }
  }
  const srcName = fromBoxIdx >= 0 ? (pedalsById[placedPedals[fromBoxIdx].pedalId]?.name || 'unknown') : cable.fromType;
  const dstName = toBoxIdx >= 0 ? (pedalsById[placedPedals[toBoxIdx].pedalId]?.name || 'unknown') : cable.toType;

  if (DEBUG_PATHS && collisions.length > 0) {
    console.error(`[COLLISION] ${srcName} → ${dstName}: ${collisions.join(', ')}`);
    console.error(`  Path: ${path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ')}`);
    console.error(`  Exclude set: [${Array.from(excludeSet).join(',')}]`);
  }

  // Log all paths for debugging
  if (DEBUG_PATHS) {
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
