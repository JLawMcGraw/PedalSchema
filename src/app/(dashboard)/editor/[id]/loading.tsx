import { Skeleton } from '@/components/ui/skeleton';

/**
 * The editor placeholder: the toolbar, the library rail, the canvas, and the
 * panel column - in the same proportions as the real thing, so the shell does
 * not reflow when the board arrives.
 *
 * The canvas placeholder is a single large block rather than a fake pedalboard.
 * A skeleton stands in for a shape, not for content, and drawing a plausible
 * board here would suggest a layout that may be nothing like the one loading.
 *
 * Possible only because `layout.tsx` beside it decides the 404 first - see the
 * note there.
 */
export default function Loading() {
  return (
    <div
      className="flex flex-col h-[calc(100dvh-3.5rem)]"
      role="status"
      aria-busy="true"
      aria-label="Loading board"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b px-4 h-14 shrink-0">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0 max-w-[2200px] mx-auto w-full">
        {/* Library rail */}
        <div className="hidden lg:block w-56 xl:w-64 border-r shrink-0 p-3 space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0 p-4">
          <Skeleton className="h-full w-full" />
        </div>

        {/* Panel column */}
        <div className="hidden lg:block w-72 xl:w-80 border-l shrink-0">
          <div className="flex gap-2 border-b p-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-12" />
            ))}
          </div>
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>

      <span className="sr-only">Loading board</span>
    </div>
  );
}
