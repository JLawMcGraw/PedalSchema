'use client';

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { getCategoryColor, getCategoryLabel } from '@/lib/constants/pedal-categories';
import { Warning, Lightbulb, Lock, CaretUp, CaretDown, X } from '@phosphor-icons/react';
import type { PlacedPedal } from '@/types';

/**
 * The signal chain, drawn as a chain.
 *
 * What this replaces was a flat list of identical rows, and the problems were
 * structural rather than cosmetic:
 *
 *   - nothing said "signal flows through this". Twenty-two rows, each the same
 *     weight, with a "Guitar In" pill at the top and an "Amp" pill 1150px below
 *     it in an 860px panel;
 *   - every row carried the manufacturer on its own line, at the same size as
 *     the pedal name. On this board that is the word BOSS, twenty-two times,
 *     spending a third of the panel's height to say nothing. The CATEGORY is
 *     what a reader wants there - it says why the pedal is at that position;
 *   - two pedals both called "CS-3" were indistinguishable;
 *   - the primary action, reordering, was forty-four twelve-pixel arrows, all
 *     permanently on screen;
 *   - and the WARNINGS RENDERED LAST, below every pedal. A warning that needs
 *     1150px of scrolling is a warning nobody reads.
 *
 * So: issues first, then a continuous spine with the endpoints as nodes on it,
 * rows at half the height, and the row controls revealed on hover.
 */

/** Rows are ~28px now, against ~52px before, which is what makes 22 fit. */
function ChainRow({
  placed,
  displayName,
  category,
  categoryColour,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUnlock,
}: {
  placed: PlacedPedal;
  displayName: string;
  category: string;
  categoryColour: string;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onRemove: () => void;
  onUnlock: (() => void) | null;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center gap-2 py-1 pl-8 pr-1 cursor-pointer transition-colors ${
        isSelected ? 'bg-primary/15' : 'hover:bg-muted/60'
      }`}
    >
      {/* The node on the spine. Filled when selected, so the chain shows where
          you are without a second highlight. */}
      <span
        aria-hidden
        className={`absolute left-[13px] size-1.5 rounded-full ring-2 ring-background transition-colors ${
          isSelected ? 'bg-primary' : 'bg-border group-hover:bg-muted-foreground'
        }`}
      />

      <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {placed.chainPosition}
      </span>

      {/* The category, as a 2px rule rather than a filled chip. It reads as an
          index mark against the name instead of competing with it. */}
      <span
        aria-hidden
        className="h-3.5 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColour }}
      />

      <span className="min-w-0 flex-1 truncate text-xs font-medium">{displayName}</span>

      {onUnlock && (
        <button
          title="Position pinned - click to let chain rules order this pedal again"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onUnlock();
          }}
        >
          <Lock className="size-3" />
        </button>
      )}

      {/* The category replaces the manufacturer: it says why this pedal sits
          here. It fades rather than unmounting, so the row width never moves. */}
      <span className="shrink-0 text-[10px] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
        {category}
      </span>

      {/*
        Revealed on hover, and OPACITY rather than `hidden`.

        The first version used `hidden group-hover:flex`, which is display:none
        - so the buttons could not take keyboard focus at all, and reordering
        became mouse-only. Opacity keeps them in the tree and focusable, and
        `group-focus-within` brings them into view when tabbing reaches them.
      */}
      <span className="absolute right-1 flex shrink-0 items-center gap-0.5 rounded bg-background/95 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          title="Move earlier in the chain"
          disabled={!onMoveUp}
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-25"
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp?.();
          }}
        >
          <CaretUp className="size-3.5" />
        </button>
        <button
          title="Move later in the chain"
          disabled={!onMoveDown}
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-25"
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown?.();
          }}
        >
          <CaretDown className="size-3.5" />
        </button>
        <button
          title={`Remove ${displayName}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

/** An endpoint of the chain: the guitar, the amp, or a loop jack. */
function ChainEnd({ label, tone = 'signal' }: { label: string; tone?: 'signal' | 'loop' }) {
  return (
    <div className="relative flex items-center gap-2 py-1.5 pl-8">
      <span
        aria-hidden
        className={`absolute left-[11px] size-2.5 rounded-full ring-2 ring-background ${
          tone === 'signal' ? 'bg-primary' : 'bg-muted-foreground'
        }`}
      />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function SignalChainPanel() {
  const {
    placedPedals, pedalsById, removePedal, amp, useEffectsLoop,
    updatePedalChainPosition, setChainPositionLocked,
  } = useConfigurationStore(
    useShallow((s) => ({
      placedPedals: s.placedPedals,
      pedalsById: s.pedalsById,
      removePedal: s.removePedal,
      amp: s.amp,
      useEffectsLoop: s.useEffectsLoop,
      updatePedalChainPosition: s.updatePedalChainPosition,
      setChainPositionLocked: s.setChainPositionLocked,
    }))
  );
  const { warnings, suggestions } = useDerivedConfiguration((d) => ({
    warnings: d.warnings,
    suggestions: d.suggestions,
  }));
  const { selectedPedalId, selectPedal } = useEditorStore(
    useShallow((s) => ({ selectedPedalId: s.selectedPedalId, selectPedal: s.selectPedal }))
  );

  const sortedPedals = useMemo(
    () => [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition),
    [placedPedals]
  );

  /**
   * Two pedals of the same model are common - this board has two CS-3s - and
   * the old panel rendered both as "CS-3" with nothing to tell them apart. Only
   * the repeated ones get a suffix, so the common case stays clean.
   */
  const displayNames = useMemo(() => {
    const total = new Map<string, number>();
    for (const p of sortedPedals) {
      const name = pedalsById[p.pedalId]?.name ?? p.pedal?.name;
      if (name) total.set(name, (total.get(name) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    const out = new Map<string, string>();
    for (const p of sortedPedals) {
      const name = pedalsById[p.pedalId]?.name ?? p.pedal?.name;
      if (!name) continue;
      if ((total.get(name) ?? 0) > 1) {
        const n = (seen.get(name) ?? 0) + 1;
        seen.set(name, n);
        out.set(p.id, `${name} · ${n}`);
      } else {
        out.set(p.id, name);
      }
    }
    return out;
  }, [sortedPedals, pedalsById]);

  const effectsLoopEnabled = amp?.hasEffectsLoop && useEffectsLoop;
  const frontOfAmpPedals = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location !== 'effects_loop')
    : sortedPedals;
  const effectsLoopPedals = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location === 'effects_loop')
    : [];

  const renderRow = (placed: PlacedPedal, index: number, list: PlacedPedal[]) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return null;
    return (
      <ChainRow
        key={placed.id}
        placed={placed}
        displayName={displayNames.get(placed.id) ?? pedal.name}
        category={getCategoryLabel(pedal.category)}
        categoryColour={getCategoryColor(pedal.category)}
        isSelected={selectedPedalId === placed.id}
        onSelect={() => selectPedal(placed.id)}
        onMoveUp={
          index > 0
            ? () => updatePedalChainPosition(placed.id, list[index - 1].chainPosition)
            : null
        }
        onMoveDown={
          index < list.length - 1
            ? () => updatePedalChainPosition(placed.id, list[index + 1].chainPosition)
            : null
        }
        onRemove={() => removePedal(placed.id)}
        onUnlock={
          placed.chainPositionLocked ? () => setChainPositionLocked(placed.id, false) : null
        }
      />
    );
  };

  /** The spine: one continuous rule behind the nodes, so it reads as a chain. */
  const Spine = ({ children }: { children: React.ReactNode }) => (
    <div className="relative">
      <span aria-hidden className="absolute bottom-3 left-4 top-3 w-px bg-border" />
      {children}
    </div>
  );

  const issueCount = warnings.length + suggestions.length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Signal chain</h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {sortedPedals.length} pedal{sortedPedals.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/*
        ISSUES FIRST. These used to render after every pedal - 1150px down a
        860px panel - which meant the panel's most important output was the
        part you had to hunt for.
      */}
      {issueCount > 0 && (
        <div className="shrink-0 divide-y border-b">
          {warnings.map((warning, index) => (
            <div key={`w${index}`} className="flex items-start gap-2 px-3 py-2">
              <Warning
                className={`mt-0.5 size-3.5 shrink-0 ${
                  warning.severity === 'error' ? 'text-destructive' : 'text-warning'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug">{warning.message}</p>
                {warning.suggestion && (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {warning.suggestion}
                  </p>
                )}
              </div>
            </div>
          ))}
          {suggestions.map((suggestion, index) => (
            <div key={`s${index}`} className="flex items-start gap-2 px-3 py-2">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug">{suggestion.message}</p>
                {suggestion.suggestion && (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {suggestion.suggestion}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">
        {sortedPedals.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Add pedals from the library
          </p>
        ) : (
          <>
            <Spine>
              <ChainEnd label="Guitar" />
              {frontOfAmpPedals.length > 0 ? (
                frontOfAmpPedals.map(renderRow)
              ) : (
                <p className="py-2 pl-8 text-xs text-muted-foreground">No pedals</p>
              )}
              <ChainEnd label={effectsLoopEnabled ? 'Amp input' : 'Amp'} />
            </Spine>

            {effectsLoopEnabled && (
              <Spine>
                <ChainEnd label={amp?.sendJackLabel || 'Send'} tone="loop" />
                {effectsLoopPedals.length > 0 ? (
                  effectsLoopPedals.map(renderRow)
                ) : (
                  <p className="py-2 pl-8 text-xs text-muted-foreground">No pedals in the loop</p>
                )}
                <ChainEnd label={amp?.returnJackLabel || 'Return'} tone="loop" />
              </Spine>
            )}
          </>
        )}
      </div>
    </div>
  );
}
