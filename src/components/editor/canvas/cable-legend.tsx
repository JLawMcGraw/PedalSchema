'use client';

import type { Pedal, PlacedPedal } from '@/types';
import type { RoutedCable } from '@/lib/engine/cables/route-cables';
import {
  CABLE_LEGEND,
  cableAppearance,
  legendSwatch,
  explainRoutingFailure,
  type RoutingFailure,
} from '@/lib/engine/cables/explain';

/**
 * What the cables on the board mean, and - when one of them could not be
 * wired - why.
 *
 * Two things the canvas used to leave unsaid, joined because they are the same
 * question. The colour/dash vocabulary was undocumented anywhere in the app,
 * and an unroutable cable was drawn as a red line with no explanation at all:
 * it said "this cannot be wired" without saying what to move.
 *
 * Every fact here already existed on the routed cable and simply never reached
 * the screen - `laneOutcome` names which END could not find a channel, and
 * `validation.violations` names the pedals the red line runs through.
 *
 * An HTML overlay rather than SVG inside the canvas, so it does not scale with
 * zoom, does not pan away, and does not need pointer events on the cable
 * strokes - which are disabled for a load-bearing reason (see cable-renderer).
 */

interface CableLegendProps {
  routedCables: RoutedCable[];
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
}

/** A short line of the same stroke the canvas draws, at legend scale. */
function Swatch({ kind }: { kind: (typeof CABLE_LEGEND)[number]['kind'] }) {
  const { colour, dashed } = legendSwatch(kind);
  return (
    <svg width={26} height={10} viewBox="0 0 26 10" aria-hidden className="shrink-0">
      <line
        data-swatch={kind}
        x1={1}
        y1={5}
        x2={25}
        y2={5}
        stroke={colour}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={dashed ? '6 4' : undefined}
      />
    </svg>
  );
}

export function CableLegend({ routedCables, placedPedals, pedalsById }: CableLegendProps) {
  if (routedCables.length === 0) return null;

  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const placed = placedPedals.find((p) => p.id === id);
    if (!placed) return null;
    return pedalsById[placed.pedalId]?.name ?? placed.pedal?.name ?? null;
  };

  const failures = routedCables
    .map((routed) => explainRoutingFailure(routed, nameOf))
    .filter((f): f is RoutingFailure => f !== null);

  // Only the kinds actually on this board. A legend listing appearances the
  // user cannot see teaches them to ignore it.
  // `cableAppearance` owns this decision and the renderer makes the same call,
  // so a row can never appear for a kind the canvas is not drawing.
  const present = new Set(routedCables.map((r) => cableAppearance(r).kind));
  const entries = CABLE_LEGEND.filter((e) => present.has(e.kind));

  return (
    <div
      // Stable handles for verification scripts, same reason as
      // [data-pedal-canvas]: finding this box by its Tailwind classes would
      // break the first time the styling changed.
      data-cable-legend=""
      // BOTTOM of the canvas, and only as tall as it needs to be. The first
      // version was a 19rem block in the top-left and it covered four pedals
      // on the `test` board - a legend that hides the thing it explains. The
      // DOM cross-reference passed on that version; the screenshot is what
      // caught it, which is what screenshots are for.
      // Lifted clear of the mobile floating action buttons below lg, which
      // live at `bottom-4` in a SIBLING container (editor-client) and so
      // overlap this one - they are absolutely positioned in a different
      // stacking parent, not laid out against it.
      className="pointer-events-none absolute bottom-14 lg:bottom-3 left-3 right-3 flex flex-col items-start gap-2"
    >
      {failures.length > 0 && (
        <div className="pointer-events-auto max-w-[34rem] rounded-lg border border-red-900/60 bg-neutral-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
          <p className="mb-1 font-medium text-red-400">
            {failures.length === 1 ? '1 cable will not fit' : `${failures.length} cables will not fit`}
          </p>
          <ul className="space-y-1">
            {failures.map((failure) => (
              <li key={failure.label} data-legend-failure={failure.label} className="text-neutral-400">
                <span className="text-neutral-200">{failure.label}</span>
                {' — '}
                {failure.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-neutral-500">
            Move the pedals apart, or run these underneath the board.
          </p>
        </div>
      )}

      <ul className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm">
        {entries.map((entry) => (
          <li
            key={entry.kind}
            data-legend-kind={entry.kind}
            title={entry.hint}
            className="flex items-center gap-1.5 whitespace-nowrap"
          >
            <Swatch kind={entry.kind} />
            <span className="text-neutral-300">{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
