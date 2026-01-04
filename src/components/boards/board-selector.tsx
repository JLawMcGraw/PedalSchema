'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Board } from '@/types';

interface BoardSelectorProps {
  boards: Board[];
  selectedBoardId?: string;
  onSelect: (board: Board) => void;
}

export function BoardSelector({ boards, selectedBoardId, onSelect }: BoardSelectorProps) {
  const [search, setSearch] = useState('');

  const filteredBoards = boards.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      (b.manufacturer?.toLowerCase() || '').includes(search.toLowerCase())
  );

  // Group by manufacturer
  const groupedBoards = filteredBoards.reduce((acc, board) => {
    const manufacturer = board.manufacturer || 'Custom';
    if (!acc[manufacturer]) acc[manufacturer] = [];
    acc[manufacturer].push(board);
    return acc;
  }, {} as Record<string, Board[]>);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search boards..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <ScrollArea className="h-[400px]">
        <div className="space-y-6">
          {Object.entries(groupedBoards).map(([manufacturer, manufacturerBoards]) => (
            <div key={manufacturer}>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">{manufacturer}</h4>
              <div className="grid gap-2">
                {manufacturerBoards.map((board) => (
                  <Card
                    key={board.id}
                    className={`cursor-pointer transition-colors ${
                      selectedBoardId === board.id
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() => onSelect(board)}
                  >
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm">{board.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {board.widthInches}&quot; × {board.depthInches}&quot;
                        {board.rails && ` • ${board.rails.length} rails`}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {filteredBoards.length === 0 && (
            <div className="text-center text-muted-foreground py-8">No boards found</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
