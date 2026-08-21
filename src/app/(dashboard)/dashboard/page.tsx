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

/** One field of the rig strip: micro label, data leading. */
function RigField({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-sm tabular-nums">
        {value}
        {unit && <span className="text-muted-foreground">{unit}</span>}
        {hint && <span className="ml-2 font-sans text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
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
  /*
   * The ids AND the count, from one request.
   *
   * This was `head: true`, which returns the count and no rows - and then the
   * rig query below re-derived ownership with a `configurations!inner(user_id)`
   * join, embedding the same uuid in every placement row it returned. Asking
   * for the ids here costs one uuid per BOARD and lets that query filter on
   * `configuration_id` directly, which costs nothing per PEDAL.
   */
  const { data: ownedConfigRows, count } = await supabase
    .from('configurations')
    .select('id', { count: 'exact' })
    .eq('user_id', user?.id);

  const ownedConfigIds = (ownedConfigRows ?? []).map((r) => r.id as string);
  const pageWindow = resolvePage(rawPage, count ?? 0, DASHBOARD_PAGE_SIZE);

  /*
   * WHAT YOU OWN, across every board - not just this page of them.
   *
   * Its own query on purpose. The card list is paginated, so summing the page
   * would silently report a fraction of the rig as the whole of it, and it
   * would keep changing as you paged. This asks for every placed pedal the
   * user has, and nothing else.
   *
   * HOW MANY OF EACH YOU OWN, inferred as the MOST that model appears on any
   * ONE board. Neither simpler rule is right:
   *
   *   count every placement  - a DS-1 on two boards is one pedal you own,
   *                            moved between them, and this counts two.
   *   count distinct models  - the two CS-3s on `test` are two real pedals
   *                            sharing one catalogue id, and this counts one.
   *
   * The most a model appears on a single board is the fewest you must own to
   * build that board, and boards are built from the same shelf. It is still an
   * inference - someone with two identical rigs owns two of everything - but
   * it is the one that is right about both cases above.
   */
  const [{ data: ownedRows }, { data: configurations, error: loadError }] = await Promise.all([
    // An account with no boards has no placements either, so the round trip is
    // skipped outright rather than sent with an empty `in` list.
    ownedConfigIds.length
      ? supabase
          .from('configuration_pedals')
          .select('pedal_id, configuration_id, pedals (current_ma)')
          .in('configuration_id', ownedConfigIds)
      : Promise.resolve({ data: [] }),
    supabase
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
      .range(pageWindow.from, pageWindow.to),
  ]);

  const perBoard = new Map<string, Map<string, number>>();
  const drawOf = new Map<string, number | null>();
  for (const row of (ownedRows ?? []) as unknown as Array<{
    pedal_id: string;
    configuration_id: string;
    pedals: { current_ma: number | null } | null;
  }>) {
    if (!drawOf.has(row.pedal_id)) drawOf.set(row.pedal_id, row.pedals?.current_ma ?? null);
    const board = perBoard.get(row.configuration_id) ?? new Map<string, number>();
    board.set(row.pedal_id, (board.get(row.pedal_id) ?? 0) + 1);
    perBoard.set(row.configuration_id, board);
  }
  const ownedCount = new Map<string, number>();
  for (const board of perBoard.values()) {
    for (const [pedalId, n] of board) {
      ownedCount.set(pedalId, Math.max(ownedCount.get(pedalId) ?? 0, n));
    }
  }
  const rig = {
    boards: count ?? 0,
    pedals: [...ownedCount.values()].reduce((sum, n) => sum + n, 0),
    knownDrawMa: [...ownedCount.entries()].reduce(
      (sum, [pedalId, n]) => sum + (drawOf.get(pedalId) ?? 0) * n,
      0
    ),
    unknownCount: [...ownedCount.entries()]
      .filter(([pedalId]) => drawOf.get(pedalId) == null)
      .reduce((sum, [, n]) => sum + n, 0),
  };

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
        </div>
        <Link href="/editor/new">
          <Button>New Board</Button>
        </Link>
      </div>

      {/*
        THE RIG, in the register the editor toolbar uses for the same job.

        The subtitle used to be "2 boards", which the cards below already say
        by existing. This answers a question the app could always answer and
        never did: what do you actually own. It reads across EVERY board, not
        the page of them shown underneath.
      */}
      {rig.boards > 0 && (
        <dl className="mb-8 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-3">
          <RigField label="Boards" value={String(rig.boards)} />
          <RigField label="Pedals" value={String(rig.pedals)} />
          {/* An unrecorded draw is not a draw of zero - engine/power's rule,
              and the same "at least" the Power panel and the editor readout
              show. A bare total here would report the shelf as lighter on
              power than it is. */}
          <RigField
            label="Draw"
            value={`${rig.unknownCount > 0 ? '≥' : ''}${rig.knownDrawMa}`}
            unit="mA"
            hint={
              rig.unknownCount > 0
                ? `${rig.unknownCount} with no recorded draw`
                : undefined
            }
          />
        </dl>
      )}

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
      ) : loadError ? (
        /*
         * A FAILED QUERY IS NOT AN EMPTY ACCOUNT, and this page could not tell
         * them apart.
         *
         * PostgREST fails the WHOLE select when one column is wrong, so
         * `configurations` comes back null and every board vanishes behind
         * "No pedalboards yet" - with nothing anywhere saying a request had
         * failed. It happened on 2026-08-20: a select still asked for
         * `alternate_voltages` after a migration renamed it, and three real
         * boards rendered as an empty account. It cost a debugging cycle here;
         * it would cost a user their entire list with no explanation, and the
         * obvious reading of that screen is "my data is gone".
         */
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="mb-2 text-lg font-semibold text-destructive">
              Your boards could not be loaded
            </h3>
            <p className="mb-1 text-center text-muted-foreground">
              Nothing has been lost - this page could not read them.
            </p>
            <p className="mb-4 max-w-md text-center font-mono text-xs text-muted-foreground">
              {loadError.message}
            </p>
            <Link href="/dashboard">
              <Button variant="outline">Try again</Button>
            </Link>
          </CardContent>
        </Card>
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
