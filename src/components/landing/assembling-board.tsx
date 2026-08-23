import { getFamilyColor, type PedalFamily } from '@/lib/constants/pedal-categories';

/**
 * The hero: a board that sorts itself.
 *
 * This is the one thing a static page cannot say - that the app takes a pile
 * of pedals and produces an order. A 32x16in board, 15 pedals, drawn to scale.
 * They start scattered under a red UNSORTED tag, slide into signal order,
 * cables draw through them, and the jack labels name the ends. 12s loop.
 *
 * HOW IT WORKS, because it is not obvious from the markup:
 *
 * - Every pedal is drawn at its SORTED position. Its scattered start is a
 *   per-element `--dx` / `--dy` offset, and one shared `@keyframes psSort`
 *   interpolates translate(var(--dx),var(--dy)) -> translate(0,0). Fifteen
 *   elements, one animation.
 * - The scatter PRESERVES EACH ROW'S TOTAL WIDTH, so nothing hangs off the
 *   board while unsorted. That is what makes the motion read as reordering
 *   rather than as pedals materialising out of the margin.
 * - CSS px INSIDE AN SVG RESOLVE TO USER UNITS, not screen px. Every offset
 *   here is authored in board inches, and reading them as pixels is the
 *   mistake that makes the whole thing twitch by a millimetre instead of
 *   crossing the board.
 * - Cables are polylines with stroke-dasharray:60, drawn by animating
 *   stroke-dashoffset from 6.7s, 0.08s apart, after the sort has settled.
 *
 * No client JS: it is CSS animation over static SVG, so it renders on the
 * server and costs the landing page no hydration.
 */

/** width in inches, family - the 15 pedals of the reference board. */
const P: Record<string, [number, PedalFamily]> = {
  t0: [5.5, 'shaping'], t1: [2.9, 'gain'], t2: [2.9, 'gain'], t3: [2.6, 'gain'],
  t4: [2.9, 'shaping'], t5: [2.9, 'shaping'], t6: [2.9, 'shaping'], t7: [2.9, 'utility'],
  b0: [2.9, 'utility'], b1: [2.9, 'modulation'], b2: [2.9, 'modulation'], b3: [2.9, 'time'],
  b4: [6.8, 'time'], b5: [6.8, 'time'], b6: [2.9, 'time'],
};

const TOP_Y = 0.7;
const BOT_Y = 9.4;
const DUR = 12;
const STEP = 0.13;
const CABLE_AT = 6.7;
const CABLE_STEP = 0.08;

type Spot = { x: number; y: number };

function pack(ids: string[], startX: number, y: number, gap: number): Record<string, Spot> {
  let x = startX;
  const out: Record<string, Spot> = {};
  for (const id of ids) {
    out[id] = { x, y };
    x += P[id][0] + gap;
  }
  return out;
}

/** Where each pedal belongs: gain and shaping up front, time and modulation after. */
const sorted = {
  ...pack(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'], 0.6, TOP_Y, 0.75),
  ...pack(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'], 0.6, BOT_Y, 0.45),
};

/** Where they start: same board, no order at all, row widths preserved. */
const shuffled = {
  ...pack(['t7', 't1', 't0', 'b1', 't3', 'b3', 't5', 't2'], 0.6, TOP_Y, 0.75),
  ...pack(['t4', 'b5', 'b0', 'b6', 'b2', 't6', 'b4'], 0.6, BOT_Y, 0.45),
};

const order = ['t7', 't6', 't5', 't4', 't3', 't2', 't1', 't0', 'b6', 'b5', 'b4', 'b3', 'b2', 'b1', 'b0'];

/*
 * The signal runs right to left along the top row, drops between the rows,
 * then right to left along the bottom - guitar in at the far right, amp at
 * the far left, which is the arrangement the editor's canvas now uses too.
 */
function cablePoints(): string[] {
  const top = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'].map((id) => ({
    ...sorted[id],
    w: P[id][0],
  }));
  const bot = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id) => ({
    ...sorted[id],
    w: P[id][0],
  }));
  const midT = 3.25;
  const midB = 11.95;
  const seg: string[] = [];
  const link = (a: { x: number; w: number }, b: { x: number }, y: number) =>
    `${(a.x + a.w).toFixed(2)},${y} ${b.x.toFixed(2)},${y}`;

  seg.push(`34.2,${midT} ${(top[7].x + top[7].w).toFixed(2)},${midT}`);
  for (let i = top.length - 1; i > 0; i--) seg.push(link(top[i - 1], top[i], midT));
  seg.push(`0.6,${midT} -1.6,${midT} -1.6,7.85 33,7.85 33,${midB} ${(bot[6].x + bot[6].w).toFixed(2)},${midB}`);
  for (let i = bot.length - 1; i > 0; i--) seg.push(link(bot[i - 1], bot[i], midB));
  seg.push(`0.6,${midB} -2.8,${midB} -2.8,14.4`);
  return seg;
}

const MONO = `0.95px 'Geist Mono', ui-monospace, monospace`;

export function AssemblingBoard({ className }: { className?: string }) {
  const cables = cablePoints();

  return (
    <div className={className}>
      {/*
        Scoped with a plain <style> rather than Tailwind: these are keyframes
        with a per-element custom property, which utility classes cannot
        express. `prefers-reduced-motion` holds the SORTED state and skips the
        scatter entirely - the board still reads correctly, it just does not
        move.
      */}
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
        aria-label="A 32 by 16 inch pedalboard with fifteen pedals sliding from a scattered heap into signal-chain order, with cables drawn between them from the guitar to the amp."
      >
        {/* The board and its four rails, to scale. */}
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

        {order.map((id, i) => {
          const to = sorted[id];
          const from = shuffled[id];
          return (
            <rect
              key={id}
              className="ps-pedal"
              x={to.x}
              y={to.y}
              width={P[id][0]}
              height="5.1"
              fill={getFamilyColor(P[id][1])}
              style={
                {
                  // Authored in BOARD INCHES. Inside an SVG these resolve to
                  // user units, which is the whole reason the numbers look
                  // small - see the note at the top of this file.
                  '--dx': `${(from.x - to.x).toFixed(2)}px`,
                  '--dy': `${(from.y - to.y).toFixed(2)}px`,
                  opacity: 0,
                  animation: `psSort ${DUR}s ${(i * STEP).toFixed(2)}s cubic-bezier(.65,0,.25,1) infinite`,
                } as React.CSSProperties
              }
            />
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
