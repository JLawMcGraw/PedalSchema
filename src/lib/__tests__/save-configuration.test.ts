import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveConfiguration, SaveConflictError } from '../save-configuration';
import { makePedalSet } from '@/lib/engine/__tests__/support/fixtures';

const input = () => {
  const pedals = makePedalSet('trio').placedPedals;
  pedals[0].locationOverride = true;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    expectedRevision: 4,
    name: 'Board',
    description: '',
    ampId: null,
    useEffectsLoop: false,
    use4CableMethod: false,
    modulationInLoop: false,
    routingConfig: { useLoopPedals: true, use4CableMethod: false, pedalConfigs: [] },
    powerSupplyId: null,
    placedPedals: pedals,
  };
};

describe('saveConfiguration', () => {
  it('sends one RPC with the revision and durable location override', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { revision: 5, updatedAt: '2026-08-25T12:00:00Z' }, error: null,
    });
    const result = await saveConfiguration({ rpc } as unknown as SupabaseClient, input());

    expect(result.revision).toBe(5);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('save_configuration');
    expect(rpc.mock.calls[0][1].p_expected_revision).toBe(4);
    expect(rpc.mock.calls[0][1].p_pedals[0].locationOverride).toBe(true);
  });

  it('turns a stale revision into a distinct conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'changed in another tab' },
    });
    await expect(
      saveConfiguration({ rpc } as unknown as SupabaseClient, input())
    ).rejects.toBeInstanceOf(SaveConflictError);
  });

  it('rejects a success response without a save receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(
      saveConfiguration({ rpc } as unknown as SupabaseClient, input())
    ).rejects.toThrow('invalid save receipt');
  });
});
