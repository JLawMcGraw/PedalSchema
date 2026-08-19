'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createClient } from '@/lib/supabase/client';
import { useConfigurationStore } from '@/store/configuration-store';
import { describeSaveError } from '@/lib/save-error';
import { generateShareSlug, shareUrl } from '@/lib/share-link';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check, Copy } from '@phosphor-icons/react';

/**
 * Publishing a board, and the link it gets.
 *
 * This writes to the database IMMEDIATELY rather than joining the dirty/save
 * flow that name and description use. Publishing is a discrete act with a
 * consequence outside the app, and a share link that 404s until you remember
 * to press Save is worse than no share link at all.
 */
export function ShareBoard() {
  const { id, isPublic, shareSlug, setSharing } = useConfigurationStore(
    useShallow((s) => ({
      id: s.id,
      isPublic: s.isPublic,
      shareSlug: s.shareSlug,
      setSharing: s.setSharing,
    }))
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url =
    shareSlug && typeof window !== 'undefined'
      ? shareUrl(window.location.origin, shareSlug)
      : null;

  async function toggle(next: boolean) {
    if (!id) return;
    setBusy(true);
    setError(null);

    // Keep the slug when unpublishing. Re-publishing then restores the same
    // link rather than silently breaking every copy of the old one - and the
    // row is unreachable while is_public is false regardless, because the
    // loader requires both.
    const slug = shareSlug ?? generateShareSlug();

    const { error: writeError } = await createClient()
      .from('configurations')
      .update({ is_public: next, share_slug: slug })
      .eq('id', id);

    if (writeError) {
      setError(describeSaveError(writeError));
      setBusy(false);
      return;
    }
    setSharing(next, slug);
    setBusy(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright. Saying so beats a button
      // that appears to work; the field beside it is selectable either way.
      setError('Could not reach the clipboard - copy the link by hand.');
    }
  }

  return (
    <section className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="board-public" className="text-xs">
          Publish this board
        </Label>
        <Switch
          id="board-public"
          checked={isPublic}
          disabled={busy || !id}
          onCheckedChange={toggle}
        />
      </div>

      {/* The wording is deliberate. The RLS policy is
          `FOR SELECT USING (is_public = true)` with no slug condition, so a
          published board is readable by anyone holding the anon key - which
          ships in the client bundle. The link is a convenience, NOT a secret,
          and calling it "anyone with the link" would be a straightforward
          lie. */}
      <p className="text-[11px] text-muted-foreground">
        {isPublic
          ? 'Anyone can view this board, with or without an account. The link is not a secret.'
          : 'Off. Only you can see this board.'}
      </p>

      {isPublic && url && (
        <div className="flex items-center gap-1.5">
          <input
            readOnly
            value={url}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 h-8 rounded-md border border-input bg-muted/40 px-2 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            className="shrink-0 px-2"
            aria-label="Copy share link"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
