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
