'use client';

import type { RoutedCable } from '@/lib/engine/cables/route-cables';

// ============================================================================
// CABLE RENDERER COMPONENT (purely presentational)
//
// Routing happens once per state change in routeAllCables() (memoized by
// EditorCanvas). This component only draws a pre-routed cable, so it has no
// hooks and no early-return/hook-ordering hazards.
// ============================================================================

interface CableRendererProps {
  routed: RoutedCable;
}

/** Corner rounding radius for orthogonal cable bends, in px */
const CORNER_RADIUS = 6;

/**
 * Build an SVG path with rounded corners: each interior bend is shortened
 * by the radius on both sides and bridged with a quadratic curve through
 * the corner point. Falls back to sharp corners on segments shorter than
 * the radius allows.
 */
function roundedPath(path: { x: number; y: number }[]): string {
  if (path.length < 2) return '';
  let d = `M ${path[0].x} ${path[0].y}`;

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];

    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(CORNER_RADIUS, inLen / 2, outLen / 2);

    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const inX = curr.x - ((curr.x - prev.x) / inLen) * r;
    const inY = curr.y - ((curr.y - prev.y) / inLen) * r;
    const outX = curr.x + ((next.x - curr.x) / outLen) * r;
    const outY = curr.y + ((next.y - curr.y) / outLen) * r;

    d += ` L ${inX} ${inY} Q ${curr.x} ${curr.y} ${outX} ${outY}`;
  }

  const last = path[path.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function CableRenderer({ routed }: CableRendererProps) {
  const { cable, path, valid, fromPos, toPos } = routed;

  if (path.length < 2) return null;

  const pathD = roundedPath(path);

  // Cable colors by type - invalid paths shown in red
  const baseColor = cable.cableType === 'instrument' ? '#f59e0b' :
                    cable.cableType === 'power' ? '#ef4444' : '#22c55e';
  const color = valid ? baseColor : '#ef4444'; // Red for invalid paths

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
