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
import {
  getCategoryStage,
  getStageShortLabel,
  getCategoryColor,
  type ChainStage,
} from '@/lib/constants/pedal-categories';
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

/**
 * A DETOUR IS DRAWN AS A DETOUR.
 *
 * Studio and mixer practice draws a send/return as a branch that leaves the
 * main path and rejoins it at the same point - never as one more step in the
 * sequence. The first version of this block drew every mode as one straight
 * column, so a loop read as "and then", which is the one thing a loop is not.
 * On the 4-cable method that cost the whole idea of the method: the gate's
 * loop ENCLOSES the drives and the amp's preamp, and a flat list can name all
 * four jacks in order without ever saying what contains what.
 *
 * The bracket is derived, not authored. A segment that starts at a `send`
 * opens one; the segment whose `to` is the matching `return` on the same
 * device closes it. Everything between is inside. Nesting depth carries the
 * whole story and there is no per-mode drawing to maintain.
 */

/** A device the signal passes through, and the jacks it uses on the way. */
interface FlowNode {
  kind: 'node';
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
  /** The two ends of the whole path, and the only marks that get the accent. */
  terminal: boolean;
}

/**
 * One stage of a run: the consecutive pedals doing the same job.
 *
 * A run is not an undifferentiated pile of pedals, and drawing it as one was
 * the panel's second wrong answer in a row. `PW-3, CP-1X, CS-3 · 1, CS-3 · 2,
 * OC-5, PS-` was eighteen pedals truncated mid-name; `18 pedals` replaced it
 * with something honest that still told you nothing. What a player wants from
 * a chain is its SHAPE - a wah, three compressors, five dirt boxes, a gate,
 * three EQs - which is the vocabulary every pedal-order guide is written in.
 *
 * Grouping is by CONSECUTIVE stage, in chain order, so nothing is reordered
 * for display and a stage that legitimately appears twice appears twice: a
 * gate after the drives and a looper at the end are both `utility`, and they
 * are not the same thing happening.
 */
interface FlowStage {
  stage: ChainStage;
  label: string;
  colour: string;
  names: string[];
  ids: string[];
}

/** A run of pedals between two devices, read out stage by stage. */
interface FlowRun {
  kind: 'run';
  stages: FlowStage[];
  ids: string[];
}

/** A send/return that leaves the path and rejoins it. */
interface FlowLoop {
  kind: 'loop';
  device: string;
  placedId: string | null;
  openJack: string;
  openTypes: string[];
  closeJack: string;
  closeTypes: string[];
  body: FlowItem[];
}

type FlowItem = FlowNode | FlowRun | FlowLoop;

const MODE_LABEL: Record<SignalTopology['mode'], string> = {
  standard: 'standard',
  'pedal-loop': 'pedal loop',
  '4cm': '4-cable',
};

const isSendAnchor = (a: Anchor) => (a.kind === 'pedal' ? a.jack === 'send' : a.type === 'amp_send');
const isReturnAnchor = (a: Anchor) =>
  a.kind === 'pedal' ? a.jack === 'return' : a.type === 'amp_return';
/** Two anchors are the same DEVICE when they differ only by which jack. */
const deviceKeyOf = (a: Anchor) =>
  a.kind === 'pedal' ? a.pedalId : a.type === 'guitar' ? 'guitar' : 'amp';

interface Described {
  device: string;
  jacks: string[];
  types: string[];
  placedId: string | null;
}

function buildFlow(
  topology: SignalTopology,
  amp: Amp | null,
  placedPedals: PlacedPedal[],
  pedalsById: Record<string, Pedal>,
  displayNames: Map<string, PedalDisplayName>
): FlowItem[] {
  const segs = topology.segments;

  const nameOf = (placed: PlacedPedal): string => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    return displayNameFor(displayNames, placed.id, pedal?.name ?? 'Pedal');
  };

  /** Split a run into consecutive same-stage groups, in chain order. */
  const stagesOf = (pedals: PlacedPedal[]): FlowStage[] => {
    const out: FlowStage[] = [];
    for (const placed of pedals) {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      const category = pedal?.category ?? 'utility';
      const stage = getCategoryStage(category);
      const last = out[out.length - 1];
      if (last && last.stage === stage) {
        last.names.push(nameOf(placed));
        last.ids.push(placed.id);
      } else {
        out.push({
          stage,
          label: getStageShortLabel(stage),
          colour: getCategoryColor(category),
          names: [nameOf(placed)],
          ids: [placed.id],
        });
      }
    }
    return out;
  };

  const describe = (anchor: Anchor): Described => {
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

  /*
   * WHICH SENDS ACTUALLY OPEN A BRACKET.
   *
   * Not every send is a detour. Under the 4-cable method the amp's send does
   * not go back to the amp - it goes on to the gate's return, which is the X
   * that makes the method work. So a send opens a bracket only when a later
   * segment returns to the SAME device, and only when that return lands
   * before the currently-open bracket closes. Brackets nest; they never
   * overlap. Get that wrong and 4CM opens an amp bracket that never closes.
   */
  const opens = new Map<number, number>();
  const closes = new Map<number, number>();
  const openStack: number[] = [];
  const matchingClose = (i: number): number => {
    const key = deviceKeyOf(segs[i].from);
    for (let j = i; j < segs.length; j++) {
      if (isReturnAnchor(segs[j].to) && deviceKeyOf(segs[j].to) === key) return j;
    }
    return -1;
  };
  for (let i = 0; i < segs.length; i++) {
    if (isSendAnchor(segs[i].from)) {
      const close = matchingClose(i);
      const innermost = openStack.length
        ? opens.get(openStack[openStack.length - 1]) ?? Infinity
        : Infinity;
      if (close >= 0 && close < innermost) {
        opens.set(i, close);
        closes.set(close, i);
        openStack.push(i);
      }
    }
    if (closes.has(i)) openStack.pop();
  }

  const root: FlowItem[] = [];
  const frames: { list: FlowItem[]; loop: FlowLoop | null }[] = [{ list: root, loop: null }];
  const current = () => frames[frames.length - 1].list;

  /**
   * One device, one node - however many of its jacks the path touches.
   *
   * Walks back past its OWN detour, which is what lets a hub read
   * `NS-2  IN -> OUT` with the send/return bracket sitting between the two
   * halves of that sentence. Anything else on the rail stops the search.
   */
  const pushNode = (anchor: Anchor) => {
    const d = describe(anchor);
    const list = current();
    for (let k = list.length - 1; k >= 0; k--) {
      const item = list[k];
      if (item.kind === 'loop' && item.device === d.device) continue;
      if (item.kind === 'node' && item.device === d.device) {
        for (const jack of d.jacks) if (!item.jacks.includes(jack)) item.jacks.push(jack);
        for (const type of d.types) if (!item.types.includes(type)) item.types.push(type);
        return;
      }
      break;
    }
    list.push({ kind: 'node', ...d, terminal: false });
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];

    if (opens.has(i)) {
      const d = describe(seg.from);
      const loop: FlowLoop = {
        kind: 'loop',
        device: d.device,
        placedId: d.placedId,
        openJack: d.jacks[0] ?? '',
        openTypes: d.types,
        closeJack: '',
        closeTypes: [],
        body: [],
      };
      current().push(loop);
      frames.push({ list: loop.body, loop });
    } else {
      pushNode(seg.from);
    }

    // An empty segment draws nothing: it is a single cable between two
    // devices, and the rail between them already says so.
    if (seg.pedals.length > 0) {
      current().push({
        kind: 'run',
        stages: stagesOf(seg.pedals),
        ids: seg.pedals.map((p) => p.id),
      });
    }

    if (closes.has(i)) {
      const d = describe(seg.to);
      const frame = frames.pop();
      if (frame?.loop) {
        frame.loop.closeJack = d.jacks[0] ?? '';
        frame.loop.closeTypes = d.types;
      }
    } else {
      pushNode(seg.to);
    }
  }

  const railNodes = root.filter((i): i is FlowNode => i.kind === 'node');
  if (railNodes.length > 0) {
    railNodes[0].terminal = true;
    railNodes[railNodes.length - 1].terminal = true;
  }
  return root;
}

/** Depth 0 sits on the rail; anything deeper is inside a bracket. */
const rowPad = (depth: number) => (depth === 0 ? 'pl-8 pr-3' : 'pl-3 pr-3');

function Flow({ items }: { items: FlowItem[] }) {
  return (
    <div className="relative" data-signal-flow>
      <span aria-hidden className="absolute bottom-2 left-4 top-2 w-px bg-border" />
      <FlowItems items={items} depth={0} />
    </div>
  );
}

function FlowItems({ items, depth }: { items: FlowItem[]; depth: number }) {
  return (
    <>
      {items.map((item, i) =>
        item.kind === 'run' ? (
          <RunRow key={i} run={item} depth={depth} />
        ) : item.kind === 'node' ? (
          <NodeRow key={i} node={item} depth={depth} />
        ) : (
          <LoopRow key={i} loop={item} depth={depth} />
        )
      )}
    </>
  );
}

/**
 * A device on the path.
 *
 * Handles, not wording: `verify-signal-flow` reads the device, its jacks and
 * its endpoint types off these attributes. Matching on rendered text would
 * bet on copy, which is the bet verify-modulation-switch lost.
 */
function NodeRow({ node, depth }: { node: FlowNode; depth: number }) {
  return (
    <div
      data-flow-node={node.device}
      data-flow-node-id={node.placedId ?? ''}
      data-flow-jacks={node.jacks.join('|')}
      data-flow-endpoints={node.types.join('|')}
      className={`relative flex items-baseline gap-2 py-1 ${rowPad(depth)}`}
    >
      {depth === 0 ? (
        // The same node the Chain panel puts on its spine, at the same offset.
        // Green only at the two ends: an accent on every device would spend
        // the app's one signal colour on a diagram.
        <span
          aria-hidden
          className={`absolute left-[11px] top-[7px] size-2.5 rounded-full ring-2 ring-background ${
            node.terminal ? 'bg-primary' : 'bg-muted-foreground'
          }`}
        />
      ) : (
        // Inside a bracket the mark sits ON the branch line, square, so a
        // device inside a loop never reads as a stop on the main path.
        <span
          aria-hidden
          className="absolute left-[-2.5px] top-[8px] size-[5px] bg-muted-foreground"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{node.device}</span>
      {node.jacks.length > 0 && (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {node.jacks.join(' → ')}
        </span>
      )}
    </div>
  );
}

/**
 * How many names a stage can carry before they stop being names.
 *
 * Past a handful a list is not identifying anything and the COUNT is the whole
 * answer - and at 287px it was not even a list, it was five and a half names
 * with one cut mid-word. Under it the names fit and are worth having, because
 * the group you actually interrogate is small: the two pedals in a loop, the
 * three compressors in a row. The ordered inventory lives one tab away in the
 * Chain panel, which draws it properly.
 */
const NAMES_UP_TO = 6;

function RunRow({ run, depth }: { run: FlowRun; depth: number }) {
  return (
    <>
      {run.stages.map((stage, i) => (
        <StageRow key={i} stage={stage} depth={depth} />
      ))}
    </>
  );
}

function StageRow({ stage, depth }: { stage: FlowStage; depth: number }) {
  const named = stage.names.length <= NAMES_UP_TO;
  return (
    <div
      data-flow-run={stage.ids.length}
      data-flow-stage={stage.stage}
      data-flow-pedal-ids={stage.ids.join('|')}
      className={`flex items-baseline gap-2 py-0.5 ${rowPad(depth)}`}
    >
      {/* The family rule the Chain panel already uses for the same job - an
          index mark against the label, not a chip competing with it. */}
      <span
        aria-hidden
        className="mt-px h-3 w-0.5 shrink-0 self-center"
        style={{ backgroundColor: stage.colour }}
      />
      {/* `tracking-widest` is for a micro label standing alone; this one is a
          DATA COLUMN, and the extra 0.1em was enough to truncate "DYNAMICS"
          in 52px. */}
      <span className="w-[56px] shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {stage.label}
      </span>
      {/* Wraps rather than truncates: a name cut in half is worse than a
          second line. */}
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
        {named ? stage.names.join(', ') : `${stage.ids.length} pedals`}
      </span>
      {named && stage.ids.length > 1 && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {stage.ids.length}
        </span>
      )}
    </div>
  );
}

/**
 * The detour itself: one rule down the side of everything the loop contains,
 * with a tick where the path leaves the rail and another where it rejoins.
 *
 * The device is NOT repeated on these two rows - the bracket belongs to the
 * node above it, which already carries the name. What they carry is the jack,
 * which is the half that changes.
 */
function LoopRow({ loop, depth }: { loop: FlowLoop; depth: number }) {
  return (
    <div
      data-flow-loop={loop.device}
      className={`relative border-l border-border ${depth === 0 ? 'ml-8 mr-3' : 'ml-3'}`}
    >
      {depth === 0 && (
        <>
          <span aria-hidden className="absolute -left-4 top-[11px] h-px w-4 bg-border" />
          <span aria-hidden className="absolute -left-4 bottom-[11px] h-px w-4 bg-border" />
        </>
      )}
      <JackRow loop={loop} edge="open" />
      <FlowItems items={loop.body} depth={depth + 1} />
      <JackRow loop={loop} edge="close" />
    </div>
  );
}

function JackRow({ loop, edge }: { loop: FlowLoop; edge: 'open' | 'close' }) {
  const open = edge === 'open';
  return (
    <div
      data-flow-node={loop.device}
      data-flow-node-id={loop.placedId ?? ''}
      data-flow-jacks={open ? loop.openJack : loop.closeJack}
      data-flow-endpoints={(open ? loop.openTypes : loop.closeTypes).join('|')}
      data-flow-loop-edge={edge}
      className="flex items-baseline py-1 pl-3 pr-3"
    >
      <span className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {open ? loop.openJack : loop.closeJack}
      </span>
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
          <Flow items={flow} />
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
