import { ListPageSkeleton } from '@/components/skeletons/list-page-skeleton';

/**
 * Matches the pedals grid, filters included.
 *
 * It lives in a (list) route group, and that is load-bearing rather than
 * tidiness. A loading.tsx at `pedals/` wraps EVERY child segment, `[id]`
 * included - and a streaming segment has already flushed HTTP 200 by the time
 * the page calls notFound(), so every unknown or malformed pedal id started
 * answering 200 with a soft 404. `verify-routes` caught all three cases.
 *
 * The group keeps the boundary around the list only. The URL is unchanged:
 * route groups do not appear in the path.
 */
export default function Loading() {
  return (
    <ListPageSkeleton
      gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      cards={8}
      withFilters
      label="Loading pedals"
    />
  );
}
