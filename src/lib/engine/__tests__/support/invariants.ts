/**
 * Shared geometric invariant checks for engine tests.
 *
 * These return violation descriptions (empty array = pass) so the matrix can
 * aggregate them with scenario context; unit tests can assert on emptiness.
 */

import type { Board, Pedal, PlacedPedal } from '@/types';
import type { Point, Box } from '../../geometry';
import type { RoutedCable } from '../../cables/route-cables';
import { generateObstacles } from '../../obstacles';
import { SCALE } from './fixtures';

/**
 * Sample every path segment at ~1px resolution; a sample strictly inside ANY
 * pedal body (except the source box on the first segment and destination box
 * on the last - the jack stubs) is the raw "cable drawn through a pedal"
 * failure, independent of margin policy.
 */
export function pathBodyViolations(
  path: Point[],
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number
): string[] {
  const violations: string[] = [];
  const lastSeg = path.length - 2;
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s];
    const b = path[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      for (let bi = 0; bi < boxes.length; bi++) {
        if (s === 0 && bi === fromBoxIdx) continue;
        if (s === lastSeg && bi === toBoxIdx) continue;
        const box = boxes[bi];
        if (
          px > box.x + 0.01 && px < box.x + box.width - 0.01 &&
          py > box.y + 0.01 && py < box.y + box.height - 0.01
        ) {
          violations.push(
            `point (${px.toFixed(1)},${py.toFixed(1)}) on segment ${s} inside box ${bi} ` +
            `(${box.x.toFixed(0)}-${(box.x + box.width).toFixed(0)}, ${box.y.toFixed(0)}-${(box.y + box.height).toFixed(0)})`
          );
          return violations; // one per path is enough
        }
      }
    }
  }
  return violations;
}

/** Cables (by valid flag) whose paths physically enter a pedal body */
export function cableBodyViolations(
  routedCables: RoutedCable[],
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board,
  options: { onlyValidCables: boolean }
): string[] {
  const obstacles = generateObstacles(placedPedals, pedalsById, board, SCALE);
  const violations: string[] = [];

  for (const rc of routedCables) {
    if (options.onlyValidCables && !rc.valid) continue;
    const fromBoxIdx = rc.cable.fromPedalId ? obstacles.pedalIdToBox.get(rc.cable.fromPedalId) ?? -1 : -1;
    const toBoxIdx = rc.cable.toPedalId ? obstacles.pedalIdToBox.get(rc.cable.toPedalId) ?? -1 : -1;
    for (const v of pathBodyViolations(rc.path, obstacles.boxes, fromBoxIdx, toBoxIdx)) {
      violations.push(`${cableLabel(rc)}: ${v}`);
    }
  }
  return violations;
}

function cableLabel(rc: RoutedCable): string {
  const end = (type: string, pedalId: string | null) =>
    type === 'pedal' ? `pedal:${pedalId?.slice(0, 14)}` : type;
  return `${end(rc.cable.fromType, rc.cable.fromPedalId)}→${end(rc.cable.toType, rc.cable.toPedalId)}`;
}

/**
 * Parallel runs from DIFFERENT cables that visually coincide
 * (< minGap apart perpendicular with > minOverlap shared length).
 * A rendered cable is ~8px wide, so minGap defaults to 9.
 */
export function laneViolations(
  routedCables: RoutedCable[],
  minGap: number = 9,
  minOverlap: number = 12
): string[] {
  interface Run { label: string; horizontal: boolean; fixed: number; lo: number; hi: number }
  const runs: Run[] = [];

  for (const rc of routedCables) {
    const pts = rc.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= minOverlap) {
        runs.push({ label: cableLabel(rc), horizontal: true, fixed: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      } else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= minOverlap) {
        runs.push({ label: cableLabel(rc), horizontal: false, fixed: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      }
    }
  }

  const violations: string[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const r1 = runs[i];
      const r2 = runs[j];
      if (r1.label === r2.label || r1.horizontal !== r2.horizontal) continue;
      const gap = Math.abs(r1.fixed - r2.fixed);
      const overlap = Math.min(r1.hi, r2.hi) - Math.max(r1.lo, r2.lo);
      if (gap < minGap && overlap > minOverlap) {
        violations.push(
          `${r1.label} and ${r2.label}: ${r1.horizontal ? 'h' : 'v'}-runs ${gap.toFixed(0)}px apart, ${overlap.toFixed(0)}px shared`
        );
      }
    }
  }
  return violations;
}

/** Pedal overlaps or out-of-bounds placements */
export function placementViolations(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  board: Board
): string[] {
  const violations: string[] = [];
  const boxes = placedPedals.map((p) => {
    const pedal = pedalsById[p.pedalId];
    const rot = p.rotationDegrees === 90 || p.rotationDegrees === 270;
    return {
      id: p.id,
      x: p.xInches,
      y: p.yInches,
      w: rot ? pedal.depthInches : pedal.widthInches,
      h: rot ? pedal.widthInches : pedal.depthInches,
    };
  });

  for (const b of boxes) {
    if (b.x < -0.01 || b.y < -0.01 || b.x + b.w > board.widthInches + 0.01 || b.y + b.h > board.depthInches + 0.01) {
      violations.push(`${b.id} out of bounds at (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > 0.01 && overlapY > 0.01) {
        violations.push(`${a.id} overlaps ${b.id} (${overlapX.toFixed(2)}" x ${overlapY.toFixed(2)}")`);
      }
    }
  }
  return violations;
}

/**
 * Physical chain order per segment:
 * - front chain: x-centers strictly decreasing (right-to-left) WITHIN each row
 * - loop chain: same, and the cluster packed near the amp-side edge
 */
export function chainOrderViolations(
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  useEffectsLoop: boolean
): string[] {
  const violations: string[] = [];

  const centerX = (p: PlacedPedal) => {
    const pedal = pedalsById[p.pedalId];
    const rot = p.rotationDegrees === 90 || p.rotationDegrees === 270;
    return p.xInches + (rot ? pedal.depthInches : pedal.widthInches) / 2;
  };

  const checkRowMonotonic = (chain: PlacedPedal[], name: string) => {
    const sorted = [...chain].sort((a, b) => a.chainPosition - b.chainPosition);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (Math.abs(a.yInches - b.yInches) > 1) continue; // row transition - exempt
      if (centerX(b) >= centerX(a)) {
        violations.push(
          `${name}: chain ${a.chainPosition}→${b.chainPosition} flows left-to-right within a row ` +
          `(x ${centerX(a).toFixed(2)} → ${centerX(b).toFixed(2)})`
        );
      }
    }
  };

  const front = useEffectsLoop
    ? placedPedals.filter((p) => p.location !== 'effects_loop')
    : placedPedals;
  const loop = useEffectsLoop
    ? placedPedals.filter((p) => p.location === 'effects_loop')
    : [];

  checkRowMonotonic(front, 'front');
  checkRowMonotonic(loop, 'loop');

  if (loop.length > 0) {
    const minLoopX = Math.min(...loop.map((p) => p.xInches));
    if (minLoopX > 0.75) {
      violations.push(`loop cluster not packed at amp side (leftmost x=${minLoopX.toFixed(2)})`);
    }
  }

  return violations;
}
