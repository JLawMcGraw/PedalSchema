'use client';

import { useShallow } from 'zustand/react/shallow';
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration, INCHES_TO_PIXELS } from '@/store/derived';
import { BoardRenderer } from './board-renderer';
import { PedalRenderer } from './pedal-renderer';
import { CableRenderer } from './cable-renderer';
import { CableLegend } from './cable-legend';
import { snapToRail, findEmptySpot } from '@/lib/engine/collision';
import { getCategoryDefaultOrder } from '@/lib/constants/pedal-categories';
import { getExternalEndpointPx } from '@/lib/engine/cables/endpoints';
import { routeAllCables } from '@/lib/engine/cables/route-cables';
import { rotatedFootprint } from '@/lib/engine/geometry/rotation';
import { offsetToInches, PADDING_INCHES, PADDING_PX } from '@/lib/canvas/viewport';

/** How often cables reroute while a pedal is being dragged (ms) */
const DRAG_REROUTE_INTERVAL_MS = 90;

/**
 * Trailing-edge throttle: re-emits `value` at most every `ms`, always
 * settling on the latest value. Keeps per-mousemove state updates from
 * re-running the cable router on every frame.
 */
function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastEmit = useRef(0);

  useEffect(() => {
    // Always emit asynchronously (0ms on the leading edge) - a synchronous
    // setState here would cascade renders on every mousemove.
    const delay = Math.max(0, ms - (Date.now() - lastEmit.current));
    const timer = setTimeout(() => {
      lastEmit.current = Date.now();
      setThrottled(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return throttled;
}

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
    useEditorStore(
    useShallow((s) => ({ zoom: s.zoom, pan: s.pan, gridVisible: s.gridVisible, cablesVisible: s.cablesVisible, selectedPedalId: s.selectedPedalId, selectPedal: s.selectPedal, mode: s.mode, pedalToAdd: s.pedalToAdd, setPedalToAdd: s.setPedalToAdd }))
  );

  const { board, placedPedals, pedalsById, addPedal, movePedal, amp, useEffectsLoop } =
    useConfigurationStore(
    useShallow((s) => ({ board: s.board, placedPedals: s.placedPedals, pedalsById: s.pedalsById, addPedal: s.addPedal, movePedal: s.movePedal, amp: s.amp, useEffectsLoop: s.useEffectsLoop }))
  );

  // Routed cables and collisions are derived state - computed once per
  // configuration change and shared by every subscriber.
  const { cables, routedCables, collisions } = useDerivedConfiguration((d) => ({
    cables: d.cables,
    routedCables: d.routedCables,
    collisions: d.collisions,
  }));

  const fxLoopActive = useEffectsLoop && !!amp?.hasEffectsLoop;

  // Live rerouting while dragging: run the router against the dragged
  // pedal's preview position (throttled - mousemove fires per frame).
  // Cable TOPOLOGY doesn't change with position, so the derived `cables`
  // list is reused; only paths are recomputed.
  const throttledDragPosition = useThrottledValue(dragPosition, DRAG_REROUTE_INTERVAL_MS);
  const previewRoutedCables = useMemo(() => {
    if (!dragState || !throttledDragPosition || !board) return null;
    const previewPedals = placedPedals.map((p) =>
      p.id === dragState.pedalId
        ? { ...p, xInches: throttledDragPosition.x, yInches: throttledDragPosition.y }
        : p
    );
    return routeAllCables(cables, previewPedals, pedalsById, board, INCHES_TO_PIXELS, fxLoopActive);
  }, [dragState, throttledDragPosition, board, placedPedals, pedalsById, cables, fxLoopActive]);
  const displayedCables = previewRoutedCables ?? routedCables;

  // Convert screen coordinates to board coordinates
  /**
   * Screen point -> board inches.
   *
   * THIS USED TO BE WRONG IN THREE WAYS, and the errors hid each other:
   *
   *   const x = (screenX - rect.left) / zoom / INCHES_TO_PIXELS
   *             - PADDING_INCHES - pan.x / INCHES_TO_PIXELS;
   *
   *   1. it divided by `zoom`, but px-per-world-unit is `zoom * fitScale`;
   *   2. it ignored the xMidYMid letterbox offset entirely;
   *   3. it SUBTRACTED pan where the viewBox definition requires adding it.
   *
   * (2) and (3) cancelled because handleDragStart and handleDragMove both went
   * through the same wrong mapping and `pan` was permanently {0,0}. (1) did
   * not cancel - it is multiplicative - so a dragged pedal tracked the cursor
   * at exactly `fitScale` of its distance. Measured on J$ Home with an 80px
   * drag, before this change:
   *
   *     viewport 1440x900  fitScale 1.0182  moved 2.00in  (correct 1.96in)
   *     viewport 1100x800  fitScale 0.7045  moved 2.00in  (correct 2.84in)
   *     viewport  700x900  fitScale 0.7955  moved 2.00in  (correct 2.51in)
   *
   * measured/correct equalled fitScale in every case: on a 1100x800 window the
   * pedal lagged the cursor by 30%.
   *
   * The mapping now lives in `@/lib/canvas/viewport` as pure arithmetic - the
   * only form this repo can unit-test, since vitest runs in node with no DOM.
   * This function is the ONLY place the canvas reads getBoundingClientRect.
   */
  const screenToBoard = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      if (!svgRef.current || !board) return { x: 0, y: 0 };

      const rect = svgRef.current.getBoundingClientRect();
      // Reconstruct the viewBox exactly as rendered below. Kept in this shape
      // deliberately for now: this change fixes the mapping ONLY, so a
      // regression here cannot be blamed on a simultaneous viewBox change.
      const vb = {
        minX: -PADDING_PX + pan.x,
        minY: -PADDING_PX + pan.y,
        width: (board.widthInches * INCHES_TO_PIXELS + PADDING_PX * 2) / zoom,
        height: (board.depthInches * INCHES_TO_PIXELS + PADDING_PX * 2) / zoom,
      };
      return offsetToInches(vb, { width: rect.width, height: rect.height }, screenX - rect.left, screenY - rect.top);
    },
    [zoom, pan, board]
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
        const { widthInches: width, depthInches: depth } = rotatedFootprint(
          pedal,
          placed.rotationDegrees
        );

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
        // Stable handle for verification scripts. The page is full of lucide
        // icon <svg>s, and scripts used to find this one by picking the
        // largest by area - a heuristic that silently breaks the day a bigger
        // decorative SVG appears. See .claude/scripts/lib/twin.js.
        data-pedal-canvas=""
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

        {/* Signal chain endpoints, layered around the cables:
            1. Amp panel BODY renders UNDER cables (a cable crossing the
               panel edge reads as entering the amp)
            2. Cables
            3. Jack circles + labels (IN/SND/RTN) and the guitar icon render
               ON TOP so labels stay readable and cable ends look plugged in.
            Positions come from the shared endpoints module so the icons sit
            exactly where cables terminate. */}
        {cablesVisible && placedPedals.length > 0 && (
          <g transform={`translate(${getExternalEndpointPx('amp_input', board, INCHES_TO_PIXELS, fxLoopActive).x}, 0)`}>
            <rect
              x={-30}
              y={boardHeight * 0.1}
              width={60}
              height={boardHeight * 0.8}
              rx={8}
              fill="#1f2937"
              stroke="#374151"
              strokeWidth={2}
            />
            <text
              x={0}
              y={boardHeight * 0.1 - 8}
              textAnchor="middle"
              fill="#9ca3af"
              fontSize={11}
              fontWeight="bold"
            >
              AMP
            </text>
          </g>
        )}

        {/* Cables (above the amp panel body, under pedals and jack labels) */}
        {cablesVisible &&
          displayedCables.map((routed) => (
            <CableRenderer key={routed.cable.id} routed={routed} />
          ))}

        {/* Jack circles + labels and guitar icon - on top of cables */}
        {cablesVisible && placedPedals.length > 0 && (() => {
          const guitarPos = getExternalEndpointPx('guitar', board, INCHES_TO_PIXELS, fxLoopActive);
          const ampInputPos = getExternalEndpointPx('amp_input', board, INCHES_TO_PIXELS, fxLoopActive);
          const ampSendPos = getExternalEndpointPx('amp_send', board, INCHES_TO_PIXELS, fxLoopActive);
          const ampReturnPos = getExternalEndpointPx('amp_return', board, INCHES_TO_PIXELS, fxLoopActive);
          return (
          <>
            {/* Guitar icon on right */}
            <g transform={`translate(${guitarPos.x}, ${guitarPos.y})`}>
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

            {/* Amp jacks - shown based on FX loop state */}
            <g transform={`translate(${ampInputPos.x}, 0)`}>
              {/* Return jack (top) - only show when FX loop enabled */}
              {fxLoopActive && (
                <g transform={`translate(0, ${ampReturnPos.y})`}>
                  <circle r={12} fill="#374151" stroke="#22c55e" strokeWidth={2} />
                  <text x={0} y={4} textAnchor="middle" fill="#22c55e" fontSize={8} fontWeight="bold">
                    RTN
                  </text>
                </g>
              )}

              {/* Send jack (middle) - only show when FX loop enabled */}
              {fxLoopActive && (
                <g transform={`translate(0, ${ampSendPos.y})`}>
                  <circle r={12} fill="#374151" stroke="#3b82f6" strokeWidth={2} />
                  <text x={0} y={4} textAnchor="middle" fill="#3b82f6" fontSize={8} fontWeight="bold">
                    SND
                  </text>
                </g>
              )}

              {/* Input jack (bottom or center if no FX loop) */}
              <g transform={`translate(0, ${ampInputPos.y})`}>
                <circle r={12} fill="#374151" stroke="#f59e0b" strokeWidth={2} />
                <text x={0} y={4} textAnchor="middle" fill="#f59e0b" fontSize={8} fontWeight="bold">
                  IN
                </text>
              </g>
            </g>
          </>
          );
        })()}

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

      {/* What the colours and the dash mean, and why any red cable is red.
          Outside the <svg> so it ignores zoom and pan - a legend that shrinks
          when you zoom out is unreadable exactly when the board is busiest.
          Hidden with the cables, since it describes nothing when they are. */}
      {cablesVisible && (
        <CableLegend
          routedCables={displayedCables}
          placedPedals={placedPedals}
          pedalsById={pedalsById}
        />
      )}
    </div>
  );
}
