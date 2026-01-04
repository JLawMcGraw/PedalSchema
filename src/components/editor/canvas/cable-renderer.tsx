'use client';

import type { Cable, PlacedPedal, Pedal, Board } from '@/types';

interface CableRendererProps {
  cable: Cable;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  board: Board;
  scale: number;
}

export function CableRenderer({ cable, placedPedals, pedalsById, board, scale }: CableRendererProps) {
  const boardWidth = board.widthInches * scale;
  const boardHeight = board.depthInches * scale;

  // Find the source and destination positions
  const getJackPosition = (
    type: string,
    pedalId: string | null,
    jackType: string | null
  ): { x: number; y: number } | null => {
    if (type === 'guitar') {
      // Guitar input on the right side of the board
      return { x: boardWidth + 60, y: boardHeight / 2 };
    }

    if (type === 'amp_input') {
      // Amp input on the left side of the board
      return { x: -60, y: boardHeight / 2 };
    }

    if (type === 'amp_send') {
      return { x: -60, y: boardHeight * 0.3 };
    }

    if (type === 'amp_return') {
      return { x: -60, y: boardHeight * 0.7 };
    }

    if (type === 'pedal' && pedalId && jackType) {
      const placed = placedPedals.find((p) => p.id === pedalId);
      if (!placed) {
        // Fallback: use center of board if pedal not found
        return { x: boardWidth / 2, y: boardHeight / 2 };
      }

      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (!pedal) {
        return { x: placed.xInches * scale + 50, y: placed.yInches * scale + 50 };
      }

      // Find the jack - try exact match first, then fallback
      let jack = pedal.jacks?.find((j) => j.jackType === jackType);

      // If no jack found, try to find any input/output jack as fallback
      if (!jack && pedal.jacks && pedal.jacks.length > 0) {
        if (jackType === 'input' || jackType === 'send') {
          jack = pedal.jacks.find((j) => j.jackType === 'input') ||
                 pedal.jacks.find((j) => j.side === 'right');
        } else if (jackType === 'output' || jackType === 'return') {
          jack = pedal.jacks.find((j) => j.jackType === 'output') ||
                 pedal.jacks.find((j) => j.side === 'left');
        }
      }

      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      const width = (isRotated ? pedal.depthInches : pedal.widthInches) * scale;
      const height = (isRotated ? pedal.widthInches : pedal.depthInches) * scale;
      const x = placed.xInches * scale;
      const y = placed.yInches * scale;

      // If still no jack, use pedal center based on jack type hint
      if (!jack) {
        if (jackType === 'input' || jackType === 'send') {
          return { x: x + width, y: y + height / 2 }; // Right side
        } else {
          return { x, y: y + height / 2 }; // Left side
        }
      }

      // Calculate jack position
      let side = jack.side;
      if (isRotated) {
        const rotationSteps = placed.rotationDegrees / 90;
        const sides = ['top', 'right', 'bottom', 'left'] as const;
        const currentIndex = sides.indexOf(side);
        side = sides[(currentIndex + rotationSteps) % 4];
      }

      switch (side) {
        case 'top':
          return { x: x + (width * jack.positionPercent) / 100, y };
        case 'bottom':
          return { x: x + (width * jack.positionPercent) / 100, y: y + height };
        case 'left':
          return { x, y: y + (height * jack.positionPercent) / 100 };
        case 'right':
          return { x: x + width, y: y + (height * jack.positionPercent) / 100 };
      }
    }

    return null;
  };

  const fromPos = getJackPosition(cable.fromType, cable.fromPedalId, cable.fromJack);
  const toPos = getJackPosition(cable.toType, cable.toPedalId, cable.toJack);

  if (!fromPos || !toPos) return null;

  // Calculate control points for a nice bezier curve
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Create a curved path - curve downward (positive Y is down in SVG)
  const curveAmount = Math.min(distance * 0.3, 40); // Limit curve for short cables
  const midX = (fromPos.x + toPos.x) / 2;
  const midY = Math.max(fromPos.y, toPos.y) + curveAmount;

  const path = `M ${fromPos.x} ${fromPos.y} Q ${midX} ${midY} ${toPos.x} ${toPos.y}`;

  // Color by cable type
  const cableColor =
    cable.cableType === 'instrument' ? '#f59e0b' : // amber for instrument cables
    cable.cableType === 'power' ? '#ef4444' :      // red for power
    '#22c55e';                                      // green for patch cables

  return (
    <g className="cable" style={{ pointerEvents: 'none' }}>
      {/* Cable shadow for depth */}
      <path
        d={path}
        fill="none"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Main cable */}
      <path
        d={path}
        fill="none"
        stroke={cableColor}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Jack connection points */}
      <circle cx={fromPos.x} cy={fromPos.y} r={5} fill={cableColor} stroke="#000" strokeWidth={1} />
      <circle cx={toPos.x} cy={toPos.y} r={5} fill={cableColor} stroke="#000" strokeWidth={1} />
    </g>
  );
}
