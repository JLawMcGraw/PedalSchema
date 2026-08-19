/**
 * Share slugs, and the URL a board is shared at.
 *
 * Pure so the alphabet and the length are asserted rather than eyeballed - a
 * slug that can contain a character needing percent-encoding produces a link
 * that works everywhere until someone pastes it into the one client that
 * escapes it differently.
 */

/**
 * Unambiguous lowercase base32: no 0/o, no 1/l/i.
 *
 * These land in URLs people read aloud, retype off a phone screen and paste
 * into chat clients that helpfully autocorrect. Dropping the four confusable
 * pairs costs a little entropy per character and removes the whole class of
 * "the link you sent doesn't work".
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 12 characters of this alphabet is about 59 bits. */
export const SHARE_SLUG_LENGTH = 12;

/**
 * A new share slug.
 *
 * Uses crypto.getRandomValues, NOT Math.random. The slug is not the access
 * control - RLS grants SELECT on any row with is_public = true, so a public
 * board is public - but it is the only thing standing between a board and
 * being found by guessing, and a predictable sequence would give that away
 * too.
 *
 * The modulo bias here is negligible and deliberate: 256 % 31 leaves the
 * first eight symbols very slightly favoured, which does not matter for a
 * link, and rejection sampling would add a loop for nothing.
 */
export function generateShareSlug(length: number = SHARE_SLUG_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** True when `slug` is one this app would have produced. */
export function isValidShareSlug(slug: string): boolean {
  if (slug.length < 6 || slug.length > 64) return false;
  for (const ch of slug) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * The full URL a board is shared at.
 *
 * `origin` is passed in rather than read from `window` so this can be called
 * on the server and asserted in a test.
 */
export function shareUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${slug}`;
}
