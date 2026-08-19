import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BoardCard } from './board-card';
import { resolvePage, DASHBOARD_PAGE_SIZE } from '@/lib/pagination';

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const { page: rawPage } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch the user's configurations, one page at a time.
  //
  // This was `.limit(10)` with no paging at all, which did not read as a bug
  // because the account has three boards - but an eleventh would simply not
  // have existed as far as the UI was concerned. `count: 'exact'` is what
  // makes the page count knowable; head:false so the rows come back too.
  const { count } = await supabase
    .from('configurations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user?.id);

  const pageWindow = resolvePage(rawPage, count ?? 0, DASHBOARD_PAGE_SIZE);

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
    .range(pageWindow.from, pageWindow.to);

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
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {configurations.map((config) => {
            const board = config.boards as unknown as { name: string; manufacturer: string | null } | null;
            return (
              <BoardCard
                key={config.id}
                id={config.id}
                name={config.name}
                description={config.description}
                updatedAt={config.updated_at}
                boardLabel={[board?.manufacturer, board?.name].filter(Boolean).join(' ')}
              />
            );
          })}
          </div>

          {pageWindow.pageCount > 1 && (
            <nav
              className="flex items-center justify-between gap-4 mt-8"
              aria-label="Pagination"
            >
              <p className="text-sm text-muted-foreground tabular-nums">
                Showing {pageWindow.firstShown}&ndash;{pageWindow.lastShown} of{' '}
                {pageWindow.totalItems}
              </p>
              <div className="flex items-center gap-2">
                {/* A disabled anchor is not a thing, so the ends render as
                    disabled buttons rather than links that go nowhere. */}
                {pageWindow.hasPrev ? (
                  <Link href={`/dashboard?page=${pageWindow.page - 1}`}>
                    <Button variant="outline" size="sm">Previous</Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled>Previous</Button>
                )}
                <span className="text-sm text-muted-foreground tabular-nums px-1">
                  {pageWindow.page} / {pageWindow.pageCount}
                </span>
                {pageWindow.hasNext ? (
                  <Link href={`/dashboard?page=${pageWindow.page + 1}`}>
                    <Button variant="outline" size="sm">Next</Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled>Next</Button>
                )}
              </div>
            </nav>
          )}
        </>
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
