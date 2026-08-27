import { getFamilyColor, type PedalFamily } from '@/lib/constants/pedal-categories';
import { gearImageUrl } from '@/lib/gear-image';

/**
 * The hero: a 32x16in board that sorts itself at one real scale.
 *
 * Catalogue width and depth drive every pedal's SVG box, packing position,
 * animation offset, and cable endpoint. The fallback dimensions below exist
 * only for a failed catalogue read and use the same physical measurements;
 * they are not art-directed slot sizes.
 */

interface LandingPedal {
  imageUrl: string;
  widthInches: number;
  depthInches: number;
}

interface PedalSpec {
  key: string;
  family: PedalFamily;
  fallbackWidth: number;
  fallbackDepth: number;
}

interface ResolvedPedal extends PedalSpec {
  width: number;
  depth: number;
  imageUrl?: string;
}

/** Recorded catalogue dimensions, used only if the live catalogue read fails. */
const P: Record<string, PedalSpec> = {
  t0: { key: 'BOSS PW-3', family: 'shaping', fallbackWidth: 3.15, fallbackDepth: 7.56 },
  t1: { key: 'BOSS BD-2W', family: 'gain', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  t2: { key: 'BOSS DS-1', family: 'gain', fallbackWidth: 2.9, fallbackDepth: 5.1 },
  t3: { key: 'BOSS SD-1', family: 'gain', fallbackWidth: 2.9, fallbackDepth: 5.1 },
  t4: { key: 'BOSS GE-7', family: 'shaping', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  t5: { key: 'BOSS CE-2W', family: 'shaping', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  t6: { key: 'BOSS PH-3', family: 'shaping', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  t7: { key: 'BOSS TU-3', family: 'utility', fallbackWidth: 2.9, fallbackDepth: 5.1 },
  b0: { key: 'BOSS NS-2', family: 'utility', fallbackWidth: 2.9, fallbackDepth: 5.1 },
  b1: { key: 'BOSS BF-3', family: 'modulation', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  b2: { key: 'BOSS CH-1', family: 'modulation', fallbackWidth: 2.87, fallbackDepth: 5.08 },
  b3: { key: 'BOSS DD-7', family: 'time', fallbackWidth: 2.9, fallbackDepth: 5.1 },
  b4: { key: 'Strymon Timeline', family: 'time', fallbackWidth: 6.75, fallbackDepth: 5.1 },
  b5: { key: 'Strymon BigSky', family: 'time', fallbackWidth: 6.75, fallbackDepth: 5.1 },
  b6: { key: 'BOSS RV-6', family: 'time', fallbackWidth: 2.9, fallbackDepth: 5.1 },
};

export const LANDING_PEDAL_KEYS = Object.values(P).map((pedal) => pedal.key);

const TOP_IDS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
const BOTTOM_IDS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const TOP_Y = 0.7;
const BOTTOM_Y = 9.4;
const DUR = 12;
const STEP = 0.13;
const CABLE_AT = 6.7;
const CABLE_STEP = 0.08;
const ORDER = ['t7', 't6', 't5', 't4', 't3', 't2', 't1', 't0', 'b6', 'b5', 'b4', 'b3', 'b2', 'b1', 'b0'];

type Spot = { x: number; y: number };

function resolvePedals(catalogue: Record<string, LandingPedal>): Record<string, ResolvedPedal> {
  return Object.fromEntries(
    Object.entries(P).map(([id, spec]) => {
      const row = catalogue[spec.key];
      const valid = row?.widthInches > 0 && row?.depthInches > 0;
      return [
        id,
        {
          ...spec,
          width: valid ? row.widthInches : spec.fallbackWidth,
          depth: valid ? row.depthInches : spec.fallbackDepth,
          imageUrl: row?.imageUrl,
        },
      ];
    })
  );
}

function pack(
  ids: string[],
  startX: number,
  y: number,
  gap: number,
  pedals: Record<string, ResolvedPedal>
): Record<string, Spot> {
  let x = startX;
  const out: Record<string, Spot> = {};
  for (const id of ids) {
    out[id] = { x, y };
    x += pedals[id].width + gap;
  }
  return out;
}

function linkPedals(
  leftId: string,
  rightId: string,
  spots: Record<string, Spot>,
  pedals: Record<string, ResolvedPedal>
): string {
  const left = spots[leftId];
  const right = spots[rightId];
  const leftY = left.y + pedals[leftId].depth / 2;
  const rightY = right.y + pedals[rightId].depth / 2;
  const leftEdge = right.x;
  const rightEdge = left.x + pedals[leftId].width;
  const middle = (leftEdge + rightEdge) / 2;
  return `${leftEdge.toFixed(2)},${rightY.toFixed(2)} ${middle.toFixed(2)},${rightY.toFixed(2)} ${middle.toFixed(2)},${leftY.toFixed(2)} ${rightEdge.toFixed(2)},${leftY.toFixed(2)}`;
}

function cablePoints(
  spots: Record<string, Spot>,
  pedals: Record<string, ResolvedPedal>
): string[] {
  const segments: string[] = [];
  const topLast = TOP_IDS.at(-1)!;
  const bottomLast = BOTTOM_IDS.at(-1)!;
  const topLastY = spots[topLast].y + pedals[topLast].depth / 2;
  const bottomLastY = spots[bottomLast].y + pedals[bottomLast].depth / 2;
  const topLastRight = spots[topLast].x + pedals[topLast].width;
  const bottomLastRight = spots[bottomLast].x + pedals[bottomLast].width;

  segments.push(`34.2,${topLastY.toFixed(2)} ${topLastRight.toFixed(2)},${topLastY.toFixed(2)}`);
  for (let i = TOP_IDS.length - 1; i > 0; i--) {
    segments.push(linkPedals(TOP_IDS[i - 1], TOP_IDS[i], spots, pedals));
  }

  const topFirst = TOP_IDS[0];
  const topFirstY = spots[topFirst].y + pedals[topFirst].depth / 2;
  segments.push(
    `${spots[topFirst].x.toFixed(2)},${topFirstY.toFixed(2)} -1.6,${topFirstY.toFixed(2)} -1.6,7.85 33,7.85 33,${bottomLastY.toFixed(2)} ${bottomLastRight.toFixed(2)},${bottomLastY.toFixed(2)}`
  );
  for (let i = BOTTOM_IDS.length - 1; i > 0; i--) {
    segments.push(linkPedals(BOTTOM_IDS[i - 1], BOTTOM_IDS[i], spots, pedals));
  }

  const bottomFirst = BOTTOM_IDS[0];
  const bottomFirstY = spots[bottomFirst].y + pedals[bottomFirst].depth / 2;
  segments.push(
    `${spots[bottomFirst].x.toFixed(2)},${bottomFirstY.toFixed(2)} -2.8,${bottomFirstY.toFixed(2)} -2.8,14.4`
  );
  return segments;
}

const MONO = `0.95px 'Geist Mono', ui-monospace, monospace`;

export function AssemblingBoard({
  className,
  pedals: catalogue = {},
}: {
  className?: string;
  pedals?: Record<string, LandingPedal>;
}) {
  const pedals = resolvePedals(catalogue);
  const sorted = {
    ...pack(TOP_IDS, 0.6, TOP_Y, 0.75, pedals),
    ...pack(BOTTOM_IDS, 0.6, BOTTOM_Y, 0.45, pedals),
  };
  const shuffled = {
    ...pack(['t7', 't1', 't0', 'b1', 't3', 'b3', 't5', 't2'], 0.6, TOP_Y, 0.75, pedals),
    ...pack(['t4', 'b5', 'b0', 'b6', 'b2', 't6', 'b4'], 0.6, BOTTOM_Y, 0.45, pedals),
  };
  const cables = cablePoints(sorted, pedals);

  return (
    <div className={className}>
      <style>{`
        @keyframes psSort {
          0%{opacity:0;transform:translate(var(--dx),var(--dy))}
          3%{opacity:.88;transform:translate(var(--dx),var(--dy))}
          16%{opacity:.88;transform:translate(var(--dx),var(--dy))}
          48%{opacity:.88;transform:translate(0px,0px)}
          86%{opacity:.88;transform:translate(0px,0px)}
          93%{opacity:0;transform:translate(0px,0px)}
          100%{opacity:0;transform:translate(0px,0px)}
        }
        @keyframes psDraw {
          0%{opacity:0;stroke-dashoffset:60}
          2%{opacity:1}
          9%{stroke-dashoffset:0}
          72%{opacity:1;stroke-dashoffset:0}
          80%{opacity:0;stroke-dashoffset:0}
          100%{opacity:0;stroke-dashoffset:60}
        }
        @keyframes psFade{0%{opacity:0}6%{opacity:.85}72%{opacity:.85}80%{opacity:0}100%{opacity:0}}
        @keyframes psTag{0%{opacity:0}3%{opacity:1}14%{opacity:1}22%{opacity:0}100%{opacity:0}}

        @media (prefers-reduced-motion: reduce) {
          .ps-board [style*="animation"] { animation: none !important; }
          .ps-board .ps-pedal { opacity: .88 !important; transform: none !important; }
          .ps-board .ps-cable { opacity: 1 !important; stroke-dashoffset: 0 !important; }
          .ps-board .ps-jacks { opacity: .85 !important; }
          .ps-board .ps-tag { opacity: 0 !important; }
        }
      `}</style>

      <svg
        viewBox="-3.5 -1.5 39 19.5"
        preserveAspectRatio="xMidYMid meet"
        className="ps-board block h-full w-full overflow-visible"
        role="img"
        aria-label="A 32 by 16 inch pedalboard with fifteen accurately scaled pedals sorting into signal-chain order, with cables drawn from the guitar to the amp."
      >
        <rect x="0" y="0" width="32" height="16" fill="oklch(0.29 0.011 250)" />
        {[0, 3.75, 7.5, 11.25].map((y) => (
          <rect key={y} x="0" y={y} width="32" height="0.6" fill="oklch(0.345 0.013 250)" />
        ))}

        {cables.map((points, i) => (
          <polyline
            key={points}
            className="ps-cable"
            points={points}
            fill="none"
            stroke="oklch(0.72 0.012 250)"
            strokeWidth="0.26"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="60"
            style={{
              opacity: 0,
              animation: `psDraw ${DUR}s ${(CABLE_AT + i * CABLE_STEP).toFixed(2)}s ease-out infinite`,
            }}
          />
        ))}

        {ORDER.map((id, i) => {
          const to = sorted[id];
          const from = shuffled[id];
          const pedal = pedals[id];
          return (
            <g
              key={id}
              className="ps-pedal"
              data-pedal-key={pedal.key}
              style={
                {
                  '--dx': `${(from.x - to.x).toFixed(2)}px`,
                  '--dy': `${(from.y - to.y).toFixed(2)}px`,
                  opacity: 0,
                  animation: `psSort ${DUR}s ${(i * STEP).toFixed(2)}s cubic-bezier(.65,0,.25,1) infinite`,
                } as React.CSSProperties
              }
            >
              {pedal.imageUrl ? (
                <image
                  href={gearImageUrl(pedal.imageUrl, 256)}
                  x={to.x}
                  y={to.y}
                  width={pedal.width}
                  height={pedal.depth}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <rect
                  x={to.x}
                  y={to.y}
                  width={pedal.width}
                  height={pedal.depth}
                  fill={getFamilyColor(pedal.family)}
                  rx="0.18"
                />
              )}
            </g>
          );
        })}

        <text
          className="ps-tag"
          x="-2.9"
          y="-0.4"
          fill="oklch(0.66 0.18 25)"
          style={{
            font: MONO,
            letterSpacing: '0.14em',
            opacity: 0,
            animation: `psTag ${DUR}s 0.3s ease-out infinite`,
          }}
        >
          UNSORTED
        </text>

        <g
          className="ps-jacks"
          style={{ opacity: 0, animation: `psFade ${DUR}s ${(CABLE_AT + 1.6).toFixed(2)}s ease-out infinite` }}
        >
          <text x="34.2" y="-0.4" textAnchor="end" fill="oklch(0.72 0.012 250)" style={{ font: MONO, letterSpacing: '0.14em' }}>
            GUITAR IN
          </text>
          <text x="-2.9" y="15.1" fill="oklch(0.72 0.012 250)" style={{ font: MONO, letterSpacing: '0.14em' }}>
            AMP
          </text>
        </g>
      </svg>
    </div>
  );
}
