'use client';

import { useEffect, useCallback, useState } from 'react';
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
import { PowerPanel } from '@/components/editor/panels/power-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { PlusCircle, ListBullets } from '@phosphor-icons/react';
import { describeSaveError, failIf } from '@/lib/save-error';
import type { Board, Amp, Pedal, PlacedPedal, RoutingConfig, PowerSupply } from '@/types';

interface EditorClientProps {
  configId: string;
  configName: string;
  configDescription: string;
  isPublic: boolean;
  shareSlug: string | null;
  board: Board;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  modulationInLoop: boolean;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  availablePedals: Pedal[];
  availableAmps: Amp[];
  /** Stored pedal-loop wiring; undefined for configurations saved before it was persisted. */
  routingConfig?: Partial<RoutingConfig>;
  powerSupplies?: PowerSupply[];
  powerSupply?: PowerSupply | null;
}

/**
 * The panel tabs.
 *
 * Navigation is micro-typography in this system - monospace, uppercase,
 * tracked - per `.agents/skills/industrial-brutalist-ui` §3.2, which puts all
 * metadata, navigation and unit IDs in that register. Five tabs previously sat
 * in ordinary sentence-case sans at the same weight as body copy, so the panel
 * switcher read like content rather than instrumentation.
 */
const TAB_CLASS =
  // px-2 and tracking-wider, NOT px-2.5/widest: measured, those made the five
  // tabs 306px wide in a 287px strip and wrapped "Props" onto a second row.
  // The skill's range for this register is 0.05em-0.1em, so this is still in
  // spec - it is the loose end of it that did not fit.
  'h-auto flex-none rounded-none border-b-2 border-transparent px-2 py-2 ' +
  'font-mono text-[10px] uppercase tracking-wider text-muted-foreground ' +
  'transition-colors hover:text-foreground ' +
  'data-[state=active]:border-primary data-[state=active]:text-foreground';

export function EditorClient({
  configId,
  configName,
  configDescription,
  isPublic,
  shareSlug,
  board,
  amp,
  useEffectsLoop,
  use4CableMethod,
  modulationInLoop,
  placedPedals: initialPlacedPedals,
  pedalsById: initialPedalsById,
  availablePedals,
  availableAmps,
  routingConfig: initialRoutingConfig,
  powerSupplies: initialPowerSupplies,
  powerSupply: initialPowerSupply,
}: EditorClientProps) {
  const initConfiguration = useConfigurationStore((s) => s.initConfiguration);
  const isDirty = useConfigurationStore((s) => s.isDirty);
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
      isPublic,
      shareSlug,
      board,
      amp,
      useEffectsLoop,
      use4CableMethod,
      modulationInLoop,
      placedPedals: initialPlacedPedals,
      pedalsById: initialPedalsById,
      routingConfig: initialRoutingConfig,
    });
    // Supplies are catalogue data plus one selection, not board state, so they
    // are seeded alongside initConfiguration rather than inside it - nothing
    // here belongs in an undo snapshot.
    const store = useConfigurationStore.getState();
    store.setPowerSupplies(initialPowerSupplies ?? []);
    if (initialPowerSupply !== undefined) {
      useConfigurationStore.setState({ powerSupply: initialPowerSupply });
    }
    /*
     * `initialPowerSupplies` and `initialPowerSupply` are DELIBERATELY not
     * dependencies, and adding them is not a safe way to silence this.
     *
     * They are an array and an object prop, so they carry a new identity on
     * every render of the parent. In the deps they would re-run this effect
     * continuously, and this effect calls initConfiguration - which resets the
     * board to its loaded state. That is the user's unsaved work, thrown away
     * on a re-render they did not cause.
     *
     * There is no stale-closure risk in leaving them out: the effect re-runs
     * whenever the board's identity changes, and when it does it reads the
     * props of that render, which are the fresh ones.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    configId,
    configName,
    configDescription,
    isPublic,
    shareSlug,
    board,
    amp,
    useEffectsLoop,
    use4CableMethod,
    modulationInLoop,
    initialPlacedPedals,
    initialPedalsById,
    initialRoutingConfig,
    initConfiguration,
  ]);

  // Save handler
  //
  // Everything is read from getState() at call time (never from render closures -
  // a stale closure here previously saved modulation_in_loop's initial value forever).
  //
  // ORDER OF WRITES. Prune the rows the user removed FIRST, then upsert what is
  // left. Both halves of that matter and both were once wrong:
  //
  //   * It must not be delete-ALL-then-insert. That had a data-loss window: a
  //     failure between the two wiped the board.
  //   * It must not be upsert-then-prune either, which is what replaced it.
  //     configuration_pedals has UNIQUE(configuration_id, chain_position), and
  //     the prune is a SEPARATE request, so the upsert commits while the
  //     removed pedal's row is still holding its old position. If any kept
  //     pedal has moved into that position - which is routine, since removing a
  //     pedal renumbers the chain - the upsert fails on a duplicate that is
  //     entirely real at commit time:
  //       23505 Key (configuration_id, chain_position)=(..., 3) already exists
  //     Deferring the constraint does not help; the row genuinely is there.
  //
  // Pruning first is safe in a way delete-all was not: it removes ONLY rows the
  // user has already deleted, so a failure part-way through cannot lose a pedal
  // they still have. Reordering among the rows that REMAIN is what the deferred
  // constraint covers (migration 20260801000005) - the two fixes address
  // different collisions and are both required.
  const handleSave = useCallback(async () => {
    const {
      id, name, description, placedPedals, amp,
      useEffectsLoop, use4CableMethod, modulationInLoop, routingConfig, powerSupply,
      setSaving, markClean, setSaveError,
    } = useConfigurationStore.getState();

    if (!id) return;

    setSaving(true);
    setSaveError(null);

    try {
      const supabase = createClient();

      const { error: configError } = await supabase
        .from('configurations')
        .update({
          name,
          description,
          amp_id: amp?.id || null,
          use_effects_loop: useEffectsLoop,
          use_4_cable_method: use4CableMethod,
          modulation_in_loop: modulationInLoop,
          // Pedal-loop wiring (which pedal is the hub, what runs in its
          // send/return) and the rotation toggle. Everything else in
          // RoutingConfig has its own column and is NOT duplicated here - the
          // loader rebuilds those from the columns.
          routing_config: {
            useLoopPedals: routingConfig.useLoopPedals,
            pedalConfigs: routingConfig.pedalConfigs,
            ...(routingConfig.allowRotation !== undefined
              ? { allowRotation: routingConfig.allowRotation }
              : {}),
          },
          // Which supply this board is planned against. Null is a real value
          // here - it means demand-only reporting, not "unchanged".
          power_supply_id: powerSupply?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      failIf('Saving the configuration', configError);

      // Prune rows for pedals the user removed. Must precede the upsert - see
      // the note on this callback.
      let pruneQuery = supabase
        .from('configuration_pedals')
        .delete()
        .eq('configuration_id', id);
      if (placedPedals.length > 0) {
        const keepIds = placedPedals.map((p) => `"${p.id}"`).join(',');
        pruneQuery = pruneQuery.not('id', 'in', `(${keepIds})`);
      }
      const { error: pruneError } = await pruneQuery;
      failIf('Removing deleted pedals', pruneError);

      // Then upsert what remains, by stable client id.
      if (placedPedals.length > 0) {
        const { error: upsertError } = await supabase
          .from('configuration_pedals')
          .upsert(
            placedPedals.map((p) => ({
              id: p.id,
              configuration_id: id,
              pedal_id: p.pedalId,
              x_inches: p.xInches,
              y_inches: p.yInches,
              rotation_degrees: p.rotationDegrees,
              chain_position: p.chainPosition,
              location: p.location,
              chain_position_locked: p.chainPositionLocked ?? false,
              rotation_locked: p.rotationLocked ?? false,
              power_output_id: p.powerOutputId ?? null,
              is_active: p.isActive,
              use_loop: p.useLoop,
            })),
            { onConflict: 'id' }
          );
        failIf('Saving the pedals', upsertError);
      }

      markClean();
    } catch (error) {
      // Config stays dirty so the toolbar keeps showing the unsaved state -
      // and saveError says WHY, in the UI, because a console line nobody has
      // open is not a report.
      const message = describeSaveError(error);
      console.error('Failed to save:', message, error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Right panel tabs content - shared between desktop and mobile
  const rightPanelContent = (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full w-full flex flex-col gap-0">
      {/*
        WRAPS rather than scrolls. Five tabs need 316px; the panel is 256px at
        lg and 288px at xl, so the last one - Props - sat off the end at every
        viewport width. `overflow-x-auto` made it technically reachable, but a
        scrollbar nobody can see on a tab strip is the same as a missing tab,
        which is how it was reported.

        Wrapping needs two of TabsTrigger's own defaults overridden, and both
        are load-bearing:
          h-auto     - the default is h-[calc(100%-1px)], a height defined
                       against the LIST's height. That is circular once the
                       list's height depends on how many rows the tabs wrap
                       onto, and the tabs render taller than their container.
          flex-none  - the default flex-1 stretches tabs to fill their row, so
                       a lone tab on row two spanned the full 287px.
        With both, tabs size to their labels and wrap like text.
      */}
      {/*
        Every trigger carries `data-panel-tab`, keyed on its VALUE rather than
        its label, so verification scripts have a stable handle - the same
        reason as [data-pedal-canvas] and [data-cable-legend].

        Nine selectors across six gates used to find these by their text, and
        the text is not the contract: `Props` renders as "PROPS" only because
        of a CSS uppercase transform, so `:text-is("Routing")` passes today and
        would break the day someone types the label in capitals, with the
        screen looking identical either way. Two gates were already broken this
        session by exactly that class of bet.
      */}
      <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto shrink-0 flex-wrap">
        <TabsTrigger
          value="chain"
          data-panel-tab="chain"
          className={TAB_CLASS}
        >
          Chain
        </TabsTrigger>
        <TabsTrigger
          value="cables"
          data-panel-tab="cables"
          className={TAB_CLASS}
        >
          Cables
        </TabsTrigger>
        <TabsTrigger
          value="routing"
          data-panel-tab="routing"
          className={TAB_CLASS}
        >
          Routing
        </TabsTrigger>
        <TabsTrigger
          value="power"
          data-panel-tab="power"
          className={TAB_CLASS}
        >
          Power
        </TabsTrigger>
        <TabsTrigger
          value="properties"
          data-panel-tab="properties"
          className={TAB_CLASS}
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
      <TabsContent value="power" className="flex-1 mt-0 min-h-0 w-full max-w-full overflow-hidden">
        <PowerPanel />
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
              <ListBullets className="h-4 w-4" />
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
