import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BoardCard } from './board-card';
import { resolvePage, DASHBOARD_PAGE_SIZE } from '@/lib/pagination';
import type { PedalCategory } from '@/types';

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
    // The placed pedals come back too, so each card can DRAW the board rather
    // than describe it. Only the five fields a thumbnail and a stat line need
    // - not the whole pedal row, and no jacks.
    .select(`
      id,
      name,
      description,
      created_at,
      updated_at,
      boards (name, manufacturer, width_inches, depth_inches),
      configuration_pedals (
        x_inches,
        y_inches,
        rotation_degrees,
        pedals (width_inches, depth_inches, category, current_ma)
      )
    `)
    .eq('user_id', user?.id)
    .order('updated_at', { ascending: false })
    .range(pageWindow.from, pageWindow.to);

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          {/* "Design and manage your pedalboard configurations" said nothing
              the heading had not already said. The count is what a person
              actually wants at the top of a list. */}
          <h1 className="text-3xl font-bold tracking-tight">My pedalboards</h1>
          <p className="text-sm text-muted-foreground">
            {count ?? 0} board{count === 1 ? '' : 's'}
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
            const board = config.boards as unknown as {
              name: string;
              manufacturer: string | null;
              width_inches: number | null;
              depth_inches: number | null;
            } | null;
            const rows = (config.configuration_pedals ?? []) as unknown as Array<{
              x_inches: number;
              y_inches: number;
              rotation_degrees: number | null;
              pedals: {
                width_inches: number;
                depth_inches: number;
                category: PedalCategory;
                current_ma: number | null;
              } | null;
            }>;
            const placed = rows.filter((r) => r.pedals);
            return (
              <BoardCard
                key={config.id}
                id={config.id}
                name={config.name}
                description={config.description}
                updatedAt={config.updated_at}
                boardLabel={[board?.manufacturer, board?.name].filter(Boolean).join(' ')}
                widthInches={Number(board?.width_inches ?? 0)}
                depthInches={Number(board?.depth_inches ?? 0)}
                // A null draw is UNKNOWN, not zero - summing it as zero would
                // report a board as lighter on power than it is. The count of
                // unknowns rides along so the card can say so.
                knownDrawMa={placed.reduce(
                  (sum, r) => sum + (r.pedals!.current_ma ?? 0),
                  0
                )}
                unknownDrawCount={placed.filter((r) => r.pedals!.current_ma == null).length}
                pedals={placed.map((r) => ({
                  xInches: Number(r.x_inches),
                  yInches: Number(r.y_inches),
                  widthInches: Number(r.pedals!.width_inches),
                  depthInches: Number(r.pedals!.depth_inches),
                  rotation: Number(r.rotation_degrees ?? 0),
                  category: r.pedals!.category,
                }))}
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
