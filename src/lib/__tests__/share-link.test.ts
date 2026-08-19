/**
 * A share slug ends up in a URL that people retype and paste. These guard the
 * alphabet, because the failure is "the link you sent doesn't work" and it
 * surfaces in someone else's chat client.
 */
import { describe, it, expect } from 'vitest';
import {
  generateShareSlug,
  isValidShareSlug,
  shareUrl,
  SHARE_SLUG_LENGTH,
} from '../share-link';

describe('generateShareSlug', () => {
  it('is the requested length, and 12 by default', () => {
    expect(generateShareSlug()).toHaveLength(SHARE_SLUG_LENGTH);
    expect(generateShareSlug(20)).toHaveLength(20);
  });

  it('contains nothing that needs URL-encoding', () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateShareSlug();
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it('omits the confusable characters entirely', () => {
    // 0/o, 1/l/i - the pairs that break a link read aloud or retyped.
    const all = Array.from({ length: 400 }, () => generateShareSlug()).join('');
    for (const ch of ['0', 'o', '1', 'l', 'i']) {
      expect(all).not.toContain(ch);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateShareSlug()));
    expect(seen.size).toBe(500);
  });
});

describe('isValidShareSlug', () => {
  it('accepts what generateShareSlug produces', () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidShareSlug(generateShareSlug())).toBe(true);
    }
  });

  it('rejects the confusable characters and anything outside the alphabet', () => {
    expect(isValidShareSlug('abcdefgh0jkm')).toBe(false); // zero
    expect(isValidShareSlug('abcdefghijkm')).toBe(false); // i
    expect(isValidShareSlug('ABCDEFGHJKMN')).toBe(false); // uppercase
    expect(isValidShareSlug('abc-defg-hjk')).toBe(false); // hyphen
    expect(isValidShareSlug('abcdefgh jkm')).toBe(false); // space
  });

  it('rejects lengths that could not be a real slug', () => {
    expect(isValidShareSlug('')).toBe(false);
    expect(isValidShareSlug('abc')).toBe(false);
    expect(isValidShareSlug('a'.repeat(65))).toBe(false);
  });
});

describe('shareUrl', () => {
  it('builds the link', () => {
    expect(shareUrl('https://pedalschema.app', 'abcdefghjkmn')).toBe(
      'https://pedalschema.app/s/abcdefghjkmn'
    );
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(shareUrl('http://localhost:3000/', 'abcd23')).toBe(
      'http://localhost:3000/s/abcd23'
    );
  });
});
