import { ListPageSkeleton } from '@/components/skeletons/list-page-skeleton';

/** Matches the amps grid. */
export default function Loading() {
  return (
    <ListPageSkeleton
      gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      cards={6}
      label="Loading amps"
    />
  );
}
