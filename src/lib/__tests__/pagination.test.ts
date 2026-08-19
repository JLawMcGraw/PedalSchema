/**
 * Every interesting case here is a bad `?page=` value, and all of them arrive
 * from the URL bar where anyone can type one.
 */
import { describe, it, expect } from 'vitest';
import { resolvePage, DASHBOARD_PAGE_SIZE } from '../pagination';

describe('resolvePage', () => {
  it('defaults to page 1 when there is no page param', () => {
    const w = resolvePage(undefined, 30, 10);
    expect(w.page).toBe(1);
    expect([w.from, w.to]).toEqual([0, 9]);
    expect(w.hasPrev).toBe(false);
    expect(w.hasNext).toBe(true);
  });

  it('gives Supabase inclusive range bounds', () => {
    // .range(from, to) is inclusive at BOTH ends - an off-by-one here shows up
    // as a duplicated or dropped row at every page boundary.
    const w = resolvePage('2', 30, 10);
    expect([w.from, w.to]).toEqual([10, 19]);
  });

  it('clamps a page past the end rather than showing nothing', () => {
    const w = resolvePage('99', 30, 10);
    expect(w.page).toBe(3);
    expect(w.hasNext).toBe(false);
    expect([w.firstShown, w.lastShown]).toEqual([21, 30]);
  });

  it.each(['0', '-3', 'abc', '', '2.5', ' 2', '0x2', '1e2'])(
    'treats %o as page 1',
    (raw) => {
      expect(resolvePage(raw, 30, 10).page).toBe(1);
    }
  );

  it('survives an empty list: one page, nothing shown, no navigation', () => {
    const w = resolvePage(undefined, 0, 10);
    expect(w.pageCount).toBe(1);
    expect(w.page).toBe(1);
    expect([w.firstShown, w.lastShown]).toEqual([0, 0]);
    expect(w.hasPrev).toBe(false);
    expect(w.hasNext).toBe(false);
  });

  it('does not invent an empty last page on an exact multiple', () => {
    // 30 items at 10 a page is 3 pages, not 4.
    const w = resolvePage('3', 30, 10);
    expect(w.pageCount).toBe(3);
    expect(w.hasNext).toBe(false);
    expect(w.lastShown).toBe(30);
  });

  it('reports the true last item on a short final page', () => {
    const w = resolvePage('3', 21, 10);
    expect([w.firstShown, w.lastShown]).toEqual([21, 21]);
  });

  it('defaults the page size to the dashboard size', () => {
    const w = resolvePage('1', 100);
    expect(w.to - w.from + 1).toBe(DASHBOARD_PAGE_SIZE);
  });
});
