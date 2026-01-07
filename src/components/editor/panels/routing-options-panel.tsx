'use client';

import { useMemo } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowRight } from 'lucide-react';
import type { Amp } from '@/types';

interface RoutingOptionsPanelProps {
  availableAmps: Amp[];
}

export function RoutingOptionsPanel({ availableAmps }: RoutingOptionsPanelProps) {
  const {
    placedPedals,
    pedalsById,
    routingConfig,
    togglePedalInLoop,
    amp,
    setAmp,
    useEffectsLoop,
    setUseEffectsLoop,
  } = useConfigurationStore();

  const handleAmpChange = (ampId: string) => {
    if (ampId === 'none') {
      setAmp(null);
    } else {
      const selectedAmp = availableAmps.find((a) => a.id === ampId);
      if (selectedAmp) {
        setAmp(selectedAmp);
      }
    }
  };

  const loopPedals = useMemo(() => {
    return placedPedals.filter(placed => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (!pedal || !pedal.jacks) return false;
      const hasSend = pedal.jacks.some(j => j.jackType === 'send');
      const hasReturn = pedal.jacks.some(j => j.jackType === 'return');
      return hasSend && hasReturn;
    });
  }, [placedPedals, pedalsById]);

  const loopCandidates = useMemo(() => {
    const driveCategories = ['overdrive', 'distortion', 'fuzz', 'boost'];
    return placedPedals.filter(placed => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (!pedal) return false;
      return driveCategories.includes(pedal.category);
    });
  }, [placedPedals, pedalsById]);

  const getLoopConfig = (loopPedalId: string) => {
    return routingConfig.pedalConfigs.find(c => c.pedalId === loopPedalId);
  };

  const isPedalInLoop = (loopPedalId: string, targetPedalId: string) => {
    const config = getLoopConfig(loopPedalId);
    return config?.loopPedalIds.includes(targetPedalId) ?? false;
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0">
        <h3 className="font-semibold text-sm">Routing</h3>
        <p className="text-xs text-muted-foreground">Signal path config</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-3 space-y-3">
          {/* Amp Selection */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium">Amp</span>
            </div>
            <div className="p-3">
              <Select value={amp?.id || 'none'} onValueChange={handleAmpChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select amp..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No amp</SelectItem>
                  {availableAmps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{a.manufacturer} {a.name}</span>
                        {a.hasEffectsLoop && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0">FX</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {amp && (
                <p className="text-xs text-muted-foreground mt-2">
                  {amp.hasEffectsLoop
                    ? `${amp.loopType || 'Serial'} FX loop`
                    : 'No FX loop'}
                </p>
              )}
            </div>
          </div>

          {/* Effects Loop Toggle */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b flex items-center justify-between">
              <span className="text-xs font-medium">Effects Loop</span>
              <Switch
                checked={useEffectsLoop}
                onCheckedChange={setUseEffectsLoop}
                disabled={!amp?.hasEffectsLoop}
              />
            </div>
            <div className="p-3">
              <p className="text-xs text-muted-foreground">
                {!amp
                  ? 'Select an amp first'
                  : !amp.hasEffectsLoop
                  ? 'Amp has no FX loop'
                  : useEffectsLoop
                  ? 'Time effects route through FX loop'
                  : 'All pedals run in front'}
              </p>
            </div>
          </div>

          {/* Signal Flow */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium">Signal Flow</span>
            </div>
            <div className="p-3 text-xs space-y-1">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-medium">Guitar</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <span>Pedals</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="font-medium">Amp</span>
              </div>
              {useEffectsLoop && amp?.hasEffectsLoop && (
                <div className="flex items-center gap-1 text-muted-foreground flex-wrap">
                  <span>Send</span>
                  <ArrowRight className="w-3 h-3 shrink-0" />
                  <span>Loop</span>
                  <ArrowRight className="w-3 h-3 shrink-0" />
                  <span>Return</span>
                </div>
              )}
            </div>
          </div>

          {/* Pedal Loops */}
          {loopPedals.length > 0 && (
            <>
              <div className="pt-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                  Pedal Loops
                </h4>
              </div>
              {loopPedals.map(loopPlaced => {
                const loopPedal = pedalsById[loopPlaced.pedalId] || loopPlaced.pedal;
                if (!loopPedal) return null;

                const config = getLoopConfig(loopPlaced.id);
                const isUsingLoop = config?.mode === 'loop' && (config.loopPedalIds.length > 0);

                return (
                  <div key={loopPlaced.id} className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-2">
                      <span className="text-xs font-medium truncate flex-1 min-w-0">{loopPedal.name}</span>
                      {isUsingLoop && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="p-3">
                      {loopCandidates.length > 0 ? (
                        <div className="space-y-2">
                          {loopCandidates.map(candidate => {
                            const candidatePedal = pedalsById[candidate.pedalId] || candidate.pedal;
                            if (!candidatePedal || candidate.id === loopPlaced.id) return null;

                            const isInLoop = isPedalInLoop(loopPlaced.id, candidate.id);

                            return (
                              <div key={candidate.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`loop-${loopPlaced.id}-${candidate.id}`}
                                  checked={isInLoop}
                                  onCheckedChange={() => togglePedalInLoop(loopPlaced.id, candidate.id)}
                                  className="h-4 w-4"
                                />
                                <Label
                                  htmlFor={`loop-${loopPlaced.id}-${candidate.id}`}
                                  className="text-xs flex-1 cursor-pointer truncate min-w-0"
                                >
                                  {candidatePedal.name}
                                </Label>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Add drive pedals to use loop
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {loopPedals.length === 0 && !amp?.hasEffectsLoop && (
            <div className="text-xs text-muted-foreground text-center py-4">
              <p>Standard routing.</p>
              <p className="mt-1">Add amp with FX loop for more options.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
