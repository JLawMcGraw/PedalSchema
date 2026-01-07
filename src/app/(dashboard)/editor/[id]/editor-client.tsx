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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { PlusCircle, List } from 'lucide-react';
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  // Auto-switch to properties tab when a pedal is selected
  useEffect(() => {
    if (selectedPedalId) {
      setActiveTab('properties');
      // On mobile (< lg breakpoint), open the right panel sheet when a pedal is selected
      // lg breakpoint is 1024px
      if (window.innerWidth < 1024) {
        setRightPanelOpen(true);
      }
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

  // Right panel tabs content - shared between desktop and mobile
  const rightPanelContent = (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full w-full flex flex-col gap-0">
      <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto shrink-0 overflow-x-auto">
        <TabsTrigger
          value="chain"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-3 py-2 shrink-0"
        >
          Chain
        </TabsTrigger>
        <TabsTrigger
          value="cables"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-3 py-2 shrink-0"
        >
          Cables
        </TabsTrigger>
        <TabsTrigger
          value="routing"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-3 py-2 shrink-0"
        >
          Routing
        </TabsTrigger>
        <TabsTrigger
          value="properties"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs px-3 py-2 shrink-0"
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
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      <EditorToolbar onSave={handleSave} />

      <div className="flex flex-1 overflow-hidden min-h-0 max-w-[2200px] mx-auto w-full">
        {/* Left panel - Pedal Library (desktop only) */}
        <div className="hidden lg:block w-56 xl:w-64 border-r shrink-0 overflow-hidden">
          <PedalLibraryPanel pedals={availablePedals} />
        </div>

        {/* Center - Canvas */}
        <div className="flex-1 min-w-0 overflow-hidden relative">
          <EditorCanvas />

          {/* Mobile floating action buttons */}
          <div className="lg:hidden absolute bottom-4 left-4 right-4 flex justify-between pointer-events-none">
            <Button
              size="sm"
              variant="secondary"
              className="pointer-events-auto shadow-lg gap-2"
              onClick={() => setLeftPanelOpen(true)}
            >
              <PlusCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Add Pedal</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="pointer-events-auto shadow-lg gap-2"
              onClick={() => setRightPanelOpen(true)}
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </Button>
          </div>
        </div>

        {/* Right panel - Properties & Chain (desktop only) */}
        <div className="hidden lg:flex w-64 xl:w-72 border-l shrink-0 flex-col overflow-hidden">
          {rightPanelContent}
        </div>
      </div>

      {/* Mobile left panel sheet */}
      <Sheet open={leftPanelOpen} onOpenChange={setLeftPanelOpen}>
        <SheetContent side="left" className="w-72 sm:w-80 p-0 flex flex-col pt-10">
          <VisuallyHidden.Root>
            <SheetTitle>Add Pedal</SheetTitle>
            <SheetDescription>Search and select pedals to add to your board</SheetDescription>
          </VisuallyHidden.Root>
          <div className="flex-1 min-h-0 overflow-hidden">
            <PedalLibraryPanel pedals={availablePedals} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile right panel sheet */}
      <Sheet open={rightPanelOpen} onOpenChange={setRightPanelOpen}>
        <SheetContent side="right" className="w-80 sm:w-96 p-0 flex flex-col">
          <VisuallyHidden.Root>
            <SheetTitle>Pedal Details</SheetTitle>
            <SheetDescription>View signal chain, cables, routing, and properties</SheetDescription>
          </VisuallyHidden.Root>
          <div className="flex-1 min-h-0 overflow-hidden pt-12">
            {rightPanelContent}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
