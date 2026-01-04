import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function BoardsPage() {
  const supabase = await createClient();

  // Fetch boards (system + user's custom)
  const { data: boards } = await supabase
    .from('boards')
    .select(`
      *,
      rails:board_rails(*)
    `)
    .order('manufacturer')
    .order('name');

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pedalboard Library</h1>
          <p className="text-muted-foreground">
            Select or create a pedalboard to design
          </p>
        </div>
        <Button>Add Custom Board</Button>
      </div>

      {boards && boards.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <Card key={board.id} className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="text-lg">{board.name}</CardTitle>
                <CardDescription>{board.manufacturer}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    {board.width_inches}&quot; × {board.depth_inches}&quot;
                  </p>
                  <p>
                    {(board.rails as unknown[])?.length || 0} rails
                  </p>
                  {board.clearance_under_inches && (
                    <p>{board.clearance_under_inches}&quot; clearance</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">No boards found</h3>
            <p className="text-muted-foreground text-center mb-4">
              Run the database seed to populate the board library
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
