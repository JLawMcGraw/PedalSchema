import type { SupabaseClient } from '@supabase/supabase-js';
import { getCatalogue, transformPedal } from '@/lib/catalogue';
import type { Board, Pedal, Amp, PlacedPedal, RoutingConfig, PowerSupply } from '@/types';

/**
 * Loading one saved configuration, in the shape the editor stores want.
 *
 * This lives here rather than in the editor route because there are now TWO
 * ways in - `/editor/[id]` for the owner and `/s/[slug]` for a public viewer -
 * and they must produce byte-identical state. Two copies of a 150-line
 * row-to-type transform is how a shared board starts rendering subtly
 * differently from the board its owner sees; this codebase has already paid
 * for one duplicated mapping (pedal-card's category tables).
 *
 * The lookup is the ONLY difference between the two callers. RLS does the
 * rest: `Public configurations are viewable` covers a public row and the
 * configuration_pedals / configuration_cables policies follow it, so an
 * anonymous request returns a whole board or nothing at all.
 */

export interface LoadedConfiguration {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  shareSlug: string | null;
  board: Board;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  routingConfig?: Partial<RoutingConfig>;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  availablePedals: Pedal[];
  availableAmps: Amp[];
  powerSupplies: PowerSupply[];
  powerSupply: PowerSupply | null;
}

/** Which board to load. Exactly one of these. */
export type ConfigurationKey = { id: string } | { shareSlug: string };

const CONFIG_SELECT = `
      *,
      boards!inner (
        *,
        rails:board_rails(*)
      ),
      amps (*),
      configuration_pedals (
        *,
        pedals (
          *,
          jacks:pedal_jacks(*)
        )
      )
    `;

/**
 * Load a configuration, or null when it does not exist or the caller may not
 * see it - RLS makes those the same answer, and so does this.
 *
 * `includeLibrary` is false for a read-only viewer: the pedal library and the
 * amp list are for the editor's panels, and fetching all 67 pedals plus every
 * amp to render someone else's board is work nobody asked for.
 */
export async function loadConfiguration(
  supabase: SupabaseClient,
  key: ConfigurationKey,
  { includeLibrary = true }: { includeLibrary?: boolean } = {}
): Promise<LoadedConfiguration | null> {
  let query = supabase.from('configurations').select(CONFIG_SELECT);
  query = 'id' in key
    ? query.eq('id', key.id)
    /*
     * Slug AND is_public. The second half looks redundant and is not, and
     * which half does the work depends on WHO is asking:
     *
     *   a stranger   refused by RLS itself - "Public configurations are
     *                viewable" is the only policy that can match them, and it
     *                requires is_public. Measured: dropping this .eq still
     *                404s a private board for a logged-out visitor.
     *   the OWNER    let straight through by "Users can view their own
     *                configurations", which has no is_public condition. So
     *                without this .eq, the person who just unpublished would
     *                load their own share page perfectly and conclude the
     *                link still worked for everyone else.
     *
     * That is the wrong direction for a sharing mistake to point, so the
     * condition stays and verify-sharing asserts the owner case.
     */
    : query.eq('share_slug', key.shareSlug).eq('is_public', true);

  const { data: config, error } = await query
    // A PostgREST embed has no inherent order, and Postgres may hand back an
    // UPDATED row in a new place - so without this the pedals arrive in an
    // order that changes when the board is saved. The chain comparator now
    // breaks ties on chainPosition and cannot be swayed by array order, but
    // the array order should not be arbitrary in the first place: anything
    // else reading `placedPedals` positionally gets a stable list too.
    .order('chain_position', { referencedTable: 'configuration_pedals' })
    .maybeSingle();

  if (error || !config) return null;

  /*
   * The catalogue - every pedal, amp and supply on offer - comes from
   * `lib/catalogue`, which serves the shipped rows from a cross-request cache.
   * It used to be three queries issued here on every single editor open, and
   * the pedal one alone pulls 67 rows with their jacks. See the note in that
   * module: this is the read that put the project past its egress quota.
   *
   * The user id decides only whether a SECOND, small query runs for gear the
   * caller added themselves. `getUser` rather than `getSession` because the
   * session is unverified cookie data, and this picks which rows to attach to
   * someone's board.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const catalogue = await getCatalogue(supabase, user?.id ?? null);
  const { powerSupplies } = catalogue;

  const powerSupply =
    powerSupplies.find((s2) => s2.id === (config.power_supply_id as string | null)) ?? null;

  // A read-only viewer gets no library: the panels that offer it are the
  // editor's, and shipping 67 pedals to draw someone else's board is work
  // nobody asked for. Unchanged behaviour - the arrays were empty here before.
  const availablePedals: Pedal[] = includeLibrary ? catalogue.availablePedals : [];
  const availableAmps: Amp[] = includeLibrary ? catalogue.availableAmps : [];

  // Transform data to match our types
  const board: Board = {
    id: config.boards.id,
    name: config.boards.name,
    manufacturer: config.boards.manufacturer,
    widthInches: Number(config.boards.width_inches),
    depthInches: Number(config.boards.depth_inches),
    railWidthInches: Number(config.boards.rail_width_inches),
    clearanceUnderInches: config.boards.clearance_under_inches
      ? Number(config.boards.clearance_under_inches)
      : null,
    isSystem: config.boards.is_system,
    createdBy: config.boards.created_by,
    createdAt: config.boards.created_at,
    updatedAt: config.boards.updated_at,
    imageUrl: config.boards.image_url,
    rails: (config.boards.rails || []).map((r: { id: string; board_id: string; position_from_back_inches: number; sort_order: number }) => ({
      id: r.id,
      boardId: r.board_id,
      positionFromBackInches: Number(r.position_from_back_inches),
      sortOrder: r.sort_order,
    })),
  };

  const amp: Amp | null = config.amps
    ? {
        id: config.amps.id,
        name: config.amps.name,
        manufacturer: config.amps.manufacturer,
        hasEffectsLoop: config.amps.has_effects_loop,
        loopType: config.amps.loop_type,
        loopLevel: config.amps.loop_level,
        sendJackLabel: config.amps.send_jack_label,
        returnJackLabel: config.amps.return_jack_label,
        isSystem: config.amps.is_system,
        createdBy: config.amps.created_by,
        createdAt: config.amps.created_at,
        notes: config.amps.notes,
      }
    : null;

  const placedPedals: PlacedPedal[] = (config.configuration_pedals || []).map(
    (cp: Record<string, unknown>) => ({
      id: cp.id as string,
      configurationId: cp.configuration_id as string,
      pedalId: cp.pedal_id as string,
      xInches: Number(cp.x_inches),
      yInches: Number(cp.y_inches),
      rotationDegrees: cp.rotation_degrees as number,
      chainPosition: cp.chain_position as number,
      location: cp.location as PlacedPedal['location'],
      chainPositionLocked: (cp.chain_position_locked as boolean) ?? false,
      rotationLocked: (cp.rotation_locked as boolean) ?? false,
      powerOutputId: (cp.power_output_id as string | null) ?? null,
      isActive: cp.is_active as boolean,
      useLoop: (cp.use_loop as boolean) ?? false, // Default to false for backwards compat
      createdAt: cp.created_at as string,
      pedal: cp.pedals ? transformPedal(cp.pedals as Record<string, unknown>) : undefined,
    })
  );

  const pedalsById: Record<string, Pedal> = {};
  for (const placed of placedPedals) {
    if (placed.pedal) {
      pedalsById[placed.pedalId] = placed.pedal;
    }
  }

  return {
    id: config.id as string,
    name: config.name as string,
    description: (config.description as string | null) || '',
    isPublic: (config.is_public as boolean) ?? false,
    shareSlug: (config.share_slug as string | null) ?? null,
    board,
    amp,
    useEffectsLoop: config.use_effects_loop as boolean,
    use4CableMethod: config.use_4_cable_method as boolean,
    modulationInLoop: (config.modulation_in_loop as boolean) ?? false,
    routingConfig: (config.routing_config as Partial<RoutingConfig>) ?? undefined,
    placedPedals,
    pedalsById,
    availablePedals,
    availableAmps,
    powerSupplies,
    powerSupply,
  };
}
