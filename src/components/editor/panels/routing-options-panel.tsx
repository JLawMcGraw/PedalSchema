'use client';

import { PanelHeader, Section } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  derivePedalDisplayNames,
  displayNameFor,
  type PedalDisplayName,
} from '@/lib/pedal-display-names';
import { deriveSignalTopology, type Anchor, type SignalTopology } from '@/lib/engine/topology';
import type { Amp, Pedal, PlacedPedal } from '@/types';

/**
 * How the signal is routed: the amp, the switches that shape the topology,
 * and what those settings currently add up to.
 *
 * The four panels beside this one were rebuilt first; this was the last on the
 * old chrome, and it had three faults its siblings had already been cured of:
 *
 *   DOUBLE PADDING - a `p-3 space-y-3` body with children that each added
 *   their own `px-3`, so every block sat 24px from the panel edge while the
 *   Power and Cables sections sat at 12px. Two panels one tab apart, indented
 *   differently.
 *
 *   THE SIGNAL FLOW WAS DRAWN WITH ARROW ICONS, and it was FICTION - four
 *   hardcoded lines naming a Tuner, a Looper and an NS-2 whether or not any
 *   of them were on the board. The Chain and Cables panels draw the same idea
 *   with a spine, from real state.
 *
 *   BORDERED CARDS in Pedal loops, with a Badge and a checkbox list - the
 *   card-per-thing pattern the Power panel lost seven of.
 */

// ---------------------------------------------------------------------------
// Signal flow, from the engine's own topology
// ---------------------------------------------------------------------------

/** A device the signal passes through, and the jacks it uses on the way. */
interface FlowNode {
  device: string;
  /** What the jacks are CALLED on this rig - "FX SEND", "POWER AMP IN". */
  jacks: string[];
  /**
   * What those jacks ARE, in the topology's own vocabulary. Carried alongside
   * the labels because they are not recoverable from them: a Blues Deluxe
   * calls its return "POWER AMP IN", and anything reading the words to decide
   * which jack it is guesses wrong - which `verify-signal-flow` promptly did.
   */
  types: string[];
  /** The placed pedal this node is, when it is a pedal. Null for guitar/amp. */
  placedId: string | null;
}

/** A run of pedals between two devices. */
interface FlowRun {
  names: string[];
  ids: string[];
}

type FlowStep = { node: FlowNode } | { run: FlowRun };

const MODE_LABEL: Record<SignalTopology['mode'], string> = {
  standard: 'standard',
  'pedal-loop': 'pedal loop',
  '4cm': '4-cable',
};

/**
 * Turn the engine's segments into a single walkable path.
 *
 * Segments meet at a device - the front chain ends at the amp input and the
 * amp loop starts at the amp send, which is one amp, entered and left. Drawn
 * as two separate nodes that reads as two amps; merged, it reads as what it
 * is, and the merged jack pair IN -> SEND is the whole point of the 4-cable
 * method.
 */
function buildFlow(
  topology: SignalTopology,
  amp: Amp | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  displayNames: Map<string, PedalDisplayName>
): FlowStep[] {
  const nameOf = (placed: PlacedPedal): string => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    return displayNameFor(displayNames, placed.id, pedal?.name ?? 'Pedal');
  };

  const describe = (anchor: Anchor): FlowNode => {
    if (anchor.kind === 'external') {
      switch (anchor.type) {
        case 'guitar':
          return { device: 'Guitar', jacks: [], types: ['guitar'], placedId: null };
        case 'amp_input':
          return { device: amp?.name ?? 'Amp', jacks: ['IN'], types: ['amp_input'], placedId: null };
        case 'amp_send':
          return {
            device: amp?.name ?? 'Amp',
            jacks: [amp?.sendJackLabel || 'SEND'],
            types: ['amp_send'],
            placedId: null,
          };
        case 'amp_return':
          return {
            device: amp?.name ?? 'Amp',
            jacks: [amp?.returnJackLabel || 'RETURN'],
            types: ['amp_return'],
            placedId: null,
          };
      }
    }
    const placed = placedPedals.find((p) => p.id === anchor.pedalId);
    return {
      device: placed ? nameOf(placed) : 'Pedal',
      jacks: [anchor.jack.toUpperCase()],
      types: [],
      placedId: anchor.pedalId,
    };
  };

  const steps: FlowStep[] = [];
  for (const segment of topology.segments) {
    const from = describe(segment.from);
    const previous = steps[steps.length - 1];
    // Same device as the node we just left: keep one node, add the jack.
    if (previous && 'node' in previous && previous.node.device === from.device) {
      previous.node.placedId = previous.node.placedId ?? from.placedId;
      for (const jack of from.jacks) {
        if (!previous.node.jacks.includes(jack)) previous.node.jacks.push(jack);
      }
      for (const type of from.types) {
        if (!previous.node.types.includes(type)) previous.node.types.push(type);
      }
    } else {
      steps.push({ node: from });
    }
    steps.push({
      run: { names: segment.pedals.map(nameOf), ids: segment.pedals.map((p) => p.id) },
    });
    steps.push({ node: describe(segment.to) });
  }
  return steps;
}

/**
 * The flow, on the spine the Chain and Cables panels use for the same idea.
 *
 * The endpoints are green, everything between them is not: a coloured node at
 * every device would spend the app's one accent on a diagram. Green here means
 * "this is where the signal starts and where it ends up".
 */
function Flow({ steps }: { steps: FlowStep[] }) {
  const lastNode = steps.reduce((last, step, i) => ('node' in step ? i : last), -1);

  return (
    <div className="relative" data-signal-flow>
      <span aria-hidden className="absolute bottom-2 left-[13px] top-2 w-px bg-border" />
      {steps.map((step, i) =>
        'node' in step ? (
          <div
            key={i}
            /* Handles, not wording. `verify-signal-flow` reads the device and
               jacks off these; matching on the rendered text would bet on
               copy, which is the bet verify-modulation-switch lost. */
            data-flow-node={step.node.device}
            data-flow-node-id={step.node.placedId ?? ''}
            /* Pipe-separated: an amp jack is labelled "FX SEND", so a space
               is part of a value here, not a separator. */
            data-flow-jacks={step.node.jacks.join('|')}
            data-flow-endpoints={step.node.types.join('|')}
            className="relative flex items-baseline gap-2 py-1 pl-8 pr-3"
          >
            <span
              aria-hidden
              /* The same node the Chain panel puts on its spine, at the same
                 offset. Two spines in one editor drawn with different marks
                 would read as two different diagrams of one signal path. */
              className={`absolute left-[11px] top-[7px] size-2.5 rounded-full ring-2 ring-background ${
                i === 0 || i === lastNode ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{step.node.device}</span>
            {step.node.jacks.length > 0 && (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {step.node.jacks.join(' → ')}
              </span>
            )}
          </div>
        ) : (
          <div
            key={i}
            data-flow-run={step.run.ids.length}
            data-flow-pedal-ids={step.run.ids.join('|')}
            className="flex items-baseline gap-2 py-0.5 pl-8 pr-3"
          >
            {step.run.names.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">straight through</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {step.run.names.join(', ')}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {step.run.names.length}
                </span>
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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
  setting,
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  /**
   * A stable handle for verification scripts, same reason as
   * [data-pedal-canvas] and [data-cable-legend]: finding this switch by its
   * label text is a bet on the copy. `verify-modulation-switch` made that bet
   * with `span:text-is("Modulation")` and lost it the day the row was renamed
   * to "Modulation in the loop" - and because that gate was not in
   * verify-all.sh, nothing reported the loss.
   */
  setting: string;
  label: string;
  detail: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium ${disabled ? 'text-muted-foreground' : ''}`}>{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
      </div>
      <Switch
        data-setting={setting}
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

  const displayNames = useMemo(
    () => derivePedalDisplayNames(placedPedals, pedalsById),
    [placedPedals, pedalsById]
  );

  /*
   * THE SAME FUNCTION THE CABLES COME FROM.
   *
   * What this panel drew before was a hardcoded sketch - `Guitar -> Tuner ->
   * NS-2 IN` whatever was actually on the board - so the diagram and the
   * wiring could disagree and nothing would report it. deriveSignalTopology is
   * the single source of truth three consumers already share (cable
   * generation, the routing cost function, the placer); this is the fourth. It
   * sorts and partitions, and does no pathfinding, so it is cheap enough to
   * memoise here rather than widen the derived store for one panel.
   */
  const topology = useMemo(
    () =>
      deriveSignalTopology(
        placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod, routingConfig
      ),
    [placedPedals, pedalsById, amp, useEffectsLoop, use4CableMethod, routingConfig]
  );

  const flow = useMemo(
    () => buildFlow(topology, amp, placedPedals, pedalsById, displayNames),
    [topology, amp, placedPedals, pedalsById, displayNames]
  );

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
    <div className="flex h-full w-full flex-col overflow-hidden">
      <PanelHeader title="Routing" meta={MODE_LABEL[topology.mode]} />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* The amp is the one non-boolean control here, so it leads. Its FX
            loop is what every switch below depends on, and it belongs in the
            section's meta slot rather than a sentence underneath: it is a
            property of the amp, not advice. */}
        <Section
          label="Amp"
          meta={amp ? (amp.hasEffectsLoop ? `${amp.loopType || 'serial'} fx loop` : 'no fx loop') : undefined}
        >
          <Select value={amp?.id || 'none'} onValueChange={handleAmpChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select amp..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No amp</SelectItem>
              {availableAmps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{a.manufacturer} {a.name}</span>
                    {a.hasEffectsLoop && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        fx
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        {/* The panel's OUTPUT: what the settings below currently add up to,
            read out of the same topology the cables are generated from. */}
        <Section label="Signal flow">
          <Flow steps={flow} />
        </Section>

        <Section label="Options" flush>
          <div className="divide-y">
            <SettingRow
              setting="effects-loop"
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
                setting="modulation-in-loop"
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
                setting="four-cable-method"
                label="4-cable method"
                checked={use4CableMethod}
                onChange={setUse4CableMethod}
                detail={
                  use4CableMethod
                    ? 'The gate spans the preamp: drives inside it, time effects after'
                    : 'Standard routing, the gate inline'
                }
              />
            )}

            <SettingRow
              setting="allow-rotation"
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
        </Section>

        {/* Pedal loops. One hub per section body, its members as a divided
            list - the same rhythm as Options above, control on the right. */}
        {loopPedals.map((loopPlaced) => {
          const loopPedal = pedalsById[loopPlaced.pedalId] || loopPlaced.pedal;
          if (!loopPedal) return null;

          const config = getLoopConfig(loopPlaced.id);
          const inLoop = config?.mode === 'loop' ? config.loopPedalIds.length : 0;
          const members = loopCandidates.filter((c) => c.id !== loopPlaced.id);

          return (
            <Section
              key={loopPlaced.id}
              label={`${displayNameFor(displayNames, loopPlaced.id, loopPedal.name)} loop`}
              meta={inLoop > 0 ? `${inLoop} in loop` : 'empty'}
              flush
            >
              {members.length > 0 ? (
                <div className="divide-y">
                  {members.map((candidate) => {
                    const candidatePedal = pedalsById[candidate.pedalId] || candidate.pedal;
                    if (!candidatePedal) return null;
                    const checked = isPedalInLoop(loopPlaced.id, candidate.id);
                    return (
                      <label
                        key={candidate.id}
                        htmlFor={`loop-${loopPlaced.id}-${candidate.id}`}
                        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {displayNameFor(displayNames, candidate.id, candidatePedal.name)}
                        </span>
                        <Checkbox
                          id={`loop-${loopPlaced.id}-${candidate.id}`}
                          data-loop-member={candidate.id}
                          checked={checked}
                          onCheckedChange={() => togglePedalInLoop(loopPlaced.id, candidate.id)}
                          className="size-3.5 shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-1 text-[11px] text-muted-foreground">
                  Nothing to put in it yet - add a drive pedal.
                </p>
              )}
            </Section>
          );
        })}

        {loopPedals.length === 0 && !amp?.hasEffectsLoop && (
          <p className="px-3 py-3 text-[11px] leading-snug text-muted-foreground">
            Standard routing. An amp with an FX loop, or a pedal with send and
            return jacks, opens up the rest.
          </p>
        )}
      </div>
    </div>
  );
}
