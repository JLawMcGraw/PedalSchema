import { cn } from '@/lib/utils';

/**
 * A placeholder in the shape of the thing that is loading.
 *
 * Deliberately not a spinner. A spinner says "something is happening
 * somewhere"; a skeleton says "a grid of cards is coming, and here is where
 * they will be", so the layout does not jump when the data lands.
 *
 * `data-slot` is what `verify-states.js` looks for. The pulse is a transition
 * of opacity, so `prefers-reduced-motion` already stops it.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
