/**
 * The sort vocabulary, in a module with NO 'use client'.
 *
 * `isSortKey` is called by the dashboard's server component to validate the
 * query string, and `SORTS` is read by the client control that sets it. A
 * value exported from a 'use client' module is a client reference on the
 * server - calling it throws "Attempted to call isSortKey() from the server",
 * which the production build does not catch because the boundary is only
 * resolved at render.
 *
 * So the shared vocabulary lives here and both sides import it.
 */
export const SORTS = {
  edited: 'Last edited',
  name: 'Name',
  pedals: 'Pedal count',
} as const;

export type SortKey = keyof typeof SORTS;

/** The default. Written as the ABSENCE of the query param, never as a value. */
export const DEFAULT_SORT: SortKey = 'edited';

export function isSortKey(value: string | undefined): value is SortKey {
  return value === 'edited' || value === 'name' || value === 'pedals';
}
