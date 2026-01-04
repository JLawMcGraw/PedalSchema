'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BoardSelector } from '@/components/boards/board-selector';
import type { Board } from '@/types';
import { useEffect } from 'react';

export default function NewConfigurationPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch boards
  useEffect(() => {
    async function fetchBoards() {
      const supabase = createClient();
      const { data } = await supabase
        .from('boards')
        .select(`
          *,
          rails:board_rails(*)
        `)
        .order('manufacturer')
        .order('name');

      if (data) {
        // Transform to match our types
        const transformedBoards: Board[] = data.map((b) => ({
          id: b.id,
          name: b.name,
          manufacturer: b.manufacturer,
          widthInches: Number(b.width_inches),
          depthInches: Number(b.depth_inches),
          railWidthInches: Number(b.rail_width_inches),
          clearanceUnderInches: b.clearance_under_inches ? Number(b.clearance_under_inches) : null,
          isSystem: b.is_system,
          createdBy: b.created_by,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
          imageUrl: b.image_url,
          rails: (b.rails || []).map((r: { id: string; board_id: string; position_from_back_inches: number; sort_order: number }) => ({
            id: r.id,
            boardId: r.board_id,
            positionFromBackInches: Number(r.position_from_back_inches),
            sortOrder: r.sort_order,
          })),
        }));
        setBoards(transformedBoards);
      }
    }

    fetchBoards();
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !selectedBoard) {
      setError('Please enter a name and select a board');
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError('You must be logged in');
      setLoading(false);
      return;
    }

    const { data, error: createError } = await supabase
      .from('configurations')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        board_id: selectedBoard.id,
        user_id: user.id,
      })
      .select()
      .single();

    if (createError) {
      setError(createError.message);
      setLoading(false);
      return;
    }

    router.push(`/editor/${data.id}`);
  };

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">New Pedalboard</h1>
        <p className="text-muted-foreground">Create a new pedalboard configuration</p>
      </div>

      <div className="space-y-6">
        {error && (
          <div className="p-3 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="My Pedalboard"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            placeholder="Describe your setup..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Select a Board</Label>
          {boards.length > 0 ? (
            <BoardSelector
              boards={boards}
              selectedBoardId={selectedBoard?.id}
              onSelect={setSelectedBoard}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Loading boards...
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex gap-4 pt-4">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading || !name.trim() || !selectedBoard}>
            {loading ? 'Creating...' : 'Create Pedalboard'}
          </Button>
        </div>
      </div>
    </div>
  );
}
