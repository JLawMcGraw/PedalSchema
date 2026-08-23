'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ANONYMOUS_EDITOR_ENABLED, ensureSession } from '@/lib/anonymous-editor';

const PRIMARY =
  'inline-flex h-11 items-center justify-center px-[22px] font-mono text-xs font-semibold uppercase tracking-[0.18em] ' +
  'bg-primary text-primary-foreground transition-opacity duration-200 disabled:opacity-60';

/**
 * The page's one action, repeated once.
 *
 * Two shapes, and which one renders is not a style choice - it is whether the
 * app can actually keep the promise. See lib/anonymous-editor: with guest
 * sessions available this opens the editor and says NO ACCOUNT NEEDED, and
 * without them it is an ordinary signup link with no promise attached.
 */
export function OpenEditorCta({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A signed-in visitor goes to their own dashboard: "open the editor" for
  // someone with three saved boards means one of THOSE boards, not a blank.
  if (signedIn) {
    return (
      <div className="flex flex-col items-start gap-2.5">
        <Link href="/dashboard" className={PRIMARY}>
          Open your boards
        </Link>
      </div>
    );
  }

  if (!ANONYMOUS_EDITOR_ENABLED) {
    return (
      <div className="flex flex-col items-start gap-2.5">
        <Link href="/signup" className={PRIMARY}>
          Sign up free
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2.5">
      <button
        type="button"
        data-open-editor
        disabled={busy}
        className={PRIMARY}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await ensureSession(createClient());
          if (!result.ok) {
            setError(result.error);
            setBusy(false);
            return;
          }
          // `refresh` as well as `push`: the editor is a server component
          // behind an auth check, and the cookie the sign-in just set is not
          // visible to a cached RSC payload.
          router.push('/editor/new');
          router.refresh();
        }}
      >
        {busy ? 'Opening…' : 'Open the editor'}
      </button>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        No account needed
      </p>
      {error && (
        <p role="alert" className="max-w-[420px] text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
