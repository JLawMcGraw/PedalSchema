'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * The error boundary for every page inside the app shell.
 *
 * What it replaces was Next's own error page: unbranded, and with no route
 * back into the app. This one keeps the header above it - the (dashboard)
 * layout still renders - so the nav is intact, and it adds the two things a
 * person actually wants: try again, and go somewhere that works.
 *
 * `reset()` re-renders the segment WITHOUT a full page reload, which is the
 * right first move for the common cause here: a Supabase query that failed
 * once. A reload would throw away the whole client, including an editor's
 * unsaved store.
 *
 * The copy is deliberately plain. No "Oops", no exclamation mark, and it says
 * what we know rather than apologising: the skill's rule, and it is right -
 * "Something went wrong" with a retry is more useful than a cheerful noise.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // deliberately does not ship to the browser. Without logging it here,
    // a production report is unmatchable to anything in the server logs.
    console.error('[dashboard] render failed', error.digest ?? '(no digest)', error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium tracking-wide text-muted-foreground">Error</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance">
        We couldn&apos;t load that
      </h1>
      <p className="mt-3 max-w-prose text-muted-foreground text-pretty">
        The request failed on its way to the database. Your boards are not
        affected - nothing was being written.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard">
          <Button variant="outline">My pedalboards</Button>
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          reference {error.digest}
        </p>
      )}
    </main>
  );
}
