'use client';

import { useShallow } from 'zustand/react/shallow';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import {
  getCategoryColor,
  getCategoryLabel,
  getFamilyColor,
  PEDAL_CATEGORIES,
} from '@/lib/constants/pedal-categories';
import { groupPedalsByCategory, groupStartsOpen } from '@/lib/pedal-grouping';
import { CaretRight } from '@phosphor-icons/react';
import type { Pedal } from '@/types';

interface PedalLibraryPanelProps {
  pedals: Pedal[];
}

export function PedalLibraryPanel({ pedals }: PedalLibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const { pedalToAdd, setPedalToAdd } = useEditorStore(
    useShallow((s) => ({ pedalToAdd: s.pedalToAdd, setPedalToAdd: s.setPedalToAdd }))
  );
  const { board, placedPedals } = useConfigurationStore(
    useShallow((s) => ({ board: s.board, placedPedals: s.placedPedals }))
  );

  // Get categories that have pedals
  const availableCategories = useMemo(() => {
    const categories = new Set(pedals.map((p) => p.category));
    return PEDAL_CATEGORIES.filter((c) => categories.has(c.value)).sort(
      (a, b) => a.defaultOrder - b.defaultOrder
    );
  }, [pedals]);

  const filteredPedals = useMemo(() => {
    return pedals.filter((p) => {
      const matchesSearch =
        search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.manufacturer.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        selectedCategory === 'all' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [pedals, search, selectedCategory]);

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
  const defaultOpen = (count: number) => groupStartsOpen(search !== '', selectedCategory, count);
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
        <h3 className="font-semibold text-sm">Add Pedal</h3>
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
        <Select
          value={selectedCategory}
          onValueChange={(value) => {
            setSelectedCategory(value);
            setOpenOverrides({});
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {availableCategories.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: getFamilyColor(cat.family) }}
                  />
                  {cat.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                <summary className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer list-none hover:bg-muted transition-colors duration-200 [&::-webkit-details-marker]:hidden">
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
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="text-xs font-medium truncate flex-1">{group.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
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

      <div className="p-2 border-t text-xs text-muted-foreground text-center shrink-0">
        {filteredPedals.length} pedal{filteredPedals.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
