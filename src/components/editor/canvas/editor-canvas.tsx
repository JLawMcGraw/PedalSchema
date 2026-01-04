'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { BoardRenderer } from './board-renderer';
import { PedalRenderer } from './pedal-renderer';
import { CableRenderer } from './cable-renderer';
import { snapToRail, findEmptySpot } from '@/lib/engine/collision';
import { getCategoryDefaultOrder } from '@/lib/constants/pedal-categories';

const INCHES_TO_PIXELS = 40; // 40px per inch at zoom 1
const PADDING_INCHES = 2;

interface DragState {
  pedalId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

export function EditorCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);

  const { zoom, pan, gridVisible, cablesVisible, selectedPedalId, selectPedal, mode, pedalToAdd, setPedalToAdd } =
    useEditorStore();

  const { board, placedPedals, pedalsById, cables, collisions, addPedal, movePedal } =
    useConfigurationStore();

  // Convert screen coordinates to board coordinates
  const screenToBoard = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      if (!svgRef.current) return { x: 0, y: 0 };

      const rect = svgRef.current.getBoundingClientRect();
      const x = (screenX - rect.left) / zoom / INCHES_TO_PIXELS - PADDING_INCHES - pan.x / INCHES_TO_PIXELS;
      const y = (screenY - rect.top) / zoom / INCHES_TO_PIXELS - PADDING_INCHES - pan.y / INCHES_TO_PIXELS;

      return { x, y };
    },
    [zoom, pan]
  );

  // Handle clicking to add pedal
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode === 'add-pedal' && pedalToAdd && board) {
        const pedal = pedalsById[pedalToAdd];
        if (!pedal) return;

        const pos = screenToBoard(e.clientX, e.clientY);

        // Snap to rail if close
        const snapped = snapToRail(pos, pedal.depthInches, board);

        // Estimate chain position based on category default order
        const newPedalOrder = getCategoryDefaultOrder(pedal.category);
        let estimatedChainPos = 1;
        for (const placed of placedPedals) {
          const existingPedal = pedalsById[placed.pedalId] || placed.pedal;
          if (existingPedal) {
            const existingOrder = getCategoryDefaultOrder(existingPedal.category);
            if (existingOrder < newPedalOrder) {
              estimatedChainPos = Math.max(estimatedChainPos, placed.chainPosition + 1);
            }
          }
        }

        // Find optimal position based on chain position
        const finalPos = findEmptySpot(pedal, placedPedals, pedalsById, board, estimatedChainPos) || snapped;

        if (finalPos) {
          addPedal(pedal, finalPos);
        }

        setPedalToAdd(null);
      } else if (mode === 'select') {
        // Deselect if clicking empty space
        selectPedal(null);
      }
    },
    [mode, pedalToAdd, board, pedalsById, placedPedals, addPedal, setPedalToAdd, screenToBoard, selectPedal]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (pedalId: string, e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      selectPedal(pedalId);

      const placed = placedPedals.find((p) => p.id === pedalId);
      if (!placed) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const boardPos = screenToBoard(clientX, clientY);

      setDragState({
        pedalId,
        startX: placed.xInches,
        startY: placed.yInches,
        offsetX: boardPos.x - placed.xInches,
        offsetY: boardPos.y - placed.yInches,
      });
    },
    [placedPedals, screenToBoard, selectPedal]
  );

  // Handle drag move
  const handleDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!dragState || !board) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const boardPos = screenToBoard(clientX, clientY);
      let newX = boardPos.x - dragState.offsetX;
      let newY = boardPos.y - dragState.offsetY;

      // Get pedal dimensions
      const placed = placedPedals.find((p) => p.id === dragState.pedalId);
      const pedal = placed ? pedalsById[placed.pedalId] : null;

      if (placed && pedal) {
        const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
        const width = isRotated ? pedal.depthInches : pedal.widthInches;
        const depth = isRotated ? pedal.widthInches : pedal.depthInches;

        // Snap to rail
        const snapped = snapToRail({ x: newX, y: newY }, depth, board);
        if (snapped.snapped) {
          newY = snapped.y;
        }

        // Constrain to board
        newX = Math.max(0, Math.min(newX, board.widthInches - width));
        newY = Math.max(0, Math.min(newY, board.depthInches - depth));
      }

      setDragPosition({ x: newX, y: newY });
    },
    [dragState, board, placedPedals, pedalsById, screenToBoard]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (dragState && dragPosition) {
      movePedal(dragState.pedalId, dragPosition);
    }
    setDragState(null);
    setDragPosition(null);
  }, [dragState, dragPosition, movePedal]);

  // Set up global mouse/touch listeners for drag
  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);

      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [dragState, handleDragMove, handleDragEnd]);

  if (!board) {
    return (
      <div className="flex items-center justify-center h-full bg-neutral-900 text-muted-foreground">
        Select a board to get started
      </div>
    );
  }

  const boardWidth = board.widthInches * INCHES_TO_PIXELS;
  const boardHeight = board.depthInches * INCHES_TO_PIXELS;
  const padding = PADDING_INCHES * INCHES_TO_PIXELS;
  const totalWidth = boardWidth + padding * 2;
  const totalHeight = boardHeight + padding * 2;

  return (
    <div className="relative w-full h-full overflow-hidden bg-neutral-900">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${-padding + pan.x} ${-padding + pan.y} ${totalWidth / zoom} ${totalHeight / zoom}`}
        onClick={handleCanvasClick}
        className={`select-none ${mode === 'add-pedal' ? 'cursor-crosshair' : 'cursor-default'}`}
        style={{ touchAction: 'none' }}
      >
        <defs>
          {/* Grid pattern */}
          <pattern
            id="grid-small"
            width={INCHES_TO_PIXELS / 4}
            height={INCHES_TO_PIXELS / 4}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${INCHES_TO_PIXELS / 4} 0 L 0 0 0 ${INCHES_TO_PIXELS / 4}`}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern
            id="grid-large"
            width={INCHES_TO_PIXELS}
            height={INCHES_TO_PIXELS}
            patternUnits="userSpaceOnUse"
          >
            <rect width={INCHES_TO_PIXELS} height={INCHES_TO_PIXELS} fill="url(#grid-small)" />
            <path
              d={`M ${INCHES_TO_PIXELS} 0 L 0 0 0 ${INCHES_TO_PIXELS}`}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* Grid background */}
        {gridVisible && (
          <rect
            x={-padding}
            y={-padding}
            width={totalWidth}
            height={totalHeight}
            fill="url(#grid-large)"
          />
        )}

        {/* Board */}
        <BoardRenderer board={board} scale={INCHES_TO_PIXELS} />

        {/* Signal chain endpoints - Guitar (right) and Amp (left) */}
        {cablesVisible && placedPedals.length > 0 && (
          <>
            {/* Guitar icon on right */}
            <g transform={`translate(${boardWidth + 60}, ${boardHeight / 2})`}>
              <circle r={20} fill="#374151" stroke="#f59e0b" strokeWidth={2} />
              <text
                x={0}
                y={5}
                textAnchor="middle"
                fill="#f59e0b"
                fontSize={10}
                fontWeight="bold"
              >
                🎸
              </text>
              <text
                x={0}
                y={35}
                textAnchor="middle"
                fill="#9ca3af"
                fontSize={10}
              >
                Guitar
              </text>
            </g>

            {/* Amp icon on left */}
            <g transform={`translate(-60, ${boardHeight / 2})`}>
              <circle r={20} fill="#374151" stroke="#f59e0b" strokeWidth={2} />
              <text
                x={0}
                y={5}
                textAnchor="middle"
                fill="#f59e0b"
                fontSize={10}
                fontWeight="bold"
              >
                🔊
              </text>
              <text
                x={0}
                y={35}
                textAnchor="middle"
                fill="#9ca3af"
                fontSize={10}
              >
                Amp
              </text>
            </g>
          </>
        )}

        {/* Cables (under pedals) */}
        {cablesVisible &&
          cables.map((cable) => (
            <CableRenderer
              key={cable.id}
              cable={cable}
              placedPedals={placedPedals}
              pedalsById={pedalsById}
              board={board}
              scale={INCHES_TO_PIXELS}
            />
          ))}

        {/* Pedals */}
        {placedPedals.map((placed) => {
          const pedal = pedalsById[placed.pedalId] || placed.pedal;
          if (!pedal) return null;

          const isDragging = dragState?.pedalId === placed.id;
          const position = isDragging && dragPosition ? dragPosition : { x: placed.xInches, y: placed.yInches };
          const hasCollision = collisions.some((c) => c.pedalIds.includes(placed.id));

          return (
            <PedalRenderer
              key={placed.id}
              placedPedal={{ ...placed, xInches: position.x, yInches: position.y }}
              pedal={pedal}
              scale={INCHES_TO_PIXELS}
              isSelected={selectedPedalId === placed.id}
              hasCollision={hasCollision}
              isDragging={isDragging}
              onDragStart={(e) => handleDragStart(placed.id, e)}
              onClick={(e) => {
                e.stopPropagation();
                selectPedal(placed.id);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
