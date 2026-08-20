import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The pedal detail placeholder: a back link, a title block with its badge, the
 * photo, and two spec columns.
 *
 * This can only exist because `layout.tsx` beside it decides the 404 before
 * this boundary flushes - see the note there.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading pedal">
      <Skeleton className="h-5 w-32" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="aspect-4/3 w-full" />
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <span className="sr-only">Loading pedal</span>
    </div>
  );
}
