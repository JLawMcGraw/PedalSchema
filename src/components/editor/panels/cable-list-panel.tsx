'use client';

import { PANEL_TITLE } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import {
  generateCableList,
  generateEnhancedCableList,
  generateSignalFlowDiagram,
  calculateCableSummary,
} from '@/lib/engine/cables';

/**
 * "PW-3 OUTPUT -> CP-1X INPUT" is the arrow said three times.
 *
 * The ordinary case is an output going to an input, and naming both made most
 * rows wrap onto a second line. Anything OTHER than that - SEND, RETURN, a
 * loop jack - still gets named, because there the jack is the whole point.
 */
function plainEnd(label: string, expected: 'OUTPUT' | 'INPUT'): string {
  const suffix = ` ${expected}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
}

export function CableListPanel() {
  const { placedPedals, pedalsById, useEffectsLoop, amp } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById, useEffectsLoop: s.useEffectsLoop, amp: s.amp }))
  );
  const { cables } = useDerivedConfiguration((d) => ({ cables: d.cables }));

  // Transform cables to CableConnection format
  const cableConnections = useMemo(() => {
    return cables.map((c) => ({
      fromType: c.fromType,
      fromPedalId: c.fromPedalId,
      fromJackType: c.fromJack,
      toType: c.toType,
      toPedalId: c.toPedalId,
      toJackType: c.toJack,
      calculatedLengthInches: c.calculatedLengthInches || 0,
      cableType: c.cableType,
      sortOrder: c.sortOrder,
    }));
  }, [cables]);

  const enhancedCables = useMemo(() => {
    return generateEnhancedCableList(cableConnections, placedPedals, pedalsById);
  }, [cableConnections, placedPedals, pedalsById]);

  const signalFlow = useMemo(() => {
    return generateSignalFlowDiagram(cableConnections, placedPedals, pedalsById, useEffectsLoop, amp);
  }, [cableConnections, placedPedals, pedalsById, useEffectsLoop, amp]);

  const summary = useMemo(() => {
    return calculateCableSummary(cableConnections);
  }, [cableConnections]);

  const cableList = useMemo(() => {
    return generateCableList(cableConnections);
  }, [cableConnections]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0">
        <h3 className={PANEL_TITLE}>Cables &amp; wiring</h3>
        <p className="text-xs text-muted-foreground">
          {cables.length} connection{cables.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-3 space-y-3">
          {/*
            The wiring order.

            This was a heavy amber-bordered box on an amber tint - three raw
            hues that survived the palette work because they are panel chrome
            rather than a cable - wrapping twenty-four rows whose second line
            said "Patch (6")" twenty times over. The length is data, so it goes
            in a column where the eye can skip it; the pedals are what you read.
          */}
          {enhancedCables.length > 0 && (
            <div className="-mx-3 -mt-3">
              <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Wire it in this order
              </p>
              <div className="divide-y border-y">
                {enhancedCables.map((cable, index) => (
                  <div key={index} className="flex items-baseline gap-2 px-3 py-1.5 hover:bg-muted/40">
                    <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
                      {cable.cableNumber}
                    </span>
                    <span className="min-w-0 flex-1 text-xs leading-snug">
                      <span className="font-medium">{plainEnd(cable.fromLabel, 'OUTPUT')}</span>
                      <span className="mx-1 text-muted-foreground">&rarr;</span>
                      <span className="font-medium">{plainEnd(cable.toLabel, 'INPUT')}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {cable.cableTypeLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cable Count */}
          {cableList.length > 0 && (
            <div>
              <p className="pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                What to buy
              </p>
              <div className="space-y-1 font-mono text-xs">
                {cableList.map((item, index) => (
                  <div key={`${item.cableType}-${item.lengthInches}-${index}`} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {item.lengthDisplay} {item.cableType === 'patch' ? 'patch' : 'instrument'}:
                    </span>
                    <span>{item.count}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold pt-2 border-t mt-2">
                  <span>Total:</span>
                  <span>{summary.totalCount}</span>
                </div>
              </div>
            </div>
          )}

          {/* Signal Flow Diagram */}
          {signalFlow.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b">
                <span className="text-xs font-medium">Signal Flow</span>
              </div>
              <div className="p-3">
                <div className="font-mono text-xs leading-relaxed break-words">
                  {signalFlow.map((segment, index) => (
                    <span key={index}>
                      {index > 0 && <span className="text-amber-500"> → </span>}
                      <span className={segment.isExternal ? 'text-amber-400 font-semibold' : 'text-foreground'}>
                        {segment.label}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {cables.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-6">
              Add pedals to see cable requirements
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
