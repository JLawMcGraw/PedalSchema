/**
 * The wordmark's glyph: two rails with two pedals between them.
 *
 * The same geometry the board thumbnails draw, at 16x16 - a mark that is a
 * small picture of the thing the app makes, rather than a letterform. It reads
 * at 16px because there are only four shapes in it and they are all rectangles
 * on the same two axes.
 *
 * NOT FINAL. Three other lockups were drawn (signal-dot mixed wordmark, boxed
 * `PS` monogram, stacked two-line); this bundle ships the rails mark and the
 * choice is still open.
 */
export function RailsMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      {/* Rails: full-width, top and bottom. */}
      <rect x="1" y="2.5" width="14" height="1.5" fill="currentColor" opacity="0.55" />
      <rect x="1" y="12" width="14" height="1.5" fill="currentColor" opacity="0.55" />
      {/* Two pedals in the channel between them, in the accent so the mark has
          the same figure/ground the board does. */}
      <rect x="2.5" y="5.5" width="5" height="5" className="fill-primary" />
      <rect x="8.5" y="5.5" width="5" height="5" fill="currentColor" opacity="0.75" />
    </svg>
  );
}
