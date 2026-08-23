'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BoardThumbnail, type ThumbnailPedal } from '@/components/boards/board-thumbnail';
import { useBoardActions, BoardMenu, DeleteConfirm, Stat, fitVerdict } from './board-actions';

export interface BoardHeroProps {
  id: string;
  name: string;
  pinned: boolean;
  /** Already rendered on the server - see lib/relative-time. */
  editedLabel: string;
  boardLabel: string;
  widthInches: number;
  depthInches: number;
  railWidthInches?: number;
  railPositionsFromBack?: number[];
  pedalCount: number;
  knownDrawMa: number;
  unknownDrawCount: number;
  /** Total cable length in inches, or null when it could not be derived. */
  cableInches: number | null;
  overlapCount?: number;
  offBoardCount?: number;
  outputsOverCount?: number;
  isPublic?: boolean;
  pedals: ThumbnailPedal[];
}

/**
 * The board in progress, given the page.
 *
 * At one to three boards a 3-up grid of identical cards makes the user choose
 * between things they are not choosing between. One board is the answer 90% of
 * the time and the layout should say so: the pinned board - or the most
 * recently edited, when nothing is pinned - gets a full-width drawing on the
 * left and its vitals on the right, with `Continue editing` as the primary
 * action. The rest sit below as compact rows.
 *
 * NO SHARED FRAME. Every other thumbnail on this page is drawn into one frame
 * so board sizes compare; that comparison is worth keeping between siblings
 * and pointless for a hero that stands alone, so this one fills its pane.
 */
export function BoardHero(props: BoardHeroProps) {
  const {
    id, name, pinned, editedLabel, boardLabel, widthInches, depthInches,
    railWidthInches, railPositionsFromBack, pedalCount, knownDrawMa,
    unknownDrawCount, cableInches, isPublic = false, pedals,
  } = props;

  const [confirming, setConfirming] = useState(false);
  const { error, setError, busy, duplicate, remove, setPinned } = useBoardActions(id);
  const fit = fitVerdict(props);

  if (confirming) {
    return (
      <DeleteConfirm
        name={name}
        error={error}
        busy={busy}
        onConfirm={remove}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
      />
    );
  }

  return (
    <article className="flex flex-col border border-border bg-card md:flex-row">
      {/* The drawing */}
      <div className="flex-1 border-b border-border bg-background/40 p-4 md:border-b-0 md:border-r">
        <BoardThumbnail
          widthInches={widthInches}
          depthInches={depthInches}
          railWidthInches={railWidthInches}
          railPositionsFromBack={railPositionsFromBack}
          pedals={pedals}
          className="h-[268px] w-full"
        />
      </div>

      {/* Identity and vitals */}
      <div className="flex w-full flex-col px-6 py-5 md:w-[430px] md:shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {/* Recency alone is the wrong answer for a user with a main board
                  and two situational ones, so the header says which rule put
                  this board here. */}
              {pinned && <span className="text-primary">Pinned · </span>}
              {editedLabel}
            </p>
            <h2 className="mt-1.5 break-words text-2xl font-semibold">{name}</h2>
            {/* Model and dimensions are IDENTITY, not measurement - they say
                which board this is, they are not a reading that changes. So
                they sit under the name rather than in the stat grid. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {[boardLabel, widthInches > 0 ? `${widthInches}×${depthInches}in` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <BoardMenu
            name={name}
            pinned={pinned}
            busy={busy}
            onDuplicate={duplicate}
            onPin={() => setPinned(!pinned)}
            onDelete={() => setConfirming(true)}
            className="-mr-2 shrink-0 px-2"
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4">
          <Stat label="Pedals" value={String(pedalCount)} />
          <Stat
            label="Draw"
            // An unrecorded draw is not a draw of zero - engine/power's rule,
            // and the same "at least" the editor's HUD shows.
            value={`${unknownDrawCount > 0 ? '≥' : ''}${knownDrawMa}`}
            unit="mA"
          />
          {/* A hairline between the rows of the 2x2. */}
          <div className="col-span-2 -my-1 border-t border-border" />
          <Stat
            label="Cable"
            value={cableInches === null ? '—' : cableInches.toFixed(1)}
            unit={cableInches === null ? undefined : 'in'}
          />
          <Stat label="Fit" value={fit.text} tone={fit.bad ? 'bad' : 'good'} />
        </dl>

        {isPublic && (
          /* Not a fault, so not destructive-red. It is here because a board can
             be live on a URL with nothing on this page saying so, and that is
             the kind of thing you want to notice without opening it. */
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Public
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Actions pinned to the bottom of the pane, so the hero has one
            obvious way back in wherever the vitals happen to end. */}
        <div className="mt-auto flex items-center gap-2 pt-5">
          <Link href={`/editor/${id}`}>
            <Button size="sm" className="h-9">
              Continue editing
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="h-9" onClick={duplicate} disabled={busy}>
            Duplicate
          </Button>
        </div>
      </div>
    </article>
  );
}
