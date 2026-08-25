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
import { describeSaveError } from '@/lib/save-error';
import { saveConfiguration, SaveConflictError } from '@/lib/save-configuration';
import type { Board, Amp, Pedal, PlacedPedal, RoutingConfig, PowerSupply } from '@/types';

interface EditorClientProps {
  configId: string;
  revision: number;
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
  revision,
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
  const saveConflict = useConfigurationStore((s) => s.saveConflict);
  const selectedPedalId = useEditorStore((s) => s.selectedPedalId);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [conflictDetailsOpen, setConflictDetailsOpen] = useState(true);

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
      revision,
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
      powerSupplies: initialPowerSupplies ?? [],
      powerSupply: initialPowerSupply ?? null,
    });
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
    revision,
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

  useEffect(() => {
    if (saveConflict) setConflictDetailsOpen(true);
  }, [saveConflict]);

  // One RPC owns the configuration update, prune, and pedal upsert. The local
  // mutation token prevents an older successful request from clearing edits
  // made while that transaction was in flight.
  const handleSave = useCallback(async () => {
    const {
      id, name, description, placedPedals, amp,
      useEffectsLoop, use4CableMethod, modulationInLoop, routingConfig, powerSupply,
      serverRevision, mutationVersion, saveConflict,
      setSaving, markSaved, setSaveError, setSaveConflict,
    } = useConfigurationStore.getState();

    if (!id || saveConflict) return;

    setSaving(true);
    setSaveError(null);

    try {
      const receipt = await saveConfiguration(createClient(), {
        id,
        expectedRevision: serverRevision,
        name,
        description,
        ampId: amp?.id ?? null,
        useEffectsLoop,
        use4CableMethod,
        modulationInLoop,
        routingConfig,
        powerSupplyId: powerSupply?.id ?? null,
        placedPedals,
      });
      markSaved(mutationVersion, receipt.revision);
    } catch (error) {
      if (error instanceof SaveConflictError) {
        setSaveConflict(error.message);
        setSaveError(null);
        return;
      }
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

      {saveConflict && (
        <div className="flex items-center justify-between gap-4 border-b border-destructive/40 bg-destructive/10 px-4 py-2">
          <p className="text-xs text-destructive">
            {conflictDetailsOpen ? saveConflict : 'Save conflict — reload is required before saving again.'}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            {conflictDetailsOpen && (
              <button
                type="button"
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                onClick={() => setConflictDetailsOpen(false)}
              >
                Keep editing
              </button>
            )}
            <button
              type="button"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive hover:underline"
              onClick={() => {
                if (window.confirm('Reload the server version? Your unsaved changes in this tab will be lost.')) {
                  window.location.reload();
                }
              }}
            >
              Reload server version
            </button>
          </div>
        </div>
      )}

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
