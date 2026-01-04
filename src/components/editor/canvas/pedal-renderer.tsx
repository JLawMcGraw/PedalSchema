'use client';

import type { PlacedPedal, Pedal } from '@/types';
import { getCategoryColor } from '@/lib/constants/pedal-categories';

interface PedalRendererProps {
  placedPedal: PlacedPedal;
  pedal: Pedal;
  scale: number;
  isSelected: boolean;
  hasCollision: boolean;
  isDragging: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

export function PedalRenderer({
  placedPedal,
  pedal,
  scale,
  isSelected,
  hasCollision,
  isDragging,
  onDragStart,
  onClick,
}: PedalRendererProps) {
  const isRotated = placedPedal.rotationDegrees === 90 || placedPedal.rotationDegrees === 270;

  const x = placedPedal.xInches * scale;
  const y = placedPedal.yInches * scale;
  const width = (isRotated ? pedal.depthInches : pedal.widthInches) * scale;
  const height = (isRotated ? pedal.widthInches : pedal.depthInches) * scale;

  const centerX = x + width / 2;
  const centerY = y + height / 2;

  const categoryColor = getCategoryColor(pedal.category);

  // Truncate name to fit
  const maxChars = Math.floor(width / 8);
  const displayName = pedal.name.length > maxChars ? pedal.name.substring(0, maxChars - 1) + '…' : pedal.name;

  return (
    <g
      className="pedal"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onClick={onClick}
    >
      {/* Shadow when dragging */}
      {isDragging && (
        <rect
          x={x + 4}
          y={y + 4}
          width={width}
          height={height}
          fill="rgba(0,0,0,0.3)"
          rx={4}
        />
      )}

      {/* Pedal body */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={categoryColor}
        stroke={hasCollision ? '#ef4444' : isSelected ? '#3b82f6' : '#555'}
        strokeWidth={isSelected || hasCollision ? 3 : 1}
        rx={4}
        opacity={isDragging ? 0.8 : 1}
      />

      {/* Inactive overlay */}
      {!placedPedal.isActive && (
        <rect x={x} y={y} width={width} height={height} fill="rgba(0,0,0,0.5)" rx={4} />
      )}

      {/* Jack indicators */}
      {pedal.jacks?.map((jack, index) => {
        let jx: number, jy: number;
        const jackRadius = 4;

        // Calculate jack position based on side and percentage
        // Account for rotation
        let side = jack.side;
        if (isRotated) {
          const rotationSteps = placedPedal.rotationDegrees / 90;
          const sides = ['top', 'right', 'bottom', 'left'] as const;
          const currentIndex = sides.indexOf(side);
          side = sides[(currentIndex + rotationSteps) % 4];
        }

        switch (side) {
          case 'top':
            jx = x + (width * jack.positionPercent) / 100;
            jy = y;
            break;
          case 'bottom':
            jx = x + (width * jack.positionPercent) / 100;
            jy = y + height;
            break;
          case 'left':
            jx = x;
            jy = y + (height * jack.positionPercent) / 100;
            break;
          case 'right':
            jx = x + width;
            jy = y + (height * jack.positionPercent) / 100;
            break;
          default:
            jx = x;
            jy = y;
        }

        const jackColor =
          jack.jackType === 'input'
            ? '#22c55e'
            : jack.jackType === 'output'
            ? '#f59e0b'
            : jack.jackType === 'power'
            ? '#ef4444'
            : jack.jackType === 'send'
            ? '#06b6d4'
            : jack.jackType === 'return'
            ? '#8b5cf6'
            : '#6b7280';

        return (
          <circle
            key={index}
            cx={jx}
            cy={jy}
            r={jackRadius}
            fill={jackColor}
            stroke="white"
            strokeWidth={1}
          />
        );
      })}

      {/* Pedal name */}
      <text
        x={centerX}
        y={centerY - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={11}
        fontWeight={500}
        fontFamily="system-ui"
        className="pointer-events-none select-none"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {displayName}
      </text>

      {/* Manufacturer */}
      <text
        x={centerX}
        y={centerY + 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize={9}
        fontFamily="system-ui"
        className="pointer-events-none select-none"
      >
        {pedal.manufacturer}
      </text>

      {/* Chain position badge */}
      <circle cx={x + width - 10} cy={y + 10} r={10} fill="#1f2937" stroke="#6b7280" strokeWidth={1} />
      <text
        x={x + width - 10}
        y={y + 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={10}
        fontWeight={600}
        fontFamily="system-ui"
        className="pointer-events-none select-none"
      >
        {placedPedal.chainPosition}
      </text>

      {/* Collision warning */}
      {hasCollision && (
        <g>
          <circle cx={x + 12} cy={y + 12} r={10} fill="#ef4444" />
          <text
            x={x + 12}
            y={y + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize={14}
            fontWeight={700}
            fontFamily="system-ui"
            className="pointer-events-none select-none"
          >
            !
          </text>
        </g>
      )}

      {/* Selection ring */}
      {isSelected && (
        <rect
          x={x - 2}
          y={y - 2}
          width={width + 4}
          height={height + 4}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="4 2"
          rx={6}
          className="pointer-events-none"
        />
      )}
    </g>
  );
}
