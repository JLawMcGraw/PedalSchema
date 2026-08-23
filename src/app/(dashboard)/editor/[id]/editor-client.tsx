'use client';

import { useEffect, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useConfigurationStore } from '@/store/configuration-store';
import { useEditorStore } from '@/store/editor-store';
import { EditorCanvas } from '@/components/editor/canvas/editor-canvas';
import { EditorToolbar } from '@/components/editor/toolbar/editor-toolbar';
import { BoardRosterPanel } from '@/components/editor/panels/board-roster-panel';
import { RightPanel } from '@/components/editor/panels/right-panel';
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  /*
   * On mobile (< lg) the rails are Sheets, so selecting a pedal has to OPEN
   * the sheet or the properties it just switched to are behind a closed
   * drawer. Which drawer opens is no longer decided here - RightPanel owns
   * that now, and does it for both the desktop rail and this sheet, because
   * they are the same component mounted twice.
   */
  useEffect(() => {
    if (selectedPedalId && window.innerWidth < 1024) {
      setRightPanelOpen(true);
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

  /*
   * THREE BANDS: app header, the toolbar block, then the body.
   *
   * 2.75rem is the app header's h-11 and the two numbers MUST agree - see the
   * note on header.tsx. Getting this wrong does not look wrong: the shell ends
   * up a few pixels taller than the viewport, the document scrolls, and the
   * only symptom is the bottom of the right panel being cut off.
   */
  return (
    <div className="flex flex-col h-[calc(100dvh-2.75rem)]">
      <EditorToolbar onSave={handleSave} />

      <div className="flex flex-1 overflow-hidden min-h-0 max-w-[2200px] mx-auto w-full">
        {/* Left rail - what is on the board, in chain order (desktop only) */}
        <div className="hidden lg:block w-[264px] border-r shrink-0 overflow-hidden">
          <BoardRosterPanel pedals={availablePedals} />
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

        {/* Right panel - chain, then drawers (desktop only) */}
        <div className="hidden lg:flex w-[300px] border-l shrink-0 flex-col overflow-hidden">
          <RightPanel availableAmps={availableAmps} />
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
            <BoardRosterPanel pedals={availablePedals} />
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
            <RightPanel availableAmps={availableAmps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
