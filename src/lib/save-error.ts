/**
 * Turning a failed Supabase write into something a person can act on.
 *
 * This exists because a real save failure reached a user as, in full:
 *
 *     Failed to save: {}
 *
 * which is worse than useless - it says work was lost and nothing about why.
 * The handler was doing `console.error('Failed to save:', error)`, and neither
 * shape that arrives there survives being logged as an object:
 *
 *   - a PostgrestError is a plain object whose useful content is spread across
 *     message / details / hint / code;
 *   - anything thrown by fetch or the auth client is an Error, and `message` on
 *     an Error is a NON-ENUMERABLE property, so it serialises to exactly `{}`.
 *
 * So read the fields explicitly rather than trusting a serialiser to find them.
 */

const NETWORK_ADVICE = 'check your connection and try again';

/** A legible one-line description of a failed Supabase call. */
export function describeSaveError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;

  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string; details?: string; hint?: string; code?: string };

    // supabase-js puts a whole STACK TRACE in `details` when the fetch itself
    // fails, and it repeats `message`. A stack belongs in the console, not in a
    // toolbar tooltip - keep only single-line fields that add something new.
    const oneLine = (s?: string) => (s && !s.includes('\n') ? s.trim() : '');
    const message = oneLine(e.message);
    const extras = [oneLine(e.details), oneLine(e.hint)].filter(
      (p) => p && p !== message && !message.startsWith(p) && !p.startsWith(message)
    );

    const text = [message, ...extras].filter(Boolean).join(' - ');
    if (text) {
      const withCode = e.code ? `${text} (${e.code})` : text;
      // "Failed to fetch" is what the browser says; it is not what a person
      // needs to hear when their board would not save. The append is guarded
      // because this runs TWICE on one failure - once in failIf, once on the
      // Error that produced - so it has to be idempotent.
      const isNetwork = /failed to fetch|networkerror|load failed/i.test(withCode);
      return isNetwork && !withCode.includes(NETWORK_ADVICE)
        ? `${withCode} - ${NETWORK_ADVICE}`
        : withCode;
    }
  }

  // Nothing legible: say so plainly rather than showing an empty message
  return 'Unknown error - the request may not have reached the server';
}

/**
 * Throw a labelled error for a Supabase result, so the report can name the step
 * that failed. Which step matters: "saving the pedals" and "removing deleted
 * pedals" are different problems with different consequences.
 */
export function failIf(step: string, error: unknown): void {
  if (!error) return;
  throw new Error(`${step}: ${describeSaveError(error)}`, { cause: error });
}
