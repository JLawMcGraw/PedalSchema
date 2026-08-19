import { ListPageSkeleton } from '@/components/skeletons/list-page-skeleton';

/** Matches the board grid on the dashboard. */
export default function Loading() {
  return (
    <ListPageSkeleton
      gridClassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      cards={6}
      label="Loading your pedalboards"
    />
  );
}
