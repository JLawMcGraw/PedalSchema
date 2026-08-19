import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * The app's 404.
 *
 * What it replaces was Next's built-in page - the literal text "404 This page
 * could not be found.", with no header, no navigation and, measured, zero
 * anchors on the page. A genuine dead end: the only way out was the browser's
 * back button.
 *
 * It is reached more often than it looks. Every pedal card pointed at a route
 * that did not exist until this session, and a deleted board lands here by
 * design - `editor/[id]` calls notFound() when the row is gone.
 *
 * It carries its own exits because it CANNOT rely on the header, and which
 * way it goes depends on how it was reached (both measured):
 *
 *   /nonsense                    no header, 2 links - these buttons are the
 *   (an unmatched URL)           only way out of the page
 *   notFound() from a page       header present, 7 links - the (dashboard)
 *   inside (dashboard)           layout above it still renders
 *
 * So the first case is the one that matters, and it is the one a mistyped or
 * stale URL lands on.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 max-w-prose text-muted-foreground text-pretty">
        The link may be out of date, or the board it pointed to may have been
        deleted.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard">
          <Button>My pedalboards</Button>
        </Link>
        <Link href="/pedals">
          <Button variant="outline">Pedal database</Button>
        </Link>
      </div>
    </main>
  );
}
