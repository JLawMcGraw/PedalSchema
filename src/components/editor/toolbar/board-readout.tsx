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
 * It belongs in the toolbar because every one of these numbers otherwise
 * lives behind a TAB - pedals in Chain, length in Cables, draw in Power - and
 * only one tab is open at a time. Measured before building: the strip between
 * the board title and the control cluster was 899px of nothing, 56% of the
 * bar, on a 1600px viewport.
 *
 * Every value is derived, never stored. FIT counts the same `valid` flag the
 * canvas legend counts, so the two cannot report different numbers - the
 * cheap-second-opinion mistake this repo calls P1.5.
 */
export function BoardReadout() {
  const placedPedals = useConfigurationStore((s) => s.placedPedals);
  const { cables, routedCables, collisions, power } = useDerivedConfiguration((d) => ({
    cables: d.cables,
    routedCables: d.routedCables,
    collisions: d.collisions,
    power: d.power,
  }));

  // An empty board has no vital signs. "FIT OK" on a board with nothing on it
  // is not reassurance, it is a reading taken from an unplugged instrument.
  if (placedPedals.length === 0) return null;

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
      className="mx-auto hidden min-w-0 items-center gap-5 lg:flex"
      role="status"
      aria-label="Board summary"
    >
      <Field label="Pedals" value={String(placedPedals.length)} />
      {/* CABLE and DRAW are the two that go when the bar gets tight.
          Measured at 1100px wide: the control cluster starts at x=443.8 and
          the title ends at 44.7, so the full four-field register (390px)
          leaves 9px of slack - close enough that one longer FIT string
          ("12 UNROUTED") would collide. PEDALS and FIT survive because a
          count and a verdict are what you check without looking. */}
      <Field label="Cable" value={totalInches.toFixed(1)} unit="in" className="hidden xl:flex" />
      {/* An unrecorded draw is not a draw of zero - see engine/power. The
          floor is shown as a floor, the same "≥" the Power panel uses. */}
      <Field
        label="Draw"
        value={`${power.unknown.length > 0 ? '≥' : ''}${power.knownTotalMa}`}
        unit="mA"
        className="hidden xl:flex"
      />
      <Field label="Fit" value={fit.text} tone={fit.bad ? 'bad' : 'good'} />
    </div>
  );
}

function Field({
  label,
  value,
  unit,
  tone = 'neutral',
  className = 'flex',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'good' | 'bad';
  className?: string;
}) {
  return (
    <div className={`items-baseline gap-1.5 ${className}`}>
      {/* §3.2: the LABEL goes to the micro register so the DATA can lead.
          Scale is the contrast, not weight. */}
      <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={`font-mono text-xs tabular-nums ${
          tone === 'bad'
            ? 'text-destructive'
            : tone === 'good'
              ? 'text-primary'
              : 'text-foreground'
        }`}
      >
        {value}
        {unit && <span className="text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}
