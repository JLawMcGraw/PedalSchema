'use client';

import { useMemo } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import {
  generateCableList,
  generateEnhancedCableList,
  generateSignalFlowDiagram,
  calculateCableSummary,
} from '@/lib/engine/cables';

export function CableListPanel() {
  const { cables, placedPedals, pedalsById, useEffectsLoop, amp } = useConfigurationStore();

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
    return generateEnhancedCableList(cableConnections, placedPedals, pedalsById, useEffectsLoop, amp);
  }, [cableConnections, placedPedals, pedalsById, useEffectsLoop, amp]);

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
        <h3 className="font-semibold text-sm">Cables & Wiring</h3>
        <p className="text-xs text-muted-foreground">
          {cables.length} connection{cables.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-3 space-y-3">
          {/* Wiring Checklist - Primary section */}
          {enhancedCables.length > 0 && (
            <div className="border-2 border-amber-500/50 rounded-lg overflow-hidden bg-amber-500/5">
              <div className="px-3 py-2 bg-amber-500/20 border-b border-amber-500/30">
                <span className="text-xs font-semibold text-amber-200">Wiring Checklist</span>
              </div>
              <div className="divide-y divide-border/50">
                {enhancedCables.map((cable, index) => (
                  <div key={index} className="px-3 py-2 hover:bg-muted/20">
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-xs font-bold text-amber-400 w-6 shrink-0">
                        {cable.cableNumber}
                      </span>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium">{cable.fromLabel}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">{cable.toLabel}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {cable.cableTypeLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cable Count */}
          {cableList.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b">
                <span className="text-xs font-medium">Cable Count</span>
              </div>
              <div className="p-3 font-mono text-xs space-y-1">
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
