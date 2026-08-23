import { describe, it, expect } from 'vitest';
import { relativeTimeShort, relativeTimeLong } from '../relative-time';

/** A fixed instant, so nothing here depends on when it runs. */
const NOW = new Date('2026-08-22T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('relativeTimeShort', () => {
  it('reads the three cases the design names', () => {
    expect(relativeTimeShort(ago(2 * HOUR), NOW)).toBe('2h ago');
    expect(relativeTimeShort(ago(8 * DAY), NOW)).toBe('8d ago');
    expect(relativeTimeShort(ago(3 * WEEK), NOW)).toBe('3w ago');
  });

  it('floors rather than rounds, so it never claims more staleness than there is', () => {
    // 119 minutes is not yet two hours, and a board that says "2h ago" when it
    // is 1h59 is overstating - the whole field is a staleness judgement.
    expect(relativeTimeShort(ago(119 * MINUTE), NOW)).toBe('1h ago');
    expect(relativeTimeShort(ago(120 * MINUTE), NOW)).toBe('2h ago');
  });

  it('collapses anything under a minute, including clock skew into the future', () => {
    expect(relativeTimeShort(ago(30 * SECOND), NOW)).toBe('just now');
    expect(relativeTimeShort(ago(0), NOW)).toBe('just now');
    // The database clock running ahead of the browser is routine and must not
    // produce "in 3 seconds" on a board that was just saved.
    expect(relativeTimeShort(ago(-3 * SECOND), NOW)).toBe('just now');
  });

  it('crosses each boundary in the right direction', () => {
    expect(relativeTimeShort(ago(59 * MINUTE), NOW)).toBe('59m ago');
    expect(relativeTimeShort(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTimeShort(ago(23 * HOUR), NOW)).toBe('23h ago');
    expect(relativeTimeShort(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTimeShort(ago(6 * DAY), NOW)).toBe('6d ago');
    // Days survive a week - see DAY_LIMIT. The design's own `8d ago` example
    // does not exist at a 7-day boundary.
    expect(relativeTimeShort(ago(WEEK), NOW)).toBe('7d ago');
    expect(relativeTimeShort(ago(13 * DAY), NOW)).toBe('13d ago');
    expect(relativeTimeShort(ago(14 * DAY), NOW)).toBe('2w ago');
  });

  it('uses a calendar-average month, so weeks never overtake months', () => {
    expect(relativeTimeShort(ago(29 * DAY), NOW)).toBe('4w ago');
    expect(relativeTimeShort(ago(45 * DAY), NOW)).toBe('1mo ago');
    expect(relativeTimeShort(ago(400 * DAY), NOW)).toBe('1y ago');
  });
});

describe('relativeTimeLong', () => {
  it('spells the unit out for the hero', () => {
    expect(relativeTimeLong(ago(2 * HOUR), NOW)).toBe('Edited 2 hours ago');
    expect(relativeTimeLong(ago(3 * WEEK), NOW)).toBe('Edited 3 weeks ago');
  });

  it('singularises one', () => {
    expect(relativeTimeLong(ago(HOUR), NOW)).toBe('Edited 1 hour ago');
    expect(relativeTimeLong(ago(DAY), NOW)).toBe('Edited 1 day ago');
  });

  it('has its own wording for the sub-minute case', () => {
    expect(relativeTimeLong(ago(10 * SECOND), NOW)).toBe('Edited just now');
  });
});
