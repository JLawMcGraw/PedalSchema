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
 * A board, at a glance, AT A SHARED SCALE.
 *
 * The dashboard used to describe boards in words, so two boards were told apart
 * only by their names. This app renders pedalboards; a list of them should show
 * them.
 *
 * SIZE HAS TO MEAN SIZE. The first version gave every board its own viewBox and
 * fitted it to the same 96px band, so each card drew at its own scale -
 * measured on the real dashboard, 7.68 px/inch for an 18x12.5in Classic Jr
 * against 6.00 for a 32x16in Classic Pro. A board 1.78x wider in the world
 * rendered 1.39x wider on screen, and every board was exactly 96px tall
 * whether it was 12.5 or 16 inches deep. On a page whose whole job is telling
 * boards apart, the drawing was carrying no size information at all - and
 * worse, it was carrying WRONG size information, because the smaller board was
 * drawn 28% too big relative to the larger one.
 *
 * So the caller passes a FRAME - the largest board on the page - and every
 * thumbnail draws into it. A Nano now looks like a Nano beside a Classic Pro.
 * The empty space around a small board is not waste; it is the comparison.
 *
 * Still deliberately NOT the editor canvas: no photos, no cables, no jacks, no
 * labels. A card 250px wide cannot carry any of that legibly, and loading 67
 * pedal images to draw a thumbnail would cost more than the page.
 *
 * Pure SVG with no client JS, so it renders on the server with the rest of the
 * card.
 */
export function BoardThumbnail({
  widthInches,
  depthInches,
  frameWidthInches,
  frameDepthInches,
  railPositionsFromBack = [],
  railWidthInches = 0,
  pedals,
  className,
}: {
  widthInches: number;
  depthInches: number;
  /** The largest board on the page, so every card shares one scale. */
  frameWidthInches?: number;
  frameDepthInches?: number;
  /** Rail centres, measured from the BACK edge - the same axis as pedal y. */
  railPositionsFromBack?: number[];
  railWidthInches?: number;
  pedals: ThumbnailPedal[];
  className?: string;
}) {
  // Guard against a board row with no dimensions rather than emitting a
  // viewBox of "0 0 0 0", which renders as an invisible box with no warning.
  const w = widthInches > 0 ? widthInches : 24;
  const d = depthInches > 0 ? depthInches : 12;

  // Absent frame means "this board is its own frame" - the single-card case,
  // where there is nothing to compare against and fitting is correct.
  const fw = Math.max(frameWidthInches ?? w, w);
  const fd = Math.max(frameDepthInches ?? d, d);

  // Centred in the frame, so the size difference reads as size and not as a
  // difference in alignment.
  const ox = (fw - w) / 2;
  const oy = (fd - d) / 2;

  // A rail with no recorded width still has to be visible at thumbnail scale.
  const railThickness = railWidthInches > 0 ? railWidthInches : Math.min(0.6, d * 0.05);

  return (
    <svg
      viewBox={`0 0 ${fw} ${fd}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${pedals.length} pedal${pedals.length === 1 ? '' : 's'} on a ${w} by ${d} inch board`}
    >
      <rect x={ox} y={oy} width={w} height={d} className="fill-muted" />

      {/* THE RAILS, because a Pedaltrain is a rail frame and not a slab - and
          because they are the constraint the rest of the app is about: they
          are where a pedal can actually be mounted. Drawn under the pedals, so
          a pedal reads as sitting ON them. */}
      {railPositionsFromBack.map((pos, i) => (
        <rect
          key={`rail-${i}`}
          x={ox}
          y={oy + Math.max(0, Math.min(pos, d - railThickness))}
          width={w}
          height={railThickness}
          className="fill-border"
        />
      ))}

      {pedals.map((p, i) => {
        // A rotated pedal occupies its own footprint turned 90 degrees, and
        // ignoring that drew quarter-turn pedals overlapping their neighbours.
        const turned = Math.abs(p.rotation % 180) === 90;
        const pw = turned ? p.depthInches : p.widthInches;
        const ph = turned ? p.widthInches : p.depthInches;
        return (
          <rect
            key={i}
            x={ox + p.xInches}
            y={oy + p.yInches}
            width={pw}
            height={ph}
            fill={getCategoryColor(p.category)}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
