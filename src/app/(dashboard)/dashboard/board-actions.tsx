'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { describeSaveError } from '@/lib/save-error';
import { duplicateConfiguration } from '@/lib/duplicate-configuration';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThree, Trash, Copy, PushPin, PushPinSlash } from '@phosphor-icons/react';

/**
 * Everything a board can have done to it, in one place.
 *
 * The hero and the compact row are two presentations of one board and want the
 * same four actions. This was all inside `BoardCard`, which is now two
 * components; copying the delete-confirm state machine into both is how the
 * two copies start disagreeing about what "busy" means.
 */
export function useBoardActions(id: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [pinning, setPinning] = useState(false);
  // The delete resolves before the server component has re-rendered, so the
  // card must stay in its pending state across the refresh or it flashes back
  // to normal for a beat before vanishing.
  const [isRefreshing, startRefresh] = useTransition();
  const busy = deleting || isRefreshing || duplicating || pinning;

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
  async function duplicate() {
    setDuplicating(true);
    setError(null);
    try {
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
    } catch {
      setError('Something went wrong. Check your connection and try again.');
      setDuplicating(false);
    }
  }

  async function remove() {
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

  /**
   * Pin this board, or unpin it.
   *
   * UNPIN FIRST, ALWAYS. `idx_configurations_one_pinned` is a partial unique
   * index on (user_id) WHERE pinned, so writing the new pin while the old one
   * still holds is a 23505 - the database is what enforces "at most one", not
   * this function remembering to tidy up. Clearing every row first is also
   * correct if the invariant has somehow been broken already.
   */
  async function setPinned(next: boolean) {
    setPinning(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setError('You are signed out. Sign in and try again.');
        setPinning(false);
        return;
      }

      const { error: clearError } = await supabase
        .from('configurations')
        .update({ pinned: false })
        .eq('user_id', auth.user.id)
        .eq('pinned', true);
      if (clearError) {
        setError(describeSaveError(clearError));
        setPinning(false);
        return;
      }

      if (next) {
        const { error: pinError } = await supabase
          .from('configurations')
          .update({ pinned: true })
          .eq('id', id);
        if (pinError) {
          setError(describeSaveError(pinError));
          setPinning(false);
          return;
        }
      }
      startRefresh(() => {
        router.refresh();
        setPinning(false);
      });
    } catch {
      setError('Something went wrong. Check your connection and try again.');
      setPinning(false);
    }
  }

  return { error, setError, busy, deleting, duplicate, remove, setPinned };
}

/** The `⋯` menu. Same four items wherever a board is drawn. */
export function BoardMenu({
  name,
  pinned,
  busy,
  onDuplicate,
  onPin,
  onDelete,
  className,
}: {
  name: string;
  pinned: boolean;
  busy: boolean;
  onDuplicate: () => void;
  onPin: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className={className}
          aria-label={`Actions for ${name}`}
        >
          <DotsThree className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onPin} data-pin-board>
          {pinned ? (
            <>
              <PushPinSlash className="mr-2 h-4 w-4" />
              Unpin
            </>
          ) : (
            <>
              <PushPin className="mr-2 h-4 w-4" />
              Pin to the top
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The delete confirmation, IN PLACE.
 *
 * Deleting is destructive so it must be confirmed, but a dialog to answer one
 * yes/no question is what `.agents/skills/redesign-existing-projects` means by
 * "modals for everything". The board turns into its own confirmation instead,
 * so the thing you are about to delete stays on screen while you decide.
 *
 * A failure is reported here rather than through `window.alert`: the row is
 * still there, the user needs to know why, and an alert cannot say.
 */
export function DeleteConfirm({
  name,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  error: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-destructive/50 bg-card p-5">
      <h3 className="text-base font-semibold">Delete {name}?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The board and its pedal layout go with it. This cannot be undone.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          data-confirm-delete
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Deleting...' : 'Delete board'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * One stat: a mono uppercase label over a tabular value.
 *
 * The editor's readout register, brought to the dashboard so the two screens
 * report the same numbers the same way. Scale is the contrast, not weight.
 */
export function Stat({
  label,
  value,
  unit,
  tone = 'neutral',
  size = 'lg',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'good' | 'bad';
  size?: 'lg' | 'sm';
}) {
  const colour =
    tone === 'bad' ? 'text-destructive' : tone === 'good' ? 'text-primary' : 'text-foreground';
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 truncate tabular-nums ${colour} ${
          size === 'lg' ? 'text-xl font-medium' : 'font-mono text-[13px]'
        }`}
      >
        {value}
        {unit && <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>}
      </dd>
    </div>
  );
}

/**
 * The FIT verdict, computed once for both presentations.
 *
 * Ordered worst-first: a pedal off the board cannot be built at all, two
 * pedals overlapping is a layout problem, and an output over its rating is a
 * supply problem you can fix by re-plugging.
 *
 * Unrouted cables are deliberately absent - that needs the full router per
 * board, which is a lot of work to render a list page, and it is the one fault
 * you see immediately on opening the board. This is the same PRECEDENCE the
 * editor's FIT field uses, minus the term this page cannot afford to compute.
 */
export function fitVerdict({
  offBoardCount = 0,
  overlapCount = 0,
  outputsOverCount = 0,
}: {
  offBoardCount?: number;
  overlapCount?: number;
  outputsOverCount?: number;
}): { text: string; bad: boolean } {
  if (offBoardCount > 0) return { text: `${offBoardCount} OFF BOARD`, bad: true };
  if (overlapCount > 0) return { text: `${overlapCount} OVERLAP`, bad: true };
  if (outputsOverCount > 0) {
    return {
      text: `${outputsOverCount} OUTPUT${outputsOverCount === 1 ? '' : 'S'} OVER`,
      bad: true,
    };
  }
  return { text: 'OK', bad: false };
}
