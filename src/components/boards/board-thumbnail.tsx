import { getCategoryColor } from '@/lib/constants/pedal-categories';
import type { PedalCategory } from '@/types';

export interface ThumbnailPedal {
  xInches: number;
  yInches: number;
  widthInches: number;
  depthInches: number;
  rotation: number;
  category: PedalCategory;
}

/**
 * A board, at a glance.
 *
 * The dashboard used to describe boards in words - a name, the model of board,
 * "No description", a date - so two boards were told apart only by their
 * names. This app renders pedalboards; a list of them should show them.
 *
 * Deliberately NOT the editor canvas. No photos, no cables, no jacks, no
 * labels: a card 250px wide cannot carry any of that legibly, and loading 67
 * pedal images to draw a thumbnail would cost more than the page. Blocks in
 * their real positions, coloured by signal family, are enough to recognise a
 * board you built - which is the whole job here.
 *
 * Pure SVG with no client JS, so it renders on the server with the rest of the
 * card.
 */
export function BoardThumbnail({
  widthInches,
  depthInches,
  pedals,
  className,
}: {
  widthInches: number;
  depthInches: number;
  pedals: ThumbnailPedal[];
  className?: string;
}) {
  // Guard against a board row with no dimensions rather than emitting a
  // viewBox of "0 0 0 0", which renders as an invisible box with no warning.
  const w = widthInches > 0 ? widthInches : 24;
  const d = depthInches > 0 ? depthInches : 12;

  return (
    <svg
      viewBox={`0 0 ${w} ${d}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${pedals.length} pedal${pedals.length === 1 ? '' : 's'} on a ${w} by ${d} inch board`}
    >
      <rect x={0} y={0} width={w} height={d} rx={0.4} className="fill-muted" />
      {pedals.map((p, i) => {
        // A rotated pedal occupies its own footprint turned 90 degrees, and
        // ignoring that drew quarter-turn pedals overlapping their neighbours.
        const turned = Math.abs(p.rotation % 180) === 90;
        const pw = turned ? p.depthInches : p.widthInches;
        const ph = turned ? p.widthInches : p.depthInches;
        return (
          <rect
            key={i}
            x={p.xInches}
            y={p.yInches}
            width={pw}
            height={ph}
            rx={0.15}
            fill={getCategoryColor(p.category)}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
