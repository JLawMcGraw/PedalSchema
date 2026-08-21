import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pedal, Amp, PowerSupply } from '@/types';

/**
 * The catalogue: every pedal, amp and power supply the editor's panels offer.
 *
 * THIS IS THE APP'S LARGEST REPEATED READ, and none of it changes between page
 * loads. `loadConfiguration` used to fetch all 67 pedals with their jacks, all
 * amps and all supplies on EVERY editor open - so a dev session with a hundred
 * hot reloads pulled the same catalogue a hundred times. That is what put the
 * Supabase organisation past its egress quota.
 *
 * THE SPLIT IS WHAT MAKES IT CACHEABLE. The catalogue is not one set:
 *
 *   is_system = true    the shipped gear. Readable by ANYONE - see the
 *                       "System pedals are viewable by everyone" policy in
 *                       20240101000001 - identical for every caller, and the
 *                       bulk of the rows.
 *   created_by = you    gear the user added themselves. Few, private, and
 *                       changes the moment they add one.
 *
 * So the system half is cached globally and the user's half is read fresh.
 * Caching the union instead would need the user id in the cache key, which
 * gives every user their own copy of the same 67 rows - and `unstable_cache`
 * cannot call `cookies()` anyway, which an authenticated client requires.
 */

/** How long the shipped catalogue is served from cache. */
const CATALOGUE_TTL_SECONDS = 3600;

/** Cache tag, so a future admin edit can invalidate without waiting out the TTL. */
export const CATALOGUE_TAG = 'catalogue';

/**
 * An anon, cookie-free Supabase client.
 *
 * `lib/supabase/server` reads `cookies()` to carry the caller's session, and a
 * dynamic API like that cannot be called inside `unstable_cache`. Nothing here
 * needs a session: every row this client asks for is `is_system = true`, which
 * the anon role may read.
 */
function anonClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** One pedal row, in the shape the stores want. */
export function transformPedal(p: Record<string, unknown>): Pedal {
  return {
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
  };
}

/** One amp row. */
export function transformAmp(a: Record<string, unknown>): Amp {
  return {
    id: a.id as string,
    name: a.name as string,
    manufacturer: a.manufacturer as string,
    hasEffectsLoop: a.has_effects_loop as boolean,
    loopType: a.loop_type as Amp['loopType'],
    loopLevel: a.loop_level as Amp['loopLevel'],
    sendJackLabel: a.send_jack_label as string,
    returnJackLabel: a.return_jack_label as string,
    isSystem: a.is_system as boolean,
    createdBy: a.created_by as string | null,
    createdAt: a.created_at as string,
    notes: a.notes as string | null,
  } as Amp;
}

/** One supply row, outputs sorted. */
export function transformSupply(r: Record<string, unknown>): PowerSupply {
  return {
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
        alternateModes:
          (o.alternate_modes as Array<{ voltage: number; ratedMa: number }>) ?? [],
        isAc: (o.is_ac as boolean) ?? false,
        sortOrder: o.sort_order as number,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export interface Catalogue {
  availablePedals: Pedal[];
  availableAmps: Amp[];
  powerSupplies: PowerSupply[];
}

const PEDAL_SELECT = `*, jacks:pedal_jacks(*)`;
const SUPPLY_SELECT = `*, outputs:power_supply_outputs(*)`;

/**
 * The shipped catalogue, cached across requests.
 *
 * Explicitly `.eq('is_system', true)` rather than leaning on the anon role's
 * RLS view of the tables. The filter is what DEFINES the cached set: a policy
 * change would otherwise quietly alter what every caller gets served out of one
 * shared entry, and a cache whose contents depend on who filled it is the kind
 * of bug that only shows up for the second user.
 */
const getSystemCatalogue = unstable_cache(
  async (): Promise<Catalogue> => {
    const supabase = anonClient();

    const [{ data: pedalRows }, { data: ampRows }, { data: supplyRows }] =
      await Promise.all([
        supabase
          .from('pedals')
          .select(PEDAL_SELECT)
          .eq('is_system', true)
          .order('manufacturer')
          .order('name'),
        supabase
          .from('amps')
          .select('*')
          .eq('is_system', true)
          .order('manufacturer')
          .order('name'),
        supabase
          .from('power_supplies')
          .select(SUPPLY_SELECT)
          .eq('is_system', true)
          .order('manufacturer'),
      ]);

    return {
      availablePedals: (pedalRows ?? []).map(transformPedal),
      availableAmps: (ampRows ?? []).map(transformAmp),
      powerSupplies: (supplyRows ?? []).map(transformSupply),
    };
  },
  ['system-catalogue'],
  { revalidate: CATALOGUE_TTL_SECONDS, tags: [CATALOGUE_TAG] }
);

/**
 * The catalogue this caller can see: the cached system rows, plus anything they
 * added themselves.
 *
 * `userId` null means an anonymous viewer - the public /s/[slug] page - who has
 * no rows of their own by definition, so the cached half is the whole answer
 * and no second round trip is made.
 *
 * Ordering matches what the queries used to produce (manufacturer, then name)
 * so the library panel's grouping is unchanged by where a row came from.
 */
export async function getCatalogue(
  supabase: SupabaseClient,
  userId: string | null
): Promise<Catalogue> {
  const system = await getSystemCatalogue();
  if (!userId) return system;

  const [{ data: pedalRows }, { data: ampRows }, { data: supplyRows }] =
    await Promise.all([
      supabase.from('pedals').select(PEDAL_SELECT).eq('created_by', userId),
      supabase.from('amps').select('*').eq('created_by', userId),
      supabase.from('power_supplies').select(SUPPLY_SELECT).eq('created_by', userId),
    ]);

  const ownPedals = (pedalRows ?? []).map(transformPedal);
  const ownAmps = (ampRows ?? []).map(transformAmp);
  const ownSupplies = (supplyRows ?? []).map(transformSupply);

  // Nothing of their own: hand back the cached object rather than rebuilding
  // three identical arrays, which is the common case for every user who has
  // not added gear.
  if (!ownPedals.length && !ownAmps.length && !ownSupplies.length) return system;

  return {
    availablePedals: byManufacturerThenName([...system.availablePedals, ...ownPedals]),
    availableAmps: byManufacturerThenName([...system.availableAmps, ...ownAmps]),
    powerSupplies: [...system.powerSupplies, ...ownSupplies].sort((a, b) =>
      a.manufacturer.localeCompare(b.manufacturer)
    ),
  };
}

function byManufacturerThenName<T extends { manufacturer: string; name: string }>(
  rows: T[]
): T[] {
  return rows.sort(
    (a, b) =>
      a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name)
  );
}
