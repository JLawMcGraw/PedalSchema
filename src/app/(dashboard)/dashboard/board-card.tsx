'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { describeSaveError } from '@/lib/save-error';
import { duplicateConfiguration } from '@/lib/duplicate-configuration';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThree, Trash, Copy } from '@phosphor-icons/react';
import { BoardThumbnail, type ThumbnailPedal } from '@/components/boards/board-thumbnail';

export interface BoardCardProps {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  boardLabel: string;
  widthInches: number;
  depthInches: number;
  /** The largest board on the page, so every card shares one scale. */
  frameWidthInches?: number;
  frameDepthInches?: number;
  railWidthInches?: number;
  railPositionsFromBack?: number[];
  knownDrawMa: number;
  unknownDrawCount: number;
  pedals: ThumbnailPedal[];
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
export function BoardCard({
  id,
  name,
  description,
  updatedAt,
  boardLabel,
  widthInches,
  depthInches,
  frameWidthInches,
  frameDepthInches,
  railWidthInches,
  railPositionsFromBack,
  knownDrawMa,
  unknownDrawCount,
  pedals,
}: BoardCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The delete resolves before the server component has re-rendered, so the
  // card must stay in its pending state across the refresh or it flashes back
  // to normal for a beat before vanishing.
  const [isRefreshing, startRefresh] = useTransition();
  const [duplicating, setDuplicating] = useState(false);
  const busy = deleting || isRefreshing;

  /*
   * Duplicate lands the user ON the copy, in the editor.
   *
   * The alternative - stay on the dashboard and let the new card appear - is
   * what a "duplicate" in a file manager does, but this is not filing, it is
   * the start of an edit. Nobody copies a board to look at two identical
   * boards; they copy it to change one. The copy is also the only card whose
   * name they do not know yet, so leaving them to find it on a dashboard is
   * work for no reason.
   */
  async function handleDuplicate() {
    setDuplicating(true);
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError('You are signed out. Sign in and try again.');
      setDuplicating(false);
      return;
    }
    const result = await duplicateConfiguration(supabase, id, auth.user.id);
    if (!result.ok) {
      setError(result.error);
      setDuplicating(false);
      return;
    }
    router.push(`/editor/${result.id}`);
  }

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
              data-confirm-delete
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
      <Card className="overflow-hidden pt-0 transition-colors duration-200 group-hover:border-primary/50">
        {/* THE BOARD, DRAWN. Two boards used to be told apart by their names
            alone: the card carried a name, a model, "No description" and a
            date, and nothing about the thing itself. */}
        <div className="border-b bg-background/40 p-3">
          <BoardThumbnail
            widthInches={widthInches}
            depthInches={depthInches}
            frameWidthInches={frameWidthInches}
            frameDepthInches={frameDepthInches}
            railWidthInches={railWidthInches}
            railPositionsFromBack={railPositionsFromBack}
            pedals={pedals}
            /* 144px, not the 96 it started at. Measured across three heights
               on the real dashboard: at 96px the largest board filled 61% of
               the strip, at 144px it fills 78% at 9 px/inch, and at 176px it
               fills 95% but the image swamps the text below it. */
            className="h-36 w-full"
          />
        </div>
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
          {/* The stats a person compares boards by. "No description" was
              filler on every card that had none, so it is gone - the row only
              appears when there is something to read. */}
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <div className="flex items-baseline gap-1">
              <dd className="font-medium tabular-nums">{pedals.length}</dd>
              <dt className="text-muted-foreground">
                pedal{pedals.length === 1 ? '' : 's'}
              </dt>
            </div>
            <div className="flex items-baseline gap-1">
              <dd className="font-medium tabular-nums">
                {knownDrawMa}
                <span className="text-muted-foreground">mA</span>
              </dd>
              <dt className="text-muted-foreground">
                {unknownDrawCount > 0 ? `+ ${unknownDrawCount} unknown` : 'draw'}
              </dt>
            </div>
            {widthInches > 0 && (
              <div className="flex items-baseline gap-1">
                <dd className="font-medium tabular-nums">
                  {widthInches}&times;{depthInches}
                </dd>
                <dt className="text-muted-foreground">in</dt>
              </div>
            )}
          </dl>
          {description && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Updated {new Date(updatedAt).toLocaleDateString()}
          </p>
          {/* A duplicate fails on the ORDINARY card, not the confirm card, so
              it needs its own place to say why. `relative z-10` lifts it above
              the stretched link covering the card - otherwise the message is
              visible and unselectable. */}
          {error && !confirming && (
            <p role="alert" className="relative z-10 mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
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
            <DropdownMenuItem data-card-action="duplicate" onSelect={handleDuplicate} disabled={duplicating}>
              <Copy className="h-4 w-4 mr-2" />
              {duplicating ? 'Duplicating...' : 'Duplicate'}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-card-action="delete"
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
