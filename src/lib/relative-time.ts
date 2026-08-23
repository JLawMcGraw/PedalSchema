/**
 * How stale is this, in words.
 *
 * The dashboard showed `8/22/2026`. At one to three boards an absolute date is
 * a fact nobody needs - you do not remember which day you last opened a board,
 * you remember that it was recent or that it was not. How stale it is, is the
 * fact.
 *
 * Two registers, because the two places have different room:
 *   short  `2h ago`, right-aligned against a compact row's name
 *   long   `Edited 2 hours ago`, spelled out in the hero's header
 *
 * `now` is a parameter rather than a call to Date.now() inside, so this is a
 * pure function and can be tested at a fixed instant. It also matters in
 * Next.js: this runs on the SERVER during render, so the string is baked at
 * request time - the alternative, a client component ticking every minute,
 * costs hydration on every card to move a number nobody is watching.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/*
 * Days run to a FORTNIGHT, not to a week, before weeks take over.
 *
 * The design names its three examples as `2h ago` / `8d ago` / `3w ago`, and
 * `8d` only exists if the day grain survives past seven - at a 7-day boundary
 * that same board reads "1w ago". Which is the more useful reading is the
 * point: inside a fortnight the exact number of days is a thing people still
 * hold ("I was on it last Tuesday"), and past that it stops being, which is
 * where weeks start earning their coarseness.
 */
const DAY_LIMIT = 14 * DAY;
/* Calendar-average, not 30 days: at 30 the gap between "4w" and "1mo" reads
   backwards for a couple of days every month. */
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

interface Grain {
  /** Whole units elapsed. */
  value: number;
  short: string;
  long: string;
}

function grain(elapsed: number): Grain | null {
  if (elapsed < MINUTE) return null; // "just now"
  if (elapsed < HOUR) return { value: Math.floor(elapsed / MINUTE), short: 'm', long: 'minute' };
  if (elapsed < DAY) return { value: Math.floor(elapsed / HOUR), short: 'h', long: 'hour' };
  if (elapsed < DAY_LIMIT) return { value: Math.floor(elapsed / DAY), short: 'd', long: 'day' };
  if (elapsed < MONTH) return { value: Math.floor(elapsed / WEEK), short: 'w', long: 'week' };
  if (elapsed < YEAR) return { value: Math.floor(elapsed / MONTH), short: 'mo', long: 'month' };
  return { value: Math.floor(elapsed / YEAR), short: 'y', long: 'year' };
}

/** `2h ago`, `8d ago`, `3w ago`. */
export function relativeTimeShort(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  /*
   * A timestamp in the future is not an error worth throwing over - clock skew
   * between the browser and the database produces a few seconds of it
   * routinely - but "in 3 seconds" on a board you just saved is nonsense. It
   * clamps to "just now", which is what it means.
   */
  const g = grain(elapsed);
  if (!g) return 'just now';
  return `${g.value}${g.short} ago`;
}

/** `Edited 2 hours ago`. The register around it is uppercase, not the string. */
export function relativeTimeLong(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  const g = grain(elapsed);
  if (!g) return 'Edited just now';
  return `Edited ${g.value} ${g.long}${g.value === 1 ? '' : 's'} ago`;
}
