/**
 * Working out which slice of a list a page number refers to.
 *
 * Pure because every interesting case is a bad input - "0", "-3", "abc", a
 * page past the end - and each of those arrives from the URL bar, where
 * anyone can type it. A page component cannot assert what it does with them.
 */

/** Twelve fills the dashboard's 3-column grid exactly four rows deep. */
export const DASHBOARD_PAGE_SIZE = 12;

export interface PageWindow {
  /** 1-based, clamped into range. */
  page: number;
  /** At least 1, even when there is nothing to show. */
  pageCount: number;
  /** 0-based inclusive bounds, the shape Supabase's .range() wants. */
  from: number;
  to: number;
  /** 1-based positions for "showing X to Y of Z"; both 0 when the list is empty. */
  firstShown: number;
  lastShown: number;
  hasPrev: boolean;
  hasNext: boolean;
  totalItems: number;
}

/**
 * Resolve a raw `?page=` value against a known total.
 *
 * Anything that is not a positive whole number is page 1 - an unreadable page
 * number is a typo, and answering it with an error page would be worse than
 * answering it with the first page.
 */
export function resolvePage(
  rawPage: string | undefined,
  totalItems: number,
  pageSize: number = DASHBOARD_PAGE_SIZE
): PageWindow {
  const total = Math.max(0, Math.floor(totalItems));
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(total / size));

  // Number() would accept "2.5", " 3 " and "0x2"; the digits test does not.
  const parsed = rawPage !== undefined && /^\d+$/.test(rawPage) ? parseInt(rawPage, 10) : 1;
  const page = Math.min(Math.max(parsed || 1, 1), pageCount);

  const from = (page - 1) * size;
  const to = from + size - 1;

  return {
    page,
    pageCount,
    from,
    to,
    firstShown: total === 0 ? 0 : from + 1,
    lastShown: Math.min(to + 1, total),
    hasPrev: page > 1,
    hasNext: page < pageCount,
    totalItems: total,
  };
}
