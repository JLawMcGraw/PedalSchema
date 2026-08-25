import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlacedPedal, RoutingConfig } from '@/types';
import { describeSaveError } from './save-error';

export interface SaveConfigurationInput {
  id: string;
  expectedRevision: number;
  name: string;
  description: string;
  ampId: string | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  routingConfig: RoutingConfig;
  powerSupplyId: string | null;
  placedPedals: PlacedPedal[];
}

export interface SaveConfigurationResult {
  revision: number;
  updatedAt: string;
}

export class SaveConflictError extends Error {
  constructor(message = 'This board was changed in another tab. Reload before saving.') {
    super(message);
    this.name = 'SaveConflictError';
  }
}

/** One RPC call, and therefore one Postgres transaction, for the whole board. */
export async function saveConfiguration(
  supabase: SupabaseClient,
  input: SaveConfigurationInput
): Promise<SaveConfigurationResult> {
  const { data, error } = await supabase.rpc('save_configuration', {
    p_configuration_id: input.id,
    p_expected_revision: input.expectedRevision,
    p_configuration: {
      name: input.name,
      description: input.description,
      ampId: input.ampId,
      useEffectsLoop: input.useEffectsLoop,
      use4CableMethod: input.use4CableMethod,
      modulationInLoop: input.modulationInLoop,
      routingConfig: {
        useLoopPedals: input.routingConfig.useLoopPedals,
        pedalConfigs: input.routingConfig.pedalConfigs,
        ...(input.routingConfig.allowRotation !== undefined
          ? { allowRotation: input.routingConfig.allowRotation }
          : {}),
      },
      powerSupplyId: input.powerSupplyId,
    },
    p_pedals: input.placedPedals.map((p) => ({
      id: p.id,
      pedalId: p.pedalId,
      xInches: p.xInches,
      yInches: p.yInches,
      rotationDegrees: p.rotationDegrees,
      chainPosition: p.chainPosition,
      location: p.location,
      locationOverride: p.locationOverride,
      chainPositionLocked: p.chainPositionLocked ?? false,
      rotationLocked: p.rotationLocked ?? false,
      powerOutputId: p.powerOutputId ?? null,
      isActive: p.isActive,
      useLoop: p.useLoop,
    })),
  });

  if (error) {
    if (error.code === '40001') throw new SaveConflictError(error.message);
    throw new Error(`Saving the board: ${describeSaveError(error)}`, { cause: error });
  }

  const result = data as Partial<SaveConfigurationResult> | null;
  if (!result || !Number.isSafeInteger(result.revision) || !result.updatedAt) {
    throw new Error('Saving the board: the server returned an invalid save receipt');
  }

  return { revision: result.revision as number, updatedAt: result.updatedAt };
}
