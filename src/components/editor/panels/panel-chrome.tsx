/**
 * Shared chrome for the editor panels.
 *
 * A panel title is a LABEL, not content. It used to be `text-sm font-semibold`
 * - the same size and weight as the data underneath it - so every panel opened
 * by shouting its own name at the reader before showing them anything.
 *
 * `.agents/skills/industrial-brutalist-ui` §3.2 puts metadata, navigation and
 * unit IDs in monospace, uppercase and generously tracked at a fixed small
 * size, reserving scale for the data itself. That is the contrast this app was
 * missing: measured across src, 184 of 218 sized elements were text-xs or
 * text-sm, so nothing led.
 */
export const PANEL_TITLE =
  'font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground';

/**
 * A panel's own header: its name on the left, one measured fact on the right.
 *
 * Three panels had written this out independently - Power counting pedals,
 * Cables counting connections, Routing showing nothing at all - and the three
 * copies had already drifted in their padding. The right-hand slot is the
 * point: a panel header that only names the panel is spending a whole row on
 * something the tab above it already said.
 */
export function PanelHeader({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
      <h3 className={PANEL_TITLE}>{title}</h3>
      {meta !== undefined && meta !== null && (
        <span
          data-panel-meta
          className="font-mono text-[10px] uppercase tabular-nums tracking-widest text-muted-foreground"
        >
          {meta}
        </span>
      )}
    </div>
  );
}

/**
 * One hairline section.
 *
 * Extracted from the Power panel, which is where the pattern was proven: that
 * panel was SEVEN bordered cards, each with its own filled header bar, and
 * card chrome is for elevation that communicates hierarchy - seven stacked
 * cards communicate none, they just draw fourteen more lines than the content
 * needs. Routing was the third panel about to grow its own copy of this.
 *
 * `flush` drops the body padding for sections whose rows are a divided list:
 * a divider that stops 12px short of the panel edge reads as a hairline
 * someone forgot to finish.
 */
export function Section({
  label,
  count,
  meta,
  flush = false,
  children,
}: {
  label: string;
  count?: number;
  meta?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b" data-panel-section={label}>
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-2">
        <h4 className={PANEL_TITLE} data-section-label>
          {label}
        </h4>
        {count !== undefined && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
        )}
        {meta !== undefined && meta !== null && (
          <span className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      <div className={flush ? 'pb-1' : 'px-3 pb-2'}>{children}</div>
    </section>
  );
}
