import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user's configurations
  const { data: configurations } = await supabase
    .from('configurations')
    .select(`
      id,
      name,
      description,
      created_at,
      updated_at,
      boards (name, manufacturer)
    `)
    .eq('user_id', user?.id)
    .order('updated_at', { ascending: false })
    .limit(10);

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Pedalboards</h1>
          <p className="text-muted-foreground">
            Design and manage your pedalboard configurations
          </p>
        </div>
        <Link href="/editor/new">
          <Button>New Board</Button>
        </Link>
      </div>

      {configurations && configurations.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {configurations.map((config) => {
            const board = config.boards as unknown as { name: string; manufacturer: string | null } | null;
            return (
            <Link key={config.id} href={`/editor/${config.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-lg">{config.name}</CardTitle>
                  <CardDescription>
                    {board?.manufacturer && `${board.manufacturer} `}
                    {board?.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {config.description || 'No description'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Updated {new Date(config.updated_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">No pedalboards yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first pedalboard configuration to get started
            </p>
            <Link href="/editor/new">
              <Button>Create your first board</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
