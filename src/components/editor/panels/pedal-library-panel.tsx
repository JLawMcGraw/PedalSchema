'use client';

import { PANEL_TITLE } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import {
  getCategoryColor,
  getCategoryLabel,
} from '@/lib/constants/pedal-categories';
import { groupPedalsByCategory, groupStartsOpen } from '@/lib/pedal-grouping';
import { CaretRight } from '@phosphor-icons/react';
import type { Pedal } from '@/types';

interface PedalLibraryPanelProps {
  pedals: Pedal[];
}

export function PedalLibraryPanel({ pedals }: PedalLibraryPanelProps) {
  const [search, setSearch] = useState('');
  const { pedalToAdd, setPedalToAdd } = useEditorStore(
    useShallow((s) => ({ pedalToAdd: s.pedalToAdd, setPedalToAdd: s.setPedalToAdd }))
  );
  const { board, placedPedals } = useConfigurationStore(
    useShallow((s) => ({ board: s.board, placedPedals: s.placedPedals }))
  );

  const filteredPedals = useMemo(() => {
    return pedals.filter((p) => {
      const matchesSearch =
        search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.manufacturer.toLowerCase().includes(search.toLowerCase());
      return matchesSearch;
    });
  }, [pedals, search]);

  const groups = useMemo(() => groupPedalsByCategory(filteredPedals), [filteredPedals]);

  /*
   * Which sections are open.
   *
   * `openOverrides` holds only what the USER has changed, keyed by category;
   * everything else falls back to groupStartsOpen. Storing the overrides
   * rather than the full open-set is what lets a search open the matches
   * without erasing a section the user deliberately shut - and what stops a
   * cleared search from leaving every section hanging open.
   */
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
    // 'all', always: the category dropdown is gone. The grouped list below IS
  // the category filter, and having both meant two controls for one job with
  // the select duplicating what the sections already show. groupStartsOpen
  // keeps its parameter because it is unit-tested against it.
  const defaultOpen = (count: number) => groupStartsOpen(search !== '', 'all', count);
  const isOpen = (category: string, count: number) =>
    openOverrides[category] ?? defaultOpen(count);

  const handlePedalClick = (pedal: Pedal) => {
    if (!board) return;

    // Store pedal in cache and set as pedal to add
    useConfigurationStore.setState((state) => ({
      pedalsById: { ...state.pedalsById, [pedal.id]: pedal },
    }));
    setPedalToAdd(pedal.id);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b space-y-2 shrink-0">
        {/* The count belongs BESIDE the title, not pinned to the floor.
            The chain panel already says "SIGNAL CHAIN ... 22 pedals" in its
            header; the library said "67 pedals" in a footer, which is the
            same fact in a different place. It also pinned a floor 195px below
            where the list actually ended, which is what made the empty tail
            read as a void rather than as room. */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={PANEL_TITLE}>Add pedal</h3>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {filteredPedals.length}
          </span>
        </div>
        <Input
          placeholder="Search pedals..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Drop the per-section overrides whenever the filter changes.
            // Without this a section the user had collapsed stays collapsed
            // through a search that matches it - which is the wall of shut
            // headers this design exists to avoid, just harder to reproduce.
            setOpenOverrides({});
          }}
          className="h-8"
        />
      </div>

      {pedalToAdd && (
        <div className="p-2 bg-primary/10 border-b text-xs text-center shrink-0">
          Click on the board to place
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {groups.map((group) => {
            const open = isOpen(group.category, groups.length);
            return (
              /*
               * A native <details>, not a Collapsible component: the semantics
               * and the keyboard behaviour are already correct and it adds no
               * dependency. `open` is controlled so a search can reveal its
               * matches; onToggle records the user's own choice.
               */
              <details
                key={group.category}
                open={open}
                onToggle={(e) => {
                  // Read `open` BEFORE the updater runs. React nulls
                  // `currentTarget` once the handler returns, so reading it
                  // inside setState throws - and because this renders during
                  // the commit it took the whole panel down with it, search
                  // box and all, on the first click of any section.
                  const isNowOpen = (e.currentTarget as HTMLDetailsElement).open;
                  setOpenOverrides((prev) => ({ ...prev, [group.category]: isNowOpen }));
                }}
              >
                <summary className="flex items-center gap-2 px-2 py-1 cursor-pointer list-none hover:bg-muted transition-colors duration-200 [&::-webkit-details-marker]:hidden">
                  {/* Rotated from the `open` state we already hold rather than a
                      CSS variant, so it cannot depend on variant support.

                      Verify it by reading `rotate`, NOT `transform`: Tailwind
                      v4 compiles rotate-90 to the `rotate` property, so
                      getComputedStyle(...).transform is "none" whichever way
                      the chevron is pointing. Reading the wrong property here
                      produced a confident "NO ROTATION" against code that
                      worked. */}
                  <CaretRight
                    className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      open ? 'rotate-90' : ''
                    }`}
                  />
                  {/* A rule, not a dot - the same mark the chain rows use for
                      the same thing. In chain order the families cluster, so
                      sixteen dots read as four amber circles in a row followed
                      by four blue ones; a 2px rule beside the label says the
                      same thing without pretending to be sixteen categories. */}
                  <span
                    aria-hidden
                    className="h-3.5 w-0.5 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{group.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {group.pedals.length}
                  </span>
                </summary>

                <div className="space-y-1 pt-1 pb-2">
                  {group.pedals.map((pedal) => {
                    const isSelected = pedalToAdd === pedal.id;
                    const isOnBoard = placedPedals.some((p) => p.pedalId === pedal.id);

                    return (
                      <button
                        key={pedal.id}
                        onClick={() => handlePedalClick(pedal)}
                        className={`w-full text-left p-2 rounded-md transition-colors duration-200 overflow-hidden ${
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: getCategoryColor(pedal.category) }}
                            title={getCategoryLabel(pedal.category)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium truncate text-xs">{pedal.name}</span>
                              {isOnBoard && (
                                <span className="text-xs text-muted-foreground shrink-0">✓</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {pedal.manufacturer} · {pedal.widthInches}&quot;×{pedal.depthInches}&quot;
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}

          {filteredPedals.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-4">
              No pedals found
            </div>
          )}
        </div>
      </ScrollArea>

      <OnThisBoard />
    </div>
  );
}

/**
 * What is already on the board, as an index.
 *
 * The rail's tail was 195px of nothing on a 1600x900 viewport - measured, not
 * estimated: the category list ended at y=672 and the pinned footer started at
 * y=867. The sections are collapsed by design (A5) so the space is structural,
 * and it is filled here rather than reclaimed.
 *
 * WHY THIS AND NOT SOMETHING ELSE. The library rows already carry a checkmark
 * for a pedal that is on the board, but with all seventeen sections shut you
 * cannot see a single one of them without opening every section. This is that
 * same fact, reachable. It answers the question you actually have while adding
 * pedals - "did I already put the DD-7 on?" - which is why it is sorted
 * ALPHABETICALLY and not in chain order: it is a lookup index, and chain order
 * is what the Signal chain panel is for.
 *
 * Duplicates collapse to one row with a multiplier. Two bare "CS-3" rows in a
 * list whose job is lookup read as a rendering bug.
 */
function OnThisBoard() {
  const selectPedal = useEditorStore((s) => s.selectPedal);
  const selectedPedalId = useEditorStore((s) => s.selectedPedalId);
  const { placedPedals, pedalsById } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById }))
  );

  const roster = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; firstId: string; ids: string[] }>();
    for (const placed of placedPedals) {
      const name = pedalsById[placed.pedalId]?.name ?? placed.pedal?.name;
      // A placed pedal whose catalogue entry has not loaded yet has no name to
      // index by. Skipping it keeps a transient "undefined" row out of the
      // list; the count below counts rows, so the two cannot disagree.
      if (!name) continue;
      const entry = byName.get(name);
      if (entry) {
        entry.count += 1;
        entry.ids.push(placed.id);
      } else {
        byName.set(name, { name, count: 1, firstId: placed.id, ids: [placed.id] });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [placedPedals, pedalsById]);

  const total = roster.reduce((n, e) => n + e.count, 0);

  return (
    <div className="shrink-0 border-t">
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <h3 className={PANEL_TITLE}>On this board</h3>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{total}</span>
      </div>

      {roster.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">Nothing placed yet.</p>
      ) : (
        /* Capped at 192px, and scrolling inside its own box.
           The cap is arithmetic, not taste. On the reference 1600x900
           viewport the rail below its header is 716px and the seventeen
           collapsed categories need 488, leaving 228 - so a roster taller
           than that starts pushing the category list into a scroll it did
           not previously need. 192 + the 32px header = 224, and the tail is
           filling dead space rather than competing for the live space above
           it. */
        <div className="max-h-48 overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-2 gap-x-2">
            {roster.map((entry) => {
              const isSelected = entry.ids.includes(selectedPedalId ?? '');
              return (
                <button
                  key={entry.name}
                  type="button"
                  /* Selecting from here is the point of it being a list and
                     not a paragraph: it makes the rail navigational. With a
                     duplicate it selects the first, which is the one the
                     chain numbers first. */
                  onClick={() => selectPedal(entry.firstId)}
                  title={entry.count > 1 ? `${entry.name} (${entry.count} on the board)` : entry.name}
                  className={`flex min-w-0 items-baseline gap-1 px-1 py-0.5 text-left transition-colors duration-200 ${
                    isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{entry.name}</span>
                  {entry.count > 1 && (
                    <span
                      className={`shrink-0 font-mono text-[10px] tabular-nums ${
                        isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                      }`}
                    >
                      &times;{entry.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
