import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Can a visitor open the editor without an account?
 *
 * The landing page's whole call to action rests on this: `OPEN THE EDITOR`
 * followed by `NO ACCOUNT NEEDED`. It needs TWO things to be true, and only
 * one of them lives in this repo:
 *
 *   1. this flag, `NEXT_PUBLIC_ANONYMOUS_EDITOR=true`;
 *   2. Anonymous sign-ins enabled in the Supabase project
 *      (Authentication -> Sign In / Providers -> Anonymous sign-ins).
 *
 * As of writing, (2) is OFF - the auth endpoint answers
 * `anonymous_provider_disabled` - and it is a dashboard setting, reachable
 * neither from the database nor from the anon key.
 *
 * So the flag defaults to OFF and the page renders the handoff's own stated
 * fallback: the CTA reads `SIGN UP FREE` and the promise line comes off. That
 * matters more than it sounds. A button captioned NO ACCOUNT NEEDED that
 * bounces the visitor to a signup form is worse than no promise at all - it is
 * the page lying on the first thing it says. Turning both switches on flips
 * the copy and the behaviour together.
 *
 * RLS NEEDS NO CHANGES for this. An anonymous sign-in creates a real
 * `auth.users` row with `is_anonymous = true`, so `auth.uid() = user_id` holds
 * exactly as it does for anyone else, and the board they build is genuinely
 * theirs.
 */
export const ANONYMOUS_EDITOR_ENABLED =
  process.env.NEXT_PUBLIC_ANONYMOUS_EDITOR === 'true';

export type AnonymousResult = { ok: true } | { ok: false; error: string };

/**
 * Get the visitor a session, if they do not already have one.
 *
 * Deliberately a no-op for a signed-in user: the CTA is one button for
 * everybody, and someone who is already logged in should land in the editor
 * as themselves rather than be handed a second, empty identity.
 */
export async function ensureSession(supabase: SupabaseClient): Promise<AnonymousResult> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return { ok: true };

  if (!ANONYMOUS_EDITOR_ENABLED) {
    return { ok: false, error: 'Anonymous editing is not enabled.' };
  }

  const { error } = await supabase.auth.signInAnonymously();
  if (!error) return { ok: true };

  /*
   * Named explicitly, because this is the one failure that is a CONFIGURATION
   * problem rather than the visitor's: the flag is on and the provider is
   * off. Saying "something went wrong" here would send whoever hits it looking
   * in the wrong place.
   */
  if (error.message?.toLowerCase().includes('anonymous')) {
    return {
      ok: false,
      error:
        'Guest sessions are switched off for this project. Enable anonymous sign-ins in Supabase, or create an account.',
    };
  }
  return { ok: false, error: error.message || 'Could not start a session. Try again.' };
}
