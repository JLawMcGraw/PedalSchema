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

/**
 * A collapsed drawer at the foot of the right panel.
 *
 * WHAT THIS REPLACES. The right panel was a five-tab strip, and five tabs
 * needed 316px in a panel that is 300px - so the last one, Props, sat off the
 * end at every viewport width. That was patched twice (a scroll nobody could
 * see, then a wrap that needed two of TabsTrigger's own defaults overridden)
 * and the real fault was upstream of the strip: four of the five tabs are
 * REFERENCE, opened to answer one question and closed again, while the fifth -
 * the chain - is what the panel is for and was being hidden by the other four.
 *
 * So the chain is always mounted and the other four become drawers. Each shows
 * one measured fact while shut, which is the whole reason a tab strip was
 * costing something: `CABLES 16 · 142.0IN` answers the question most visits to
 * that tab were asking, without opening it.
 *
 * `data-panel-tab` MOVES HERE, keeping the same four values. Six gates select
 * on those handles and the strip they used to sit on no longer exists. Keyed
 * on the VALUE rather than the label for the original reason: `Props` renders
 * as "PROPS" only because of a CSS uppercase transform, so a text selector
 * passes today and breaks the day someone types the label in capitals, with
 * the screen looking identical either way.
 */
export function Drawer({
  id,
  label,
  fact,
  factMuted = false,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  fact: React.ReactNode;
  factMuted?: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex shrink-0 flex-col border-t ${open ? 'min-h-0 flex-1' : ''}`}>
      <button
        type="button"
        data-panel-tab={id}
        /* `data-state` alongside aria-expanded because six gates were written
           against the Radix tab's state attribute and it is a real contract,
           not a Radix artifact - shadcn stamps it on every stateful control in
           this repo. Keeping it means the drawer swap is a change of shape and
           not a rewrite of every script that opens a panel. */
        data-state={open ? 'active' : 'inactive'}
        aria-expanded={open}
        onClick={onToggle}
        className="flex shrink-0 items-baseline gap-2 px-3 py-[9px] text-left transition-colors duration-200 hover:bg-muted/60"
      >
        {/* A glyph, not an icon: at 10px in a mono row a chevron is four grey
            pixels, and +/- is the same two states in the register the rest of
            the row is already set in. */}
        <span aria-hidden className="w-2 shrink-0 font-mono text-[10px] text-muted-foreground">
          {open ? '−' : '+'}
        </span>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
        <span
          className={`ml-auto truncate font-mono text-[11px] uppercase tabular-nums text-muted-foreground ${
            factMuted ? 'opacity-60' : ''
          }`}
        >
          {fact}
        </span>
      </button>
      {/* Mounted only while open. These four panels each subscribe to derived
          board state, and keeping four of them mounted to render nothing is
          four subscriptions recomputing on every board edit. */}
      {open && (
        /* `data-panel-body` replaces the `[role="tabpanel"]` three gates read
           the open panel's text out of. A role would be a lie here - there is
           no tablist for it to belong to - so the handle is a data attribute,
           which is what the rest of this codebase uses for exactly this. */
        <div data-panel-body={id} className="min-h-0 flex-1 overflow-y-auto border-t">
          {children}
        </div>
      )}
    </div>
  );
}
