'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useConfigurationStore } from '@/store/configuration-store';
import { useEditorStore } from '@/store/editor-store';
import { EditorCanvas } from '@/components/editor/canvas/editor-canvas';
import { EditorToolbar } from '@/components/editor/toolbar/editor-toolbar';
import { PedalLibraryPanel } from '@/components/editor/panels/pedal-library-panel';
import { SignalChainPanel } from '@/components/editor/panels/signal-chain-panel';
import { PropertiesPanel } from '@/components/editor/panels/properties-panel';
import { CableListPanel } from '@/components/editor/panels/cable-list-panel';
import { RoutingOptionsPanel } from '@/components/editor/panels/routing-options-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Board, Amp, Pedal, PlacedPedal } from '@/types';

interface EditorClientProps {
  configId: string;
  configName: string;
  configDescription: string;
  board: Board;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  availablePedals: Pedal[];
  availableAmps: Amp[];
}

export function EditorClient({
  configId,
  configName,
  configDescription,
  board,
  amp,
  useEffectsLoop,
  use4CableMethod,
  placedPedals: initialPlacedPedals,
  pedalsById: initialPedalsById,
  availablePedals,
  availableAmps,
}: EditorClientProps) {
  const router = useRouter();
  const initConfiguration = useConfigurationStore((s) => s.initConfiguration);
  const configStore = useConfigurationStore();
  const { selectedPedalId } = useEditorStore();
  const [activeTab, setActiveTab] = useState('chain');

  // Auto-switch to properties tab when a pedal is selected
  useEffect(() => {
    if (selectedPedalId) {
      setActiveTab('properties');
    }
  }, [selectedPedalId]);

  // Initialize configuration on mount
  useEffect(() => {
    initConfiguration({
      id: configId,
      name: configName,
      description: configDescription,
      board,
      amp,
      useEffectsLoop,
      use4CableMethod,
      placedPedals: initialPlacedPedals,
      pedalsById: initialPedalsById,
    });
  }, [
    configId,
    configName,
    configDescription,
    board,
    amp,
    useEffectsLoop,
    use4CableMethod,
    initialPlacedPedals,
    initialPedalsById,
    initConfiguration,
  ]);

  // Save handler
  const handleSave = useCallback(async () => {
    const { id, name, description, placedPedals, amp, useEffectsLoop, use4CableMethod, setSaving, markClean } =
      useConfigurationStore.getState();

    if (!id) return;

    setSaving(true);

    try {
      const supabase = createClient();

      // Update configuration
      await supabase
        .from('configurations')
        .update({
          name,
          description,
          amp_id: amp?.id || null,
          use_effects_loop: useEffectsLoop,
          use_4_cable_method: use4CableMethod,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      // Delete existing pedals and re-insert
      await supabase.from('configuration_pedals').delete().eq('configuration_id', id);

      if (placedPedals.length > 0) {
        await supabase.from('configuration_pedals').insert(
          placedPedals.map((p) => ({
            configuration_id: id,
            pedal_id: p.pedalId,
            x_inches: p.xInches,
            y_inches: p.yInches,
            rotation_degrees: p.rotationDegrees,
            chain_position: p.chainPosition,
            location: p.location,
            is_active: p.isActive,
          }))
        );
      }

      markClean();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (configStore.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [configStore.isDirty]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <EditorToolbar onSave={handleSave} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left panel - Pedal Library */}
        <div className="w-56 border-r flex-shrink-0 overflow-hidden">
          <PedalLibraryPanel pedals={availablePedals} />
        </div>

        {/* Center - Canvas */}
        <div className="flex-1 overflow-hidden">
          <EditorCanvas />
        </div>

        {/* Right panel - Properties & Chain */}
        <div className="w-72 min-w-0 max-w-72 border-l flex-shrink-0 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full w-full flex flex-col gap-0">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto shrink-0">
              <TabsTrigger
                value="chain"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-2 py-1.5"
              >
                Chain
              </TabsTrigger>
              <TabsTrigger
                value="cables"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-2 py-1.5"
              >
                Cables
              </TabsTrigger>
              <TabsTrigger
                value="routing"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-2 py-1.5"
              >
                Routing
              </TabsTrigger>
              <TabsTrigger
                value="properties"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-2 py-1.5"
              >
                Props
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chain" className="flex-1 mt-0 min-h-0 w-full max-w-full overflow-hidden">
              <SignalChainPanel />
            </TabsContent>
            <TabsContent value="cables" className="flex-1 mt-0 min-h-0 w-full max-w-full overflow-hidden">
              <CableListPanel />
            </TabsContent>
            <TabsContent value="routing" className="flex-1 mt-0 min-h-0 w-full max-w-full overflow-hidden">
              <RoutingOptionsPanel availableAmps={availableAmps} />
            </TabsContent>
            <TabsContent value="properties" className="flex-1 mt-0 min-h-0 w-full max-w-full overflow-hidden">
              <PropertiesPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
