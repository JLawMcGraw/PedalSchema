import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BoardCard } from './board-card';
import { resolvePage, DASHBOARD_PAGE_SIZE } from '@/lib/pagination';
import { detectCollisions } from '@/lib/engine/collision';
import { derivePowerPlan } from '@/lib/engine/power';
import type { Board, PedalCategory, Pedal, PlacedPedal, PowerSupply } from '@/types';

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
      is_public,
      share_slug,
      power_supply_id,
      boards (
        name, manufacturer, width_inches, depth_inches, rail_width_inches,
        board_rails (position_from_back_inches)
      ),
      power_supplies (
        id, name, manufacturer, is_isolated,
        power_supply_outputs (id, label, voltage, rated_ma, alternate_modes, is_ac, sort_order)
      ),
      configuration_pedals (
        id,
        x_inches,
        y_inches,
        rotation_degrees,
        power_output_id,
        pedal_id,
        pedals (id, name, width_inches, depth_inches, category, current_ma, voltage)
      )
    `)
    .eq('user_id', user?.id)
    .order('updated_at', { ascending: false })
    .range(pageWindow.from, pageWindow.to);

  /*
   * ONE SCALE FOR EVERY THUMBNAIL ON THE PAGE.
   *
   * Each card used to fit its own board to the same 96px band, so the drawing
   * carried no size information - measured on the real dashboard, 7.68 px/inch
   * for an 18x12.5in Classic Jr against 6.00 for a 32x16in Classic Pro. The
   * SMALLER board was drawn 28% too big relative to the larger one, which is
   * worse than carrying no size at all.
   *
   * The frame is the largest board in THIS PAGE of results. That is a
   * deliberate limit: the query is paginated, so a board on page 2 cannot
   * influence page 1, and the alternative - a fixed frame sized to the biggest
   * board in the catalogue - would shrink every real board to fit a Classic
   * Pro XL nobody owns.
   */
  const frame = (configurations ?? []).reduce(
    (max, config) => {
      const b = config.boards as unknown as {
        width_inches: number | null;
        depth_inches: number | null;
      } | null;
      return {
        width: Math.max(max.width, Number(b?.width_inches ?? 0)),
        depth: Math.max(max.depth, Number(b?.depth_inches ?? 0)),
      };
    },
    { width: 0, depth: 0 }
  );

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
              rail_width_inches: number | null;
              board_rails: Array<{ position_from_back_inches: number }> | null;
            } | null;
            const rows = (config.configuration_pedals ?? []) as unknown as Array<{
              id: string;
              x_inches: number;
              y_inches: number;
              rotation_degrees: number | null;
              power_output_id: string | null;
              pedal_id: string;
              pedals: {
                id: string;
                name: string;
                width_inches: number;
                depth_inches: number;
                category: PedalCategory;
                current_ma: number | null;
                voltage: number | null;
              } | null;
            }>;
            const placed = rows.filter((r) => r.pedals);

            /*
             * THE FAULTS, computed here on the server.
             *
             * Both are pure functions over data this query already fetches, so
             * a status marker costs no extra round trip. Unrouted cables are
             * DELIBERATELY not among them: that needs the full router per
             * board, which is a lot of work to render a list page, and it is a
             * fault you see the moment you open the board.
             */
            const boardForFit = {
              widthInches: Number(board?.width_inches ?? 0),
              depthInches: Number(board?.depth_inches ?? 0),
            } as Board;
            const placedForFit = placed.map((r) => ({
              id: r.id,
              pedalId: r.pedal_id,
              xInches: Number(r.x_inches),
              yInches: Number(r.y_inches),
              rotationDegrees: Number(r.rotation_degrees ?? 0),
              powerOutputId: r.power_output_id,
            })) as unknown as PlacedPedal[];
            const pedalsForFit = Object.fromEntries(
              placed.map((r) => [
                r.pedal_id,
                {
                  id: r.pedals!.id,
                  name: r.pedals!.name,
                  widthInches: Number(r.pedals!.width_inches),
                  depthInches: Number(r.pedals!.depth_inches),
                  currentMa: r.pedals!.current_ma,
                  voltage: r.pedals!.voltage,
                } as unknown as Pedal,
              ])
            );
            const collisions =
              boardForFit.widthInches > 0
                ? detectCollisions(placedForFit, pedalsForFit, boardForFit)
                : [];

            const supplyRow = config.power_supplies as unknown as {
              id: string; name: string; manufacturer: string; is_isolated: boolean;
              power_supply_outputs: Array<{
                id: string; label: string; voltage: number; rated_ma: number;
                alternate_modes: Array<{ voltage: number; ratedMa: number }> | null;
                is_ac: boolean | null; sort_order: number;
              }>;
            } | null;
            /*
             * Reported as a FAULT, never as a ratio. "1586 of 2000mA" reads as
             * reassurance, and engine/power exists because that reassurance is
             * false: a 500mA board on a 2000mA supply still fails if six pedals
             * share one 100mA output. So the card says something only when an
             * OUTPUT is over, which is where supplies actually fail.
             */
            const plan = supplyRow
              ? derivePowerPlan(placedForFit, pedalsForFit, {
                  id: supplyRow.id,
                  name: supplyRow.name,
                  manufacturer: supplyRow.manufacturer,
                  isIsolated: supplyRow.is_isolated,
                  outputs: (supplyRow.power_supply_outputs ?? [])
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((o) => ({
                      id: o.id,
                      label: o.label,
                      voltage: o.voltage,
                      ratedMa: o.rated_ma,
                      alternateModes: o.alternate_modes ?? [],
                      isAc: o.is_ac ?? false,
                      sortOrder: o.sort_order,
                    })),
                } as unknown as PowerSupply)
              : null;
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
                frameWidthInches={frame.width}
                frameDepthInches={frame.depth}
                railWidthInches={Number(board?.rail_width_inches ?? 0)}
                railPositionsFromBack={(board?.board_rails ?? []).map((r) =>
                  Number(r.position_from_back_inches)
                )}
                // A null draw is UNKNOWN, not zero - summing it as zero would
                // report a board as lighter on power than it is. The count of
                // unknowns rides along so the card can say so.
                knownDrawMa={placed.reduce(
                  (sum, r) => sum + (r.pedals!.current_ma ?? 0),
                  0
                )}
                unknownDrawCount={placed.filter((r) => r.pedals!.current_ma == null).length}
                overlapCount={collisions.filter((c) => c.severity !== 'off-board').length}
                offBoardCount={collisions.filter((c) => c.severity === 'off-board').length}
                outputsOverCount={plan?.overCapacityCount ?? 0}
                isPublic={Boolean(config.is_public && config.share_slug)}
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
