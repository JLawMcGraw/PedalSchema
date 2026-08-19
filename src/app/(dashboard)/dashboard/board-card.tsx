'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { describeSaveError } from '@/lib/save-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThree, Trash } from '@phosphor-icons/react';

export interface BoardCardProps {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  boardLabel: string;
}

/**
 * One board on the dashboard, with a delete that confirms IN PLACE.
 *
 * Two things here are deliberate and were both wrong in the obvious version:
 *
 * 1. The confirm is not a modal. Deleting is destructive so it must be
 *    confirmed, but a dialog to answer one yes/no question is what
 *    `.agents/skills/redesign-existing-projects` means by "modals for
 *    everything". The card turns into its own confirmation instead, so the
 *    thing you are about to delete stays on screen while you decide.
 *
 * 2. A failure is reported on the card, not through `window.alert`. The row is
 *    still there, the user needs to know why, and an alert cannot say.
 */
export function BoardCard({ id, name, description, updatedAt, boardLabel }: BoardCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The delete resolves before the server component has re-rendered, so the
  // card must stay in its pending state across the refresh or it flashes back
  // to normal for a beat before vanishing.
  const [isRefreshing, startRefresh] = useTransition();
  const busy = deleting || isRefreshing;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    // configuration_pedals, configuration_cables and the row itself go together
    // via ON DELETE CASCADE (20240101000001), and RLS already restricts the
    // delete to the owner - so this is one statement, not three.
    const { error: deleteError } = await createClient()
      .from('configurations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      setError(describeSaveError(deleteError));
      setDeleting(false);
      return;
    }
    startRefresh(() => router.refresh());
  }

  if (confirming) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg">Delete {name}?</CardTitle>
          <CardDescription>
            The board and its pedal layout go with it. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? 'Deleting...' : 'Delete board'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <article className="relative group">
      <Card className="transition-colors duration-200 group-hover:border-primary/50">
        <CardHeader>
          {/* An 80-character name is now one rename away, and an unbreakable
              one used to run 258px PAST the card edge and under the menu.
              break-words alone did nothing: CardHeader is a grid, so the title
              is a grid item at the default min-width:auto and simply grew to
              max-content instead of wrapping. min-w-0 is what lets it wrap at
              all; pr-8 then reserves the menu's corner. */}
          <CardTitle className="text-lg pr-8 break-words min-w-0">
            {/* Stretched link: the whole card is the target, but the DOM keeps
                one anchor rather than an anchor wrapping a menu button - which
                is invalid HTML and swallows the menu's click. */}
            <Link href={`/editor/${id}`} className="after:absolute after:inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {name}
            </Link>
          </CardTitle>
          <CardDescription>{boardLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {description || 'No description'}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Updated {new Date(updatedAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>

      <div className="absolute top-4 right-4 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity duration-200"
              aria-label={`Actions for ${name}`}
            >
              <DotsThree className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirming(true)}
            >
              <Trash className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
