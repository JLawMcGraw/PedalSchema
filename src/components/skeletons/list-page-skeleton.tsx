import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * The placeholder for the four list pages: dashboard, pedals, boards, amps.
 *
 * They share a shape - a title block, an action, sometimes a filter row, then
 * a grid of cards - so they share a placeholder, and each route passes its own
 * grid classes so the columns line up with the real thing. That is the whole
 * point of a skeleton over a spinner: when the data lands, nothing jumps.
 *
 * `role="status"` with `aria-busy` is not decoration. A screen reader gets
 * nothing at all from a grid of empty grey boxes, and "the page went quiet for
 * two seconds" is exactly the case this is here to cover.
 */
export function ListPageSkeleton({
  gridClassName,
  cards = 6,
  withFilters = false,
  label = 'Loading',
}: {
  gridClassName: string;
  cards?: number;
  withFilters?: boolean;
  label?: string;
}) {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label={label}>
      {/* Title block and the action beside it. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36 shrink-0" />
      </div>

      {withFilters && (
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-full max-w-sm" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
      )}

      <div className={gridClassName}>
        {Array.from({ length: cards }, (_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        ))}
      </div>

      <span className="sr-only">{label}</span>
    </div>
  );
}
