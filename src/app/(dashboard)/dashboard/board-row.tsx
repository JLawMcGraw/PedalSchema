'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BoardThumbnail, type ThumbnailPedal } from '@/components/boards/board-thumbnail';
import { useBoardActions, BoardMenu, DeleteConfirm, Stat, fitVerdict } from './board-actions';

export interface BoardRowProps {
  id: string;
  name: string;
  pinned: boolean;
  /** Already rendered on the server - see lib/relative-time. */
  editedLabel: string;
  boardLabel: string;
  widthInches: number;
  depthInches: number;
  /** The largest of the NON-HERO boards, so these compare with each other. */
  frameWidthInches?: number;
  frameDepthInches?: number;
  railWidthInches?: number;
  railPositionsFromBack?: number[];
  pedalCount: number;
  knownDrawMa: number;
  unknownDrawCount: number;
  overlapCount?: number;
  offBoardCount?: number;
  outputsOverCount?: number;
  isPublic?: boolean;
  pedals: ThumbnailPedal[];
}

/**
 * A board that is not the hero.
 *
 * Compact, horizontal, and drawn into a frame SHARED with its siblings - the
 * hero stands alone so its size compares with nothing, but these sit beside
 * each other and a Sunday rig should look smaller than a Classic Pro.
 *
 * A faulty board takes a 2px red rule down its left edge. The FIT field
 * already says what is wrong; the rule is what makes it findable at a glance
 * in a stack of rows, which is the difference between a list of boards and a
 * status board.
 */
export function BoardRow(props: BoardRowProps) {
  const {
    id, name, pinned, editedLabel, boardLabel, widthInches, depthInches,
    frameWidthInches, frameDepthInches, railWidthInches, railPositionsFromBack,
    pedalCount, knownDrawMa, unknownDrawCount, isPublic = false, pedals,
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
    <article
      className={`group relative flex border border-border bg-card transition-colors duration-200 hover:border-primary/50 ${
        fit.bad ? 'border-l-2 border-l-destructive' : ''
      }`}
    >
      <div className="w-[200px] shrink-0 border-r border-border bg-background/40 p-3">
        <BoardThumbnail
          widthInches={widthInches}
          depthInches={depthInches}
          frameWidthInches={frameWidthInches}
          frameDepthInches={frameDepthInches}
          railWidthInches={railWidthInches}
          railPositionsFromBack={railPositionsFromBack}
          pedals={pedals}
          className="h-24 w-full"
        />
      </div>

      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          {/* Stretched link: the whole row is the target, but the DOM keeps one
              anchor rather than an anchor wrapping a menu button - which is
              invalid HTML and swallows the menu's click. `min-w-0` is what
              lets a long name truncate instead of pushing the time off. */}
          <h3 className="min-w-0 truncate text-base font-semibold">
            <Link
              href={`/editor/${id}`}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </Link>
          </h3>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {pinned && <span className="text-primary">Pinned · </span>}
            {editedLabel}
          </span>
        </div>

        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[boardLabel, widthInches > 0 ? `${widthInches}×${depthInches}in` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Stat label="Pedals" value={String(pedalCount)} size="sm" />
          <Stat
            label="Draw"
            value={`${unknownDrawCount > 0 ? '≥' : ''}${knownDrawMa}`}
            unit="mA"
            size="sm"
          />
          <Stat label="Fit" value={fit.text} tone={fit.bad ? 'bad' : 'good'} size="sm" />
          {isPublic && <Stat label="Link" value="PUBLIC" size="sm" />}
        </dl>

        {/* `relative z-10` lifts it above the stretched link covering the row -
            otherwise the message is visible and unselectable. */}
        {error && (
          <p role="alert" className="relative z-10 mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="relative z-10 shrink-0 p-2">
        <BoardMenu
          name={name}
          pinned={pinned}
          busy={busy}
          onDuplicate={duplicate}
          onPin={() => setPinned(!pinned)}
          onDelete={() => setConfirming(true)}
          className="px-2 opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </div>
    </article>
  );
}
