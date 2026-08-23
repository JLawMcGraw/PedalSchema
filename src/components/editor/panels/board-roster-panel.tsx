'use client';

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { derivePedalDisplayNames, displayNameFor } from '@/lib/pedal-display-names';
import { getCategoryColor } from '@/lib/constants/pedal-categories';
import { PedalLibraryPanel } from './pedal-library-panel';
import { MagnifyingGlass, Plus, DotsSixVertical, CaretLeft } from '@phosphor-icons/react';
import type { Pedal } from '@/types';

/**
 * The left rail, after the board is built.
 *
 * WHAT THIS REPLACES, AND WHY. The rail used to be a seventeen-section
 * catalogue with a small roster pinned under it. That is the right rail for
 * the ten minutes you spend BUILDING a board and the wrong one for every hour
 * after: once the pedals are placed, the rail's job stops being "find one
 * pedal in a 67-item catalogue" and becomes "look at what I have, in the order
 * the signal meets it".
 *
 * So the roster is promoted to the whole rail, in CHAIN ORDER, and the
 * catalogue moves behind "Add pedal" - the handoff allows either a popover or
 * a swap, and this swaps. A swap keeps `PedalLibraryPanel` mounted exactly as
 * it is, which means the seventeen sections, the search, the open-override
 * logic and the `data-library-pedal` handles two gates select on all keep
 * working untouched.
 *
 * THIS LIST EXPANDS DUPLICATES where the old roster collapsed them ("CS-3 · 1"
 * and "CS-3 · 2", not "CS-3 x2"). Collapsing was right for an alphabetical
 * lookup index; it is wrong for a chain, where the two CS-3s are at different
 * positions and the whole point of the column is which position.
 */

/** Rows are 25px, so 15 pedals fit without scrolling and ~28 before it starts. */
function RosterRow({
  id,
  position,
  displayName,
  categoryColour,
  currentMa,
  isSelected,
  isDropTarget,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  id: string;
  position: number;
  displayName: string;
  categoryColour: string;
  currentMa: number | null;
  isSelected: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      data-roster-row={id}
      className={`group flex cursor-pointer items-center gap-2 border-t border-border/50 py-[5px] pl-1.5 pr-3 transition-colors duration-200 ${
        isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
      } ${isDropTarget ? 'border-t-primary' : ''}`}
    >
      {/*
        The drag handle. Cursor-grab on the handle only, while `draggable`
        sits on the whole row - dragging a row by its middle is the gesture
        people try first, and restricting the drag to a 14px target would make
        reordering a precision task in a 25px row.
      */}
      <DotsSixVertical
        className={`size-3.5 shrink-0 cursor-grab ${
          isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
        }`}
      />

      <span
        className={`w-4 shrink-0 text-right font-mono text-[10px] tabular-nums ${
          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
        }`}
      >
        {position}
      </span>

      {/* The family, as a rule rather than a dot - the same mark the chain
          rows use for the same thing. In chain order the families cluster, so
          fifteen dots read as four amber circles in a row followed by four
          blue ones; a rule beside the label says the same thing without
          pretending to be fifteen categories. */}
      <span
        aria-hidden
        className="h-3.5 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColour }}
      />

      <span className="min-w-0 flex-1 truncate text-xs font-medium">{displayName}</span>

      {/*
        An unrecorded draw is NOT a draw of zero - `Pedal.currentMa` is
        three-state on purpose and the type comment is emphatic about it. A
        dash is the third state; `?? 0` here would be the first step toward the
        footer total quietly under-reporting.
      */}
      <span
        className={`shrink-0 font-mono text-[10px] tabular-nums ${
          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
        }`}
      >
        {currentMa === null ? '—' : `${currentMa}mA`}
      </span>
    </div>
  );
}

export function BoardRosterPanel({ pedals }: { pedals: Pedal[] }) {
  /** The catalogue is a MODE of this rail, not a second panel beside it. */
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const { selectPedal, selectedPedalId, pedalToAdd } = useEditorStore(
    useShallow((s) => ({
      selectPedal: s.selectPedal,
      selectedPedalId: s.selectedPedalId,
      pedalToAdd: s.pedalToAdd,
    }))
  );
  const { placedPedals, pedalsById, updatePedalChainPosition } = useConfigurationStore(
    useShallow((s) => ({
      placedPedals: s.placedPedals,
      pedalsById: s.pedalsById,
      updatePedalChainPosition: s.updatePedalChainPosition,
    }))
  );
  const power = useDerivedConfiguration((d) => d.power);

  const sorted = useMemo(
    () => [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition),
    [placedPedals]
  );

  /*
   * Names from the engine, not from a second count of its own. The ordinal
   * this rail shows is the same ordinal the chain panel and the cable list
   * show, because all three read one derivation - see lib/pedal-display-names.
   */
  const displayNames = useMemo(
    () => derivePedalDisplayNames(placedPedals, pedalsById),
    [placedPedals, pedalsById]
  );

  /*
   * Reordering, by the SAME store action the chain panel's carets call. It
   * records history, so Cmd+Z reverts a drag exactly as it reverts a caret.
   *
   * It moves the pedal in the CHAIN and not on the BOARD. Position and chain
   * order are independent in this app and a drag here must not quietly place
   * a pedal somewhere - that is what the canvas is for.
   */
  const handleDrop = (targetId: string) => {
    const from = placedPedals.find((p) => p.id === dragId);
    const to = placedPedals.find((p) => p.id === targetId);
    setDragId(null);
    setDropId(null);
    if (!from || !to || from.id === to.id) return;
    updatePedalChainPosition(from.id, to.chainPosition);
  };

  if (catalogueOpen) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={() => setCatalogueOpen(false)}
            className="flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            <CaretLeft className="size-3" />
            On this board
          </button>
        </div>
        {/* Unchanged. The catalogue was already right; it was only in the
            wrong place for a board that is already built. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <PedalLibraryPanel pedals={pedals} />
        </div>
      </div>
    );
  }

  const total = sorted.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 1. Add pedal. A search-SHAPED control rather than a search box: it
             does not filter anything, it opens the thing that does, and a real
             input here would invite typing into a field that cannot answer. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          data-open-catalogue
          onClick={() => setCatalogueOpen(true)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-input px-2 text-left text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          <MagnifyingGlass className="size-3.5 shrink-0" />
          <span className="truncate">Add pedal</span>
        </button>
        <button
          type="button"
          aria-label="Add pedal"
          onClick={() => setCatalogueOpen(true)}
          className="flex size-8 shrink-0 items-center justify-center bg-secondary text-secondary-foreground transition-colors duration-200 hover:bg-accent"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* The placement prompt has to survive the swap back to this view -
          `pedalToAdd` is set in the catalogue and consumed by a click on the
          canvas, so the rail it was set from is no longer on screen. */}
      {pedalToAdd && (
        <div className="shrink-0 border-b bg-primary/10 p-2 text-center text-xs">
          Click on the board to place
        </div>
      )}

      {/* 2. Header. PANEL_TITLE's register but at --foreground: this is the
             rail's own name now, not a section label inside something else. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-foreground">
          On this board
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          chain order
        </span>
      </div>

      {/* 3. Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing placed yet.
          </p>
        ) : (
          sorted.map((placed) => {
            const pedal = pedalsById[placed.pedalId] || placed.pedal;
            if (!pedal) return null;
            return (
              <RosterRow
                key={placed.id}
                id={placed.id}
                position={placed.chainPosition}
                displayName={displayNameFor(displayNames, placed.id, pedal.name)}
                categoryColour={getCategoryColor(pedal.category)}
                currentMa={pedal.currentMa}
                isSelected={selectedPedalId === placed.id}
                isDropTarget={dropId === placed.id && dragId !== placed.id}
                onSelect={() => selectPedal(placed.id)}
                onDragStart={() => setDragId(placed.id)}
                onDragOver={(e) => {
                  // Without preventDefault the browser refuses the drop and
                  // there is no drop event at all - the row highlights and
                  // then nothing happens, which reads as a broken feature
                  // rather than a missing handler.
                  e.preventDefault();
                  setDropId(placed.id);
                }}
                onDrop={() => handleDrop(placed.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropId(null);
                }}
              />
            );
          })
        )}
      </div>

      {/* 4. Footer. The same two totals the HUD carries, at the foot of the
             list they describe - and the same "≥" for an unrecorded draw that
             the Power panel and the HUD both use. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-t px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {total} {total === 1 ? 'pedal' : 'pedals'}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {power.unknown.length > 0 ? '≥' : ''}
          {power.knownTotalMa}mA
        </span>
      </div>
    </div>
  );
}
