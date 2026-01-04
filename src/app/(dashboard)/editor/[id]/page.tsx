import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { EditorClient } from './editor-client';
import type { Board, Pedal, Amp, PlacedPedal } from '@/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditorPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch configuration with related data
  const { data: config, error } = await supabase
    .from('configurations')
    .select(`
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
    `)
    .eq('id', id)
    .single();

  if (error || !config) {
    notFound();
  }

  // Fetch all available pedals for the library
  const { data: allPedals } = await supabase
    .from('pedals')
    .select(`
      *,
      jacks:pedal_jacks(*)
    `)
    .order('manufacturer')
    .order('name');

  // Fetch all available amps
  const { data: allAmps } = await supabase
    .from('amps')
    .select('*')
    .order('manufacturer')
    .order('name');

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
      isActive: cp.is_active as boolean,
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

  return (
    <EditorClient
      configId={id}
      configName={config.name}
      configDescription={config.description || ''}
      board={board}
      amp={amp}
      useEffectsLoop={config.use_effects_loop}
      use4CableMethod={config.use_4_cable_method}
      placedPedals={placedPedals}
      pedalsById={pedalsById}
      availablePedals={availablePedals}
      availableAmps={availableAmps}
    />
  );
}
