'use client';

import type { Board } from '@/types';

interface BoardRendererProps {
  board: Board;
  scale: number;
}

export function BoardRenderer({ board, scale }: BoardRendererProps) {
  const width = board.widthInches * scale;
  const height = board.depthInches * scale;
  const railWidth = (board.railWidthInches || 0.6) * scale;

  return (
    <g className="board">
      {/* Board background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="#1a1a1a"
        stroke="#333"
        strokeWidth={2}
        rx={4}
      />

      {/* Rails */}
      {board.rails?.map((rail, index) => {
        const railY = rail.positionFromBackInches * scale;

        return (
          <g key={rail.id || index}>
            {/* Rail */}
            <rect
              x={0}
              y={railY}
              width={width}
              height={railWidth}
              fill="#2a2a2a"
              stroke="#444"
              strokeWidth={1}
            />
            {/* Rail slots/holes (decorative) */}
            {Array.from({ length: Math.floor(board.widthInches / 2) }).map((_, i) => (
              <rect
                key={i}
                x={(i * 2 + 0.5) * scale}
                y={railY + railWidth * 0.25}
                width={scale}
                height={railWidth * 0.5}
                fill="#1a1a1a"
                rx={2}
              />
            ))}
          </g>
        );
      })}

      {/* Board dimensions label */}
      <text
        x={width / 2}
        y={height + 20}
        textAnchor="middle"
        fill="#666"
        fontSize={12}
        fontFamily="system-ui"
      >
        {board.widthInches}&quot; × {board.depthInches}&quot;
      </text>

      {/* Board name */}
      <text
        x={width / 2}
        y={-8}
        textAnchor="middle"
        fill="#888"
        fontSize={14}
        fontWeight={500}
        fontFamily="system-ui"
      >
        {board.manufacturer} {board.name}
      </text>
    </g>
  );
}
