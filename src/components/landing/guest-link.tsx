'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ANONYMOUS_EDITOR_ENABLED, ensureSession } from '@/lib/anonymous-editor';

/**
 * A nav link to somewhere that needs a session.
 *
 * `/boards` and `/pedals` live in the `(dashboard)` route group, whose layout
 * redirects a signed-out visitor to `/login`. On an app that is otherwise
 * gated that is correct; on a LANDING PAGE it means the two links inviting you
 * to look at the catalogue both dead-end at a login form, which is the
 * opposite of what the page is arguing.
 *
 * So the link takes the same route the main CTA does: with guest sessions
 * available it opens one and goes where it said it would, and without them it
 * goes to `/login` - the same place it would have landed anyway, just without
 * the visitor watching a redirect happen to them.
 *
 * Still a real <a> underneath, so it middle-clicks, opens in a new tab and
 * shows its destination in the status bar. `preventDefault` only fires on the
 * plain-click path where the guest session is worth waiting for.
 */
export function GuestLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <a
      href={href}
      className={className}
      onClick={async (e) => {
        // Let the browser handle anything that is not a plain left click:
        // modifier keys mean "open this somewhere else", and hijacking them is
        // the classic way a SPA breaks middle-click.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (!ANONYMOUS_EDITOR_ENABLED) return; // plain navigation; the layout redirects
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const result = await ensureSession(createClient());
        router.push(result.ok ? href : '/login');
        router.refresh();
        setBusy(false);
      }}
    >
      {children}
    </a>
  );
}
