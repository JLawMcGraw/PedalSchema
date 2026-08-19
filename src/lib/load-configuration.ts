import type { SupabaseClient } from '@supabase/supabase-js';
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

  // Power supplies, with their outputs. System rows plus the user's own -
  // RLS decides which, so this query does not have to.
  const { data: supplyRows } = await supabase
    .from('power_supplies')
    .select('*, outputs:power_supply_outputs(*)')
    .order('manufacturer');

  const powerSupplies: PowerSupply[] = (supplyRows || []).map(
    (r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      manufacturer: r.manufacturer as string,
      isIsolated: r.is_isolated as boolean,
      isSystem: r.is_system as boolean,
      createdBy: (r.created_by as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      outputs: ((r.outputs as Record<string, unknown>[]) || [])
        .map((o) => ({
          id: o.id as string,
          supplyId: o.supply_id as string,
          label: o.label as string,
          voltage: o.voltage as number,
          ratedMa: o.rated_ma as number,
          alternateModes: (o.alternate_modes as Array<{ voltage: number; ratedMa: number }>) ?? [],
          isAc: (o.is_ac as boolean) ?? false,
          sortOrder: o.sort_order as number,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    })
  );

  const powerSupply =
    powerSupplies.find((s2) => s2.id === (config.power_supply_id as string | null)) ?? null;

  const { data: allPedals } = includeLibrary
    ? await supabase
        .from('pedals')
        .select(`*, jacks:pedal_jacks(*)`)
        .order('manufacturer')
        .order('name')
    : { data: [] };

  const { data: allAmps } = includeLibrary
    ? await supabase.from('amps').select('*').order('manufacturer').order('name')
    : { data: [] };

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

  const transformPedal = (p: Record<string, unknown>): Pedal => ({
    id: p.id as string,
    name: p.name as string,
    manufacturer: p.manufacturer as string,
    category: p.category as Pedal['category'],
    widthInches: Number(p.width_inches),
    depthInches: Number(p.depth_inches),
    heightInches: Number(p.height_inches),
    voltage: p.voltage as number,
    currentMa: p.current_ma as number | null,
    polarity: p.polarity as Pedal['polarity'],
    defaultChainPosition: p.default_chain_position as number | null,
    preferredLocation: p.preferred_location as Pedal['preferredLocation'],
    supports4Cable: p.supports_4_cable as boolean,
    needsBufferBefore: p.needs_buffer_before as boolean,
    needsDirectPickup: p.needs_direct_pickup as boolean,
    isSystem: p.is_system as boolean,
    createdBy: p.created_by as string | null,
    createdAt: p.created_at as string,
    updatedAt: p.updated_at as string,
    imageUrl: p.image_url as string | null,
    notes: p.notes as string | null,
    jacks: ((p.jacks as Record<string, unknown>[]) || []).map((j) => ({
      id: j.id as string,
      pedalId: j.pedal_id as string,
      jackType: j.jack_type as Pedal['jacks'][0]['jackType'],
      side: j.side as Pedal['jacks'][0]['side'],
      positionPercent: j.position_percent as number,
      label: j.label as string | null,
    })),
  });

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

  const availablePedals: Pedal[] = (allPedals || []).map(transformPedal);

  const availableAmps: Amp[] = (allAmps || []).map((a) => ({
    id: a.id,
    name: a.name,
    manufacturer: a.manufacturer,
    hasEffectsLoop: a.has_effects_loop,
    loopType: a.loop_type,
    loopLevel: a.loop_level,
    sendJackLabel: a.send_jack_label,
    returnJackLabel: a.return_jack_label,
    isSystem: a.is_system,
    createdBy: a.created_by,
    createdAt: a.created_at,
    notes: a.notes,
  }));


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
