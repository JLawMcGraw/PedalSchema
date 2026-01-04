'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { getCategoryColor, getCategoryLabel, PEDAL_CATEGORIES } from '@/lib/constants/pedal-categories';
import type { Pedal } from '@/types';

interface PedalLibraryPanelProps {
  pedals: Pedal[];
}

export function PedalLibraryPanel({ pedals }: PedalLibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const { pedalToAdd, setPedalToAdd } = useEditorStore();
  const { board, placedPedals } = useConfigurationStore();

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
        <h3 className="font-semibold">Add Pedal</h3>
        <Input
          placeholder="Search pedals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8"
        />
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {availableCategories.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  {cat.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pedalToAdd && (
        <div className="p-2 bg-primary/10 border-b text-sm text-center shrink-0">
          Click on the board to place
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {filteredPedals.map((pedal) => {
            const isSelected = pedalToAdd === pedal.id;
            const isOnBoard = placedPedals.some((p) => p.pedalId === pedal.id);

            return (
              <button
                key={pedal.id}
                onClick={() => handlePedalClick(pedal)}
                className={`w-full text-left p-2 rounded-md text-sm transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate text-xs">{pedal.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {pedal.manufacturer} · {pedal.widthInches}&quot;×{pedal.depthInches}&quot;
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOnBoard && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        Added
                      </Badge>
                    )}
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCategoryColor(pedal.category) }}
                      title={getCategoryLabel(pedal.category)}
                    />
                  </div>
                </div>
              </button>
            );
          })}

          {filteredPedals.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-4">
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
