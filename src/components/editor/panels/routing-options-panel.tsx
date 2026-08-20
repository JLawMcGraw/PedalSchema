'use client';

import { PANEL_TITLE } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
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
import { ArrowRight } from '@phosphor-icons/react';
import type { Amp } from '@/types';

/**
 * One setting: a label, its switch, and the sentence that says what the switch
 * currently means.
 *
 * This replaces a bordered card with a filled header bar per setting. Six
 * booleans were costing about 90px each - a header rule, a background, a body
 * pad - and reading as six unrelated boxes rather than one group of settings.
 * A divided list says "these belong together" and halves the height.
 */
function SettingRow({
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  detail: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium ${disabled ? 'text-muted-foreground' : ''}`}>{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
      </div>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

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
    use4CableMethod,
    setUse4CableMethod,
    modulationInLoop,
    setModulationInLoop,
    setAllowRotation,
  } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById, routingConfig: s.routingConfig, togglePedalInLoop: s.togglePedalInLoop, amp: s.amp, setAmp: s.setAmp, useEffectsLoop: s.useEffectsLoop, setUseEffectsLoop: s.setUseEffectsLoop, use4CableMethod: s.use4CableMethod, setUse4CableMethod: s.setUse4CableMethod, modulationInLoop: s.modulationInLoop, setModulationInLoop: s.setModulationInLoop, setAllowRotation: s.setAllowRotation }))
  );

  // Absent means allowed - the eligibility guard is what makes it safe
  const allowRotation = routingConfig.allowRotation ?? true;

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

  // Check if there's a 4-cable capable pedal (like NS-2) on the board
  const has4CablePedal = useMemo(() => {
    return placedPedals.some(placed => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      return pedal?.supports4Cable === true;
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
        <h3 className={PANEL_TITLE}>Routing</h3>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-3 space-y-3">
          {/* The amp is the one non-boolean here, so it leads and is not a
              switch row. */}
          <div className="px-3 pt-1 pb-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Amp
            </label>
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
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {amp.hasEffectsLoop ? `${amp.loopType || 'Serial'} FX loop` : 'No FX loop'}
              </p>
            )}
          </div>

          <div className="divide-y border-y">
            <SettingRow
              label="Effects loop"
              checked={useEffectsLoop}
              onChange={setUseEffectsLoop}
              disabled={!amp?.hasEffectsLoop}
              detail={
                !amp
                  ? 'Select an amp first'
                  : !amp.hasEffectsLoop
                  ? 'This amp has no FX loop'
                  : useEffectsLoop
                  ? 'Time effects route through the FX loop'
                  : 'All pedals run in front'
              }
            />

            {useEffectsLoop && amp?.hasEffectsLoop && (
              <SettingRow
                label="Modulation in the loop"
                checked={modulationInLoop}
                onChange={setModulationInLoop}
                detail={
                  modulationInLoop
                    ? 'Clean: chorus, flanger and phaser sit in the FX loop'
                    : 'Dirty: modulation hits the preamp first'
                }
              />
            )}

            {useEffectsLoop && amp?.hasEffectsLoop && has4CablePedal && (
              <SettingRow
                label="4-cable method"
                checked={use4CableMethod}
                onChange={setUse4CableMethod}
                detail={
                  use4CableMethod
                    ? 'The NS-2 gates the drives and spans the loop'
                    : 'Standard routing, NS-2 inline'
                }
              />
            )}

            <SettingRow
              label="Optimize can rotate pedals"
              checked={allowRotation}
              onChange={setAllowRotation}
              detail={
                allowRotation
                  ? 'Only when it shortens the wiring, and never a large pedal or a treadle - you still have to reach the footswitch.'
                  : 'Optimize leaves every pedal facing forward. You can still rotate one yourself from its properties.'
              }
            />
          </div>

          {/* Signal flow is the panel's OUTPUT - what the settings above add up
              to - so it gets a section label rather than another card that
              looks like something you can set. */}
          <div className="px-3 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Signal flow
            </p>
            <div className="space-y-1 text-xs">
              {use4CableMethod && has4CablePedal ? (
                // 4-Cable Method flow
                <>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium">Guitar</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span>Tuner</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-orange-500">NS-2 IN</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground flex-wrap">
                    <span className="text-orange-500">Send</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>Drives</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="font-medium text-foreground">Amp IN</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground flex-wrap">
                    <span>Amp Send</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="text-orange-500">NS-2 Return</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground flex-wrap">
                    <span className="text-orange-500">NS-2 Out</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>FX</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>Looper</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="font-medium text-foreground">Amp Return</span>
                  </div>
                </>
              ) : (
                // Standard flow
                <>
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
                </>
              )}
            </div>
          </div>

          {/* Pedal Loops */}
          {loopPedals.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Pedal loops
              </p>
              {loopPedals.map(loopPlaced => {
                const loopPedal = pedalsById[loopPlaced.pedalId] || loopPlaced.pedal;
                if (!loopPedal) return null;

                const config = getLoopConfig(loopPlaced.id);
                const isUsingLoop = config?.mode === 'loop' && (config.loopPedalIds.length > 0);

                return (
                  <div key={loopPlaced.id} className="border-y">
                    <div className="flex items-center gap-2 px-3 py-2">
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
