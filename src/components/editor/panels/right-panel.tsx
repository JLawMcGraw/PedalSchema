'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { derivePedalDisplayNames, displayNameFor } from '@/lib/pedal-display-names';
import { Drawer } from './panel-chrome';
import { SignalChainPanel } from './signal-chain-panel';
import { CableListPanel } from './cable-list-panel';
import { RoutingOptionsPanel } from './routing-options-panel';
import { PowerPanel } from './power-panel';
import { PropertiesPanel } from './properties-panel';
import type { Amp } from '@/types';

/** Which reference drawer is open. Local state - nothing else needs to know. */
type OpenDrawer = 'cables' | 'routing' | 'power' | 'properties' | null;

/**
 * The right panel: the chain, always, with four reference drawers under it.
 *
 * Replaces the five-tab strip. The reasoning for the shape is on `Drawer` in
 * panel-chrome; what lives here is the composition and the one behaviour the
 * tabs used to own - selecting a pedal opens PROPS.
 *
 * That auto-open is the same effect the tab strip had, retargeted, and it has
 * the same deliberate limit: it fires on SELECTION, not on deselection. Closing
 * the drawer when a pedal is deselected would snap the panel's proportions
 * every time the user clicked empty canvas, and the drawer they opened on
 * purpose is not the app's to shut.
 */
export function RightPanel({ availableAmps }: { availableAmps: Amp[] }) {
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);

  const selectedPedalId = useEditorStore((s) => s.selectedPedalId);
  const { board, placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod } =
    useConfigurationStore(
      useShallow((s) => ({
        board: s.board,
        placedPedals: s.placedPedals,
        pedalsById: s.pedalsById,
        amp: s.amp,
        useEffectsLoop: s.useEffectsLoop,
        use4CableMethod: s.use4CableMethod,
      }))
    );
  const { cables, cableLengthInches, power } = useDerivedConfiguration((d) => ({
    cables: d.cables,
    cableLengthInches: d.cableLengthInches,
    power: d.power,
  }));

  /*
   * Adjusted DURING RENDER on a change of selection, not in an effect.
   *
   * `setOpenDrawer` in a `useEffect` is a cascading render - React commits the
   * panel with the old drawer open, then immediately re-renders with the new
   * one - and the lint rule that catches it (react-hooks/set-state-in-effect)
   * is right to. This is the documented pattern for "adjust state when
   * something changes": compare against the previous value, and set both in
   * the same pass. React re-runs this component before touching the DOM, so
   * the wrong drawer is never painted.
   */
  const [lastSelected, setLastSelected] = useState(selectedPedalId);
  if (selectedPedalId !== lastSelected) {
    setLastSelected(selectedPedalId);
    if (selectedPedalId) setOpenDrawer('properties');
  }

  const toggle = (id: Exclude<OpenDrawer, null>) =>
    setOpenDrawer((current) => (current === id ? null : id));

  // Same number as the toolbar's CABLE field, from the same derivation.
  const totalInches = cableLengthInches;

  const routingLabel = use4CableMethod
    ? '4-cable'
    : amp?.hasEffectsLoop && useEffectsLoop
      ? 'Effects loop'
      : 'Front of amp';

  /*
   * The selected pedal's name, from the engine's derivation rather than a
   * bare model name - a board with two CS-3s would otherwise label the drawer
   * with a name that matches two rows in the list above it.
   */
  const selectedName = (() => {
    if (!selectedPedalId) return null;
    const placed = placedPedals.find((p) => p.id === selectedPedalId);
    if (!placed) return null;
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return null;
    return displayNameFor(
      derivePedalDisplayNames(placedPedals, pedalsById),
      placed.id,
      pedal.name
    );
  })();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* The chain shrinks to make room for an open drawer but never
          disappears - min-h-0 on a flex child that also has flex-1 is what
          lets it be squeezed rather than forcing the drawers off the bottom. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SignalChainPanel />
      </div>

      <Drawer
        id="cables"
        label="Cables"
        fact={`${cables.length} · ${totalInches.toFixed(1)}in`}
        open={openDrawer === 'cables'}
        onToggle={() => toggle('cables')}
      >
        <CableListPanel />
      </Drawer>

      <Drawer
        id="routing"
        label="Routing"
        fact={routingLabel}
        open={openDrawer === 'routing'}
        onToggle={() => toggle('routing')}
      >
        <RoutingOptionsPanel availableAmps={availableAmps} />
      </Drawer>

      <Drawer
        id="power"
        label="Power"
        // The "≥" floor again - an unrecorded draw is not a draw of zero, and
        // this figure has to agree with the HUD's and the rail's.
        fact={`${power.unknown.length > 0 ? '≥' : ''}${power.knownTotalMa}mA`}
        open={openDrawer === 'power'}
        onToggle={() => toggle('power')}
      >
        <PowerPanel />
      </Drawer>

      <Drawer
        id="properties"
        label="Props"
        fact={selectedName ?? 'No selection'}
        factMuted={!selectedName}
        open={openDrawer === 'properties'}
        onToggle={() => toggle('properties')}
      >
        <PropertiesPanel />
      </Drawer>

      {/* The board itself, stated once at the foot of the panel that describes
          what is on it. */}
      {board && (
        <div className="shrink-0 truncate border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          {board.widthInches.toFixed(1)} × {board.depthInches.toFixed(1)} in ·{' '}
          {board.rails.length} {board.rails.length === 1 ? 'rail' : 'rails'} · {board.name}
        </div>
      )}
    </div>
  );
}
