'use client';

import { PANEL_TITLE } from '@/components/editor/panels/panel-chrome';
import { derivePedalDisplayNames, displayNameFor } from '@/lib/pedal-display-names';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { getCategoryColor, getCategoryShortLabel } from '@/lib/constants/pedal-categories';
import { Lock, CaretUp, CaretDown, X } from '@phosphor-icons/react';
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
 * So: issues first, then the endpoints as filled rows bracketing the list,
 * rows at half the height, and the row controls revealed on hover.
 */

/**
 * One pedal in the chain. 26px tall, against ~28px before and ~52px before that.
 *
 * The spine and its nodes are gone. They were what made a flat list read as a
 * chain, and they are no longer carrying that: the two endpoint rows now
 * bracket the list with a filled ground of their own, which says "the signal
 * enters here and leaves there" in two rows rather than in a rule threaded
 * behind twenty-two.
 *
 * The position number is zero-padded so the column does not shift at ten -
 * `9` and `10` right-aligned still change the ink's left edge, and this column
 * is read as a ruler.
 */
function ChainRow({
  placed,
  displayName,
  shortLabel,
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
  shortLabel: string;
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
      className={`group relative flex cursor-pointer items-center gap-2 border-b border-border/35 px-3 py-1 transition-colors ${
        isSelected ? 'bg-primary/15' : 'hover:bg-muted/60'
      }`}
    >
      <span
        className={`w-[18px] shrink-0 text-right font-mono text-[11px] tabular-nums ${
          isSelected ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        {String(placed.chainPosition).padStart(2, '0')}
      </span>

      {/* The category, as a 3px rule rather than a filled chip. It reads as an
          index mark against the name instead of competing with it. */}
      <span
        aria-hidden
        className="h-3.5 w-[3px] shrink-0 rounded-full"
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
          here. Short form, because at 300px the panel cannot spend 60px on
          "Overdrive" and the reader already knows the vocabulary. It fades
          rather than unmounting, so the row width never moves. */}
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
        {shortLabel}
      </span>

      {/*
        Revealed on hover, and OPACITY rather than `hidden`.

        The first version used `hidden group-hover:flex`, which is display:none
        - so the buttons could not take keyboard focus at all, and reordering
        became mouse-only. Opacity keeps them in the tree and focusable, and
        `group-focus-within` brings them into view when tabbing reaches them.
      */}
      <span className="absolute right-2 flex shrink-0 items-center gap-0.5 rounded-none bg-background/95 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          title="Move earlier in the chain"
          disabled={!onMoveUp}
          className="rounded-none p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-25"
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
          className="rounded-none p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-25"
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown?.();
          }}
        >
          <CaretDown className="size-3.5" />
        </button>
        <button
          title={`Remove ${displayName}`}
          className="rounded-none p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
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

/**
 * An endpoint of the chain: the guitar, the amp, or a loop jack.
 *
 * Given a ground one step between `--background` and `--card` so the two ends
 * of the list are legible as ends without a rule or an icon. Expressed as
 * `bg-card/60` rather than a new token - the design calls for
 * oklch(0.185 0.008 250), which is what --card at 60% over --background
 * resolves to, and the token set is deliberately closed.
 */
function ChainEnd({ label, tone = 'signal' }: { label: string; tone?: 'signal' | 'loop' }) {
  return (
    <div className="flex items-center gap-2 bg-card/60 px-3 py-[7px]">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${
          tone === 'signal' ? 'bg-primary' : 'bg-muted-foreground'
        }`}
      />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
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
  const { warnings, suggestions, cables } = useDerivedConfiguration((d) => ({
    warnings: d.warnings,
    suggestions: d.suggestions,
    cables: d.cables,
  }));
  const { selectedPedalId, selectPedal } = useEditorStore(
    useShallow((s) => ({ selectedPedalId: s.selectedPedalId, selectPedal: s.selectPedal }))
  );

  const sortedPedals = useMemo(
    () => [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition),
    [placedPedals]
  );

  /*
   * Two pedals of the same model are common - this board has two CS-3s - and
   * a bare model name identifies neither. This panel used to work that out
   * for itself; it now asks the engine, so the ordinal it shows is the same
   * ordinal the Cables list shows. See lib/pedal-display-names.
   */
  const displayNames = useMemo(
    () => derivePedalDisplayNames(placedPedals, pedalsById),
    [placedPedals, pedalsById]
  );

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
        displayName={displayNameFor(displayNames, placed.id, pedal.name)}
        shortLabel={getCategoryShortLabel(pedal.category)}
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

  const issueCount = warnings.length + suggestions.length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* The count pair, not a sentence. "15 pedals" spent the whole right
          half of the header restating the word in the title; the cable count
          beside it is the fact the header was missing. */}
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-[9px]">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Signal chain
        </h3>
        <span className="font-mono text-[10px] uppercase tabular-nums tracking-[0.14em] text-muted-foreground">
          {sortedPedals.length} · {cables.length} cables
        </span>
      </div>

      {/*
        ISSUES FIRST. These used to render after every pedal - 1150px down a
        860px panel - which meant the panel's most important output was the
        part you had to hunt for.
      */}
      {issueCount > 0 && (
        <div className="shrink-0 border-b">
          <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
            <h4 className={PANEL_TITLE}>Notices</h4>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {issueCount}
            </span>
          </div>
          <div className="divide-y">
            {warnings.map((warning, index) => (
              <IssueRow
                key={`w${index}`}
                level={warning.severity === 'error' ? 'error' : 'warn'}
                message={warning.message}
                detail={warning.suggestion}
                emphasis
              />
            ))}
            {suggestions.map((suggestion, index) => (
              <IssueRow
                key={`s${index}`}
                level="note"
                message={suggestion.message}
                detail={suggestion.suggestion}
              />
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {sortedPedals.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Add pedals from the library
          </p>
        ) : (
          <>
            <ChainEnd label="Guitar in" />
            {frontOfAmpPedals.length > 0 ? (
              frontOfAmpPedals.map(renderRow)
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">No pedals</p>
            )}
            <ChainEnd label={effectsLoopEnabled ? 'Amp input' : 'Amp'} />

            {effectsLoopEnabled && (
              <>
                <ChainEnd label={amp?.sendJackLabel || 'Send'} tone="loop" />
                {effectsLoopPedals.length > 0 ? (
                  effectsLoopPedals.map(renderRow)
                ) : (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No pedals in the loop</p>
                )}
                <ChainEnd label={amp?.returnJackLabel || 'Return'} tone="loop" />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One notice, as a log record rather than a paragraph.
 *
 * This block used to be an icon beside soft prose - the only prose in a panel
 * whose every other line is a fixed-gutter record ("` 1 | PW-3   Filter/Wah`"),
 * so it read as pasted in from another product. A lightbulb also has to be
 * decoded before it says anything, and it was carrying the ONLY distinction
 * between "your board is wrong" and "here is an idea".
 *
 * The level is now a word in the micro-mono register, in a fixed-width gutter
 * so every message starts on the same column. That is what makes a list of
 * notices read as a log: the left edge, not the ornament.
 */
function IssueRow({
  level,
  message,
  detail,
  emphasis = false,
}: {
  level: 'error' | 'warn' | 'note';
  message: string;
  detail?: string;
  emphasis?: boolean;
}) {
  const tone =
    level === 'error' ? 'text-destructive' : level === 'warn' ? 'text-warning' : 'text-muted-foreground';

  return (
    <div className="flex items-baseline gap-2 px-3 py-2">
      <span
        className={`w-9 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-widest ${tone}`}
      >
        {level}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs leading-snug ${emphasis ? 'font-medium' : ''}`}>{message}</p>
        {/* The engine's own wording, unchanged. What a rig feature MEANS is
            the owner's call, so this rewrites the presentation and not a
            single word of the copy. */}
        {detail && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}
