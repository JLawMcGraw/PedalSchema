'use client';

import { useState } from 'react';
import type { PlacedPedal, Pedal } from '@/types';
import { getCategoryColor } from '@/lib/constants/pedal-categories';
import { rotateSide, rotatedFootprint } from '@/lib/engine/geometry/rotation';
import { jacksToRender } from '@/lib/engine/cables/endpoints';

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
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const footprint = rotatedFootprint(pedal, placedPedal.rotationDegrees);

  const x = placedPedal.xInches * scale;
  const y = placedPedal.yInches * scale;
  const width = footprint.widthInches * scale;
  const height = footprint.depthInches * scale;

  const centerX = x + width / 2;
  const centerY = y + height / 2;

  const categoryColor = getCategoryColor(pedal.category);

  const showImage = !!pedal.imageUrl && !imageError;
  // Photos are background-knocked-out silhouettes; while one is visible the
  // board itself shows around the pedal, so no body box is drawn under it.
  const showBodyBox = !showImage || !imageLoaded;
  // The photo shows the UNROTATED pedal face; draw it at natural dims
  // centered in the (possibly swapped) box and rotate it with the pedal.
  const imgWidth = pedal.widthInches * scale;
  const imgHeight = pedal.depthInches * scale;

  // Truncate name to fit
  const maxChars = Math.floor(width / 8);
  const displayName = pedal.name.length > maxChars ? pedal.name.substring(0, maxChars - 1) + '…' : pedal.name;

  return (
    <g
      className="pedal"
      // Lets a verification script confirm that a board->screen projection
      // actually lands on the pedal it aimed at, instead of assuming it did.
      data-pedal-id={placedPedal.id}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onClick={onClick}
    >
      {/* Shadow when dragging (box shadow only makes sense under the box) */}
      {isDragging && showBodyBox && (
        <rect
          x={x + 4}
          y={y + 4}
          width={width}
          height={height}
          fill="rgba(0,0,0,0.3)"
          rx={4}
        />
      )}

      {/* Pedal body (only when there is no photo, or while it loads) */}
      {showBodyBox && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={categoryColor}
          rx={4}
          opacity={isDragging ? 0.8 : 1}
        />
      )}

      {/* Pedal photo, clipped to the body and rotated with the pedal */}
      {showImage && (
        <>
          <defs>
            <clipPath id={`pedal-clip-${placedPedal.id}`}>
              <rect x={x} y={y} width={width} height={height} rx={4} />
            </clipPath>
          </defs>
          <g clipPath={`url(#pedal-clip-${placedPedal.id})`}>
            <image
              href={pedal.imageUrl!}
              x={centerX - imgWidth / 2}
              y={centerY - imgHeight / 2}
              width={imgWidth}
              height={imgHeight}
              transform={
                placedPedal.rotationDegrees
                  ? `rotate(${placedPedal.rotationDegrees}, ${centerX}, ${centerY})`
                  : undefined
              }
              preserveAspectRatio="none"
              opacity={isDragging ? 0.8 : placedPedal.isActive ? 1 : 0.35}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </g>
        </>
      )}

      {/* Body border: always for selection/collision, otherwise only on the box */}
      {(showBodyBox || isSelected || hasCollision) && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke={hasCollision ? '#ef4444' : isSelected ? '#3b82f6' : '#555'}
          strokeWidth={isSelected || hasCollision ? 3 : 1}
          rx={4}
        />
      )}

      {/* Inactive overlay (photos signal inactive via opacity instead) */}
      {!placedPedal.isActive && showBodyBox && (
        <rect x={x} y={y} width={width} height={height} fill="rgba(0,0,0,0.5)" rx={4} />
      )}

      {/* Jack indicators. Assumed jacks are drawn hollow - see jacksToRender. */}
      {jacksToRender(pedal).map((jack, index) => {
        let jx: number, jy: number;
        const jackRadius = 4;

        // Calculate jack position based on side and percentage, accounting for
        // rotation. This used to run only when the pedal was rotated 90/270, so
        // at 180 the dot stayed on its original edge while the cable (which
        // uses the same rule in cables/endpoints.ts) attached to the flipped
        // one - the drawing and the routing disagreed.
        const side = rotateSide(jack.side, placedPedal.rotationDegrees);

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

        // An assumed jack is drawn hollow, so a guess never looks like a
        // researched fact. Same position and colour, so it still reads as the
        // input or output it stands in for.
        return (
          <circle
            key={index}
            // Marks this circle as a JACK. The pedal group also holds the
            // chain-position badge and, on a collision, a warning dot - both
            // plain circles inside the same <g>. verify-jack-render counted
            // them as jacks and reported "3 recorded, 4 drawn", which reads as
            // a rendering bug and was a selector that could not tell a jack
            // from a badge.
            data-jack={jack.jackType}
            data-jack-assumed={jack.assumed ? '' : undefined}
            cx={jx}
            cy={jy}
            r={jackRadius}
            fill={jack.assumed ? 'none' : jackColor}
            stroke={jack.assumed ? jackColor : 'white'}
            strokeWidth={jack.assumed ? 1.5 : 1}
            strokeDasharray={jack.assumed ? '2 1.5' : undefined}
          />
        );
      })}

      {/* Name + manufacturer - the photo already shows the pedal face */}
      {!showImage && (
        <>
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
        </>
      )}

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
