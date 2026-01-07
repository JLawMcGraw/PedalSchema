'use client';

import { useConfigurationStore } from '@/store/configuration-store';
import { useEditorStore } from '@/store/editor-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCategoryColor } from '@/lib/constants/pedal-categories';
import { AlertTriangle, Lightbulb } from 'lucide-react';

export function SignalChainPanel() {
  const { placedPedals, pedalsById, removePedal, amp, useEffectsLoop, warnings, suggestions } = useConfigurationStore();
  const { selectedPedalId, selectPedal } = useEditorStore();

  const sortedPedals = [...placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);

  const effectsLoopEnabled = amp?.hasEffectsLoop && useEffectsLoop;
  const frontOfAmpPedals = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location !== 'effects_loop')
    : sortedPedals;
  const effectsLoopPedals = effectsLoopEnabled
    ? sortedPedals.filter((p) => p.location === 'effects_loop')
    : [];

  const renderPedalItem = (placed: typeof placedPedals[0]) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return null;

    const isSelected = selectedPedalId === placed.id;

    return (
      <div
        key={placed.id}
        onClick={() => selectPedal(placed.id)}
        className={`p-2 rounded cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted'
        }`}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ backgroundColor: getCategoryColor(pedal.category) }}
          >
            {placed.chainPosition}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-xs truncate">{pedal.name}</div>
            <div className="text-xs text-muted-foreground truncate">{pedal.manufacturer}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              removePedal(placed.id);
            }}
          >
            ×
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0">
        <h3 className="font-semibold text-sm">Signal Chain</h3>
        <p className="text-xs text-muted-foreground">
          {sortedPedals.length} pedal{sortedPedals.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-3 space-y-4">
          {/* Front of amp section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                Guitar In
              </Badge>
              <div className="flex-1 h-px bg-border" />
            </div>

            {frontOfAmpPedals.length > 0 ? (
              <div className="space-y-1">
                {frontOfAmpPedals.map(renderPedalItem)}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-3">
                No pedals
              </div>
            )}

            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-px bg-border" />
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                Amp
              </Badge>
            </div>
          </div>

          {/* Effects loop section */}
          {effectsLoopEnabled && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="text-xs px-2 py-0.5">
                  {amp?.sendJackLabel || 'Send'}
                </Badge>
                <div className="flex-1 h-px bg-border" />
              </div>

              {effectsLoopPedals.length > 0 ? (
                <div className="space-y-1">
                  {effectsLoopPedals.map(renderPedalItem)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-3">
                  No pedals in loop
                </div>
              )}

              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-px bg-border" />
                <Badge variant="secondary" className="text-xs px-2 py-0.5">
                  {amp?.returnJackLabel || 'Return'}
                </Badge>
              </div>
            </div>
          )}

          {sortedPedals.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-6">
              Add pedals from the library
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                Warnings
              </h4>
              {warnings.map((warning, index) => (
                <div
                  key={index}
                  className={`p-2 rounded text-xs border ${
                    warning.severity === 'error'
                      ? 'border-destructive/50 bg-destructive/10'
                      : 'border-yellow-500/50 bg-yellow-500/10'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug">{warning.message}</div>
                      {warning.suggestion && (
                        <div className="text-xs text-muted-foreground mt-1 leading-snug">{warning.suggestion}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                Suggestions
              </h4>
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="p-2 rounded text-xs border border-blue-500/50 bg-blue-500/10"
                >
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-snug">{suggestion.message}</div>
                      {suggestion.suggestion && (
                        <div className="text-xs text-muted-foreground mt-1 leading-snug">{suggestion.suggestion}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
