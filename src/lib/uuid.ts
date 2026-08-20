/**
 * Is this string shaped like a UUID?
 *
 * Worth its own module because it guards a status code. Postgres rejects a
 * non-UUID against a uuid column with 22P02, and without a guard that surfaces
 * as a 500 on a URL anyone can type - so every route that takes an id in the
 * path checks the shape before it asks the database.
 *
 * It lived inline in `pedals/[id]/page.tsx` until the detail layouts needed the
 * same answer to decide a 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
