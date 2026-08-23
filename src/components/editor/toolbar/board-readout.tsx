'use client';

import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';

/**
 * The board's vital signs, always visible.
 *
 * `design-direction.md` opens with this sketch and it had never been built:
 *
 *     ┌ BOARD ─────────────────── ● LIVE ┐
 *     │ PEDALS      9    CABLE   142.0in │
 *     │ DRAW    1240mA   FIT      OK     │
 *     └──────────────────────────────────┘
 *
 * It belongs in the header block because every one of these numbers otherwise
 * lives behind a TAB - pedals in Chain, length in Cables, draw in Power - and
 * only one tab is open at a time. Measured before building: the strip between
 * the board title and the control cluster was 899px of nothing, 56% of the
 * bar, on a 1600px viewport.
 *
 * This component is the FIELD REGISTER only. The frame around it, and the two
 * labels straddling its top rule, are drawn by `editor-toolbar.tsx` - the
 * frame carries the board's identity (its editable name) and its live state,
 * which are not readings.
 *
 * Every value is derived, never stored. FIT counts the same `valid` flag the
 * canvas legend counts, and CROSSINGS the same `detectCableCrossings` the
 * router's own lane-vs-cascade guard counts, so no two surfaces can report
 * different numbers - the cheap-second-opinion mistake this repo calls P1.5.
 */
export function BoardReadout() {
  const placedPedals = useConfigurationStore((s) => s.placedPedals);
  const { cables, routedCables, crossings, collisions, power } = useDerivedConfiguration((d) => ({
    cables: d.cables,
    routedCables: d.routedCables,
    crossings: d.crossings,
    collisions: d.collisions,
    power: d.power,
  }));

  /*
   * An empty board has no vital signs. "FIT OK" on a board with nothing on it
   * is not reassurance, it is a reading taken from an unplugged instrument.
   *
   * This used to `return null`, which was right while the readout was a loose
   * strip in a flex bar. It is wrong now that the readout sits inside a drawn
   * frame: returning nothing leaves an empty box with two labels on it, and
   * the whole band changes height the moment the first pedal lands.
   *
   * So the fields stay mounted and read `—`. A dash is not a claim - it is the
   * absence of one, which is exactly what the original decision was protecting.
   * PEDALS still reads 0, because a count of nothing is a real count.
   */
  const empty = placedPedals.length === 0;

  const totalInches = cables.reduce((sum, c) => sum + (c.calculatedLengthInches || 0), 0);
  const unrouted = routedCables.filter((r) => !r.valid).length;

  /*
   * Collisions outrank unrouted cables: a board whose pedals overlap cannot be
   * built at all, while a cable that will not route is a board you can build
   * and then re-plan. Reporting the milder fault while the worse one is live
   * would be the readout lying by omission.
   *
   * OFF-BOARD IS NAMED SEPARATELY. This field said "N OVERLAP" for every
   * collision, which was true while `detectCollisions` only ever found
   * overlaps. It now also reports a pedal hanging off the edge, and the two
   * faults have different fixes - "move these apart" versus "this one is not
   * on the board" - so one label for both would send the reader looking for a
   * neighbour that does not exist.
   */
  const offBoard = collisions.filter((c) => c.severity === 'off-board').length;
  const overlaps = collisions.length - offBoard;
  const fit =
    offBoard > 0
      ? { text: `${offBoard} OFF BOARD`, bad: true }
      : overlaps > 0
        ? { text: `${overlaps} OVERLAP`, bad: true }
        : unrouted > 0
          ? { text: `${unrouted} UNROUTED`, bad: true }
          : { text: 'OK', bad: false };

  return (
    <div
      data-board-readout=""
      className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-5"
      role="status"
      aria-label="Board summary"
    >
      <Field label="Pedals" value={String(placedPedals.length)} />
      {/*
        CABLE, DRAW and CROSSINGS are the three that go when the band gets
        tight, on the same rule the four-field strip used: measured at 1100px
        wide, the control cluster started at x=443.8 and the title ended at
        44.7, so the full register left 9px of slack - close enough that one
        longer FIT string ("12 UNROUTED") would collide. A fifth field only
        makes that worse, so below `xl` this is a two-column grid.

        PEDALS and FIT survive because a count and a verdict are what you check
        without looking.
      */}
      <Field
        label="Cable"
        value={empty ? '—' : totalInches.toFixed(1)}
        unit={empty ? undefined : 'in'}
        className="hidden xl:block"
      />
      {/* An unrecorded draw is not a draw of zero - see engine/power. The
          floor is shown as a floor, the same "≥" the Power panel uses. */}
      <Field
        label="Draw"
        value={empty ? '—' : `${power.unknown.length > 0 ? '≥' : ''}${power.knownTotalMa}`}
        unit={empty ? undefined : 'mA'}
        className="hidden xl:block"
      />
      <Field
        label="Crossings"
        value={empty ? '—' : String(crossings)}
        className="hidden xl:block"
      />
      <Field
        label="Fit"
        value={empty ? '—' : fit.text}
        tone={empty ? 'neutral' : fit.bad ? 'bad' : 'good'}
      />
    </div>
  );
}

function Field({
  label,
  value,
  unit,
  tone = 'neutral',
  className = 'block',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'good' | 'bad';
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {/* §3.2: the LABEL goes to the micro register so the DATA can lead.
          Scale is the contrast, not weight - which is why the label is 10px
          against a 24px value and nothing sits between them. */}
      <div className="font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1.5 truncate font-mono text-2xl leading-none ${
          tone === 'bad'
            ? 'text-destructive'
            : tone === 'good'
              ? 'text-primary'
              : 'text-foreground'
        }`}
      >
        {value}
        {unit && <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
