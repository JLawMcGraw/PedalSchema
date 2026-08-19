/**
 * The one that matters is formatCurrentDraw: null and 0 are both falsy, so the
 * obvious ternary reports a measured zero as unknown.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCurrentDraw,
  formatVoltage,
  formatDimensions,
  formatPolarity,
  formatJackType,
  formatJackSide,
  formatChainLocation,
} from '../format-pedal';

describe('formatCurrentDraw', () => {
  it('reports a measured draw', () => {
    expect(formatCurrentDraw(120)).toBe('120 mA');
  });

  it('distinguishes a measured ZERO from unknown', () => {
    // The whole point of the module. A passive volume pedal really does draw
    // nothing, and that is a fact about it - not an absence of one.
    expect(formatCurrentDraw(0)).toBe('0 mA');
    expect(formatCurrentDraw(null)).toBe('Unknown');
    expect(formatCurrentDraw(0)).not.toBe(formatCurrentDraw(null));
  });

  it('is not the falsy ternary', () => {
    // Written as an executable statement of the bug being avoided: this is
    // what `ma ? ... : 'Unknown'` would produce.
    const naive = (ma: number | null) => (ma ? `${ma} mA` : 'Unknown');
    expect(naive(0)).toBe('Unknown');
    expect(formatCurrentDraw(0)).toBe('0 mA');
  });
});

describe('formatVoltage', () => {
  it('keeps whole numbers whole', () => {
    expect(formatVoltage(9)).toBe('9V');
    expect(formatVoltage(18)).toBe('18V');
  });

  it('keeps a real decimal', () => {
    expect(formatVoltage(9.6)).toBe('9.6V');
  });
});

describe('formatDimensions', () => {
  it('renders W x D x H with a multiplication sign, not the letter x', () => {
    const out = formatDimensions(2.6, 4.7, 2.1);
    expect(out).toBe('2.6″ × 4.7″ × 2.1″');
    expect(out).not.toContain('x');
  });

  it('drops a trailing .0 but keeps real decimals', () => {
    expect(formatDimensions(3, 5, 2)).toBe('3″ × 5″ × 2″');
    expect(formatDimensions(2.5, 4.75, 2)).toBe('2.5″ × 4.75″ × 2″');
  });
});

describe('label maps', () => {
  it('labels every value of the unions it covers', () => {
    expect(formatPolarity('center_negative')).toBe('Centre negative');
    expect(formatPolarity('center_positive')).toBe('Centre positive');
    expect(formatJackType('midi_in')).toBe('MIDI in');
    expect(formatJackType('input')).toBe('Input');
    expect(formatJackSide('top')).toBe('Top');
    expect(formatChainLocation('four_cable_hub')).toBe('Four-cable hub');
    expect(formatChainLocation('front_of_amp')).toBe('Front of amp');
  });

  it('falls back to the raw value rather than rendering undefined', () => {
    // A new enum member added in a migration must not paint "undefined" into
    // the page before the label map catches up.
    expect(formatJackType('quad_out' as never)).toBe('quad_out');
    expect(formatChainLocation('parallel_send' as never)).toBe('parallel_send');
  });
});
