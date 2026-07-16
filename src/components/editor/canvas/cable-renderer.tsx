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

export function CableRenderer({ routed }: CableRendererProps) {
  const { cable, path, valid, fromPos, toPos } = routed;

  if (path.length < 2) return null;

  // Generate SVG path
  const pathD = 'M ' + path.map(p => `${p.x} ${p.y}`).join(' L ');

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
