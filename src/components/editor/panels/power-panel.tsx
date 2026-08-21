'use client';

import { useMemo } from 'react';
import { PanelHeader, Section } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { describePowerSummary, describePowerPlan, TYPICAL_OUTPUT_MA } from '@/lib/engine/power';
import { derivePedalDisplayNames, displayNameFor } from '@/lib/pedal-display-names';

export function PowerPanel() {
  const { power, powerPlan } = useDerivedConfiguration((d) => ({
    power: d.power,
    powerPlan: d.powerPlan,
  }));
  const {
    placedPedals, pedalsById, powerSupply, powerSupplies,
    setPowerSupply, assignPedalToOutput,
  } = useConfigurationStore(
    useShallow((s) => ({
      placedPedals: s.placedPedals,
      pedalsById: s.pedalsById,
      powerSupply: s.powerSupply,
      powerSupplies: s.powerSupplies,
      setPowerSupply: s.setPowerSupply,
      assignPedalToOutput: s.assignPedalToOutput,
    }))
  );
  const selectPedal = useEditorStore((s) => s.selectPedal);

  /*
   * The fourth call site for this, found by looking at the panel: two CS-3s
   * listed as "CS-3" and "CS-3", eleven rows apart, both wanting an output
   * assignment. Deciding which one to plug where is impossible when they have
   * the same name. Same ordinals as the Chain panel and the Cables list,
   * because they all come from chain position.
   *
   * ABOVE THE EMPTY-BOARD RETURN, and it has to be. It sat below, so this
   * component called three hooks on an empty board and four on any other -
   * and dropping the FIRST pedal onto a board therefore changed the hook
   * count between two renders of a mounted panel, which is the
   * "Rendered more hooks than during the previous render" crash. An empty
   * board makes it memoise an empty map, which costs nothing.
   */
  const displayNames = useMemo(
    () => derivePedalDisplayNames(placedPedals, pedalsById),
    [placedPedals, pedalsById]
  );

  if (power.pedalCount === 0) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <Header count={0} />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs p-4 text-center">
          Add pedals to see what they draw
        </div>
      </div>
    );
  }

  const hasUnknown = power.unknown.length > 0;
  const highDrawIds = new Set(power.highDraw.map((h) => h.placedPedalId));

  // Every pedal that draws current, biggest first - the order you would plan a
  // supply in.
  const draws = placedPedals
    .map((placed) => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      return pedal
        ? {
            id: placed.id,
            name: displayNameFor(displayNames, placed.id, pedal.name),
            ma: pedal.currentMa ?? null,
            outputId: placed.powerOutputId ?? null,
          }
        : null;
    })
    .filter(
      (d): d is { id: string; name: string; ma: number | null; outputId: string | null } =>
        d !== null
    )
    .sort((a, b) => (b.ma ?? -1) - (a.ma ?? -1));

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <Header count={power.pedalCount} />

      {/* min-h-0 matches the four sibling panels. It is NOT a bug fix: a flex
          item that scrolls already has an automatic minimum size of 0, and
          this panel was measured unclipped at every viewport from 1920x1080
          down to 1280x560. It is here so the five panels read the same. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* THE HEADLINE. The one place §3.1 macro-typography earns its keep in
            a 287px panel: the number leads and its label goes to the micro
            register. "At least" whenever a draw is unrecorded - a bare number
            would be read as the whole story. */}
        <div className="border-b px-3 py-3">
          <div className="flex items-baseline gap-1.5">
            {hasUnknown && (
              <span className="text-2xl font-semibold text-muted-foreground" aria-hidden>
                ≥
              </span>
            )}
            <span className="text-2xl font-semibold tabular-nums">{power.knownTotalMa}</span>
            <span className="text-sm text-muted-foreground">mA</span>
          </div>
          {/* Only when it ADDS something. The all-known sentence reads
              "1586mA across 22 pedals", which is the numeral above it and the
              count in the header, said a third time. */}
          {hasUnknown && (
            <p className="text-xs text-muted-foreground mt-1">{describePowerSummary(power)}</p>
          )}
        </div>

        {/* Supply. Choosing one moves this panel from "what does the board
            want" to "will this brick give it", which are different questions -
            a 500mA board on a 2000mA supply still fails if six pedals share
            one 100mA output. Kept high in the panel on the owner's call. */}
        <Section label="Supply">
          <select
            aria-label="Power supply"
            className="w-full text-xs border rounded-none px-2 py-1 bg-background"
            value={powerSupply?.id ?? ''}
            onChange={(e) =>
              setPowerSupply(powerSupplies.find((s) => s.id === e.target.value) ?? null)
            }
          >
            <option value="">No supply chosen - showing demand only</option>
            {powerSupplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.manufacturer} {s.name} ({s.outputs.length} outputs)
              </option>
            ))}
          </select>
          {powerPlan && (
            <p className="pt-2 text-xs text-muted-foreground">{describePowerPlan(powerPlan)}</p>
          )}
        </Section>

        {/* Per OUTPUT, because that is where supplies actually fail. */}
        {powerPlan && (
          <Section label="Outputs" count={powerPlan.outputs.length}>
            <div className="space-y-2">
              {powerPlan.outputs.map((load) => {
                const problem = load.overCapacity || load.voltageMismatch.length > 0;
                return (
                  <div key={load.output.id} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className={problem ? 'font-medium text-destructive' : 'font-medium'}>
                        {load.output.label}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {load.knownDrawMa}
                        {load.unknownCount > 0 && '+?'}
                        {' / '}
                        {load.effectiveRatedMa}mA
                      </span>
                    </div>
                    {load.pedals.length > 0 && (
                      <div className="pl-2 pt-0.5 text-muted-foreground">
                        {load.pedals.map((p) => p.name).join(', ')}
                      </div>
                    )}
                    {load.overCapacity && (
                      <div className="pl-2 text-destructive">
                        Over by {load.knownDrawMa - load.effectiveRatedMa}mA.
                      </div>
                    )}
                    {/* An unknown draw makes headroom unknowable, not large.
                        Saying "fine" here is the failure this module exists to
                        prevent. */}
                    {!load.overCapacity && load.unknownCount > 0 && (
                      <div className="pl-2 text-muted-foreground">
                        Headroom unknown - {load.unknownCount} pedal
                        {load.unknownCount === 1 ? '' : 's'} here with no recorded draw.
                      </div>
                    )}
                    {load.voltageMismatch.length > 0 && (
                      <div className="pl-2 text-destructive">
                        Wrong voltage for {load.voltageMismatch.map((p) => p.name).join(', ')}.
                      </div>
                    )}
                  </div>
                );
              })}
              {powerPlan.unassigned.length > 0 && (
                <p className="border-t pt-1 text-xs text-muted-foreground">
                  {powerPlan.unassigned.length} pedal
                  {powerPlan.unassigned.length === 1 ? '' : 's'} not plugged into anything yet.
                </p>
              )}
            </div>
          </Section>
        )}

        {/* Voltage split, only when it can actually bite */}
        {power.byVoltage.length > 1 && (
          <Section label="By voltage" count={power.byVoltage.length}>
            {power.byVoltage.map((g) => (
              <div key={g.voltage} className="flex justify-between text-xs">
                <span>{g.voltage}V</span>
                <span className="text-muted-foreground tabular-nums">
                  {g.knownTotalMa}mA / {g.pedalCount} pedal{g.pedalCount === 1 ? '' : 's'}
                  {g.unknownCount > 0 && ` (${g.unknownCount} unknown)`}
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Pedals on different voltages cannot share an output.
            </p>
          </Section>
        )}

        {hasUnknown && (
          <Section label="Draw not recorded" count={power.unknown.length}>
            {power.unknown.map((u) => (
              <button
                key={u.placedPedalId}
                onClick={() => selectPedal(u.placedPedalId)}
                className="block w-full text-left text-xs hover:text-primary"
              >
                {u.name}
              </button>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Not counted above. The total is a floor until these are known -
              it is not that they draw nothing.
            </p>
          </Section>
        )}

        {/*
          EVERY PEDAL, and the high-draw ones marked in place.
          "Needs its own output" used to be a section of its own listing
          Timeline 300, BigSky 300, EQ-200 170, IR-2 160 - which are rows one
          to four of THIS list, because it is sorted by draw descending. The
          same four pedals, twice on one screen, eleven rows apart.
        */}
        <Section label="Every pedal" count={draws.length}>
          <div className="space-y-1">
            {draws.map((d) => (
              <div key={d.id} className="space-y-0.5">
                <button
                  onClick={() => selectPedal(d.id)}
                  className="flex w-full items-baseline justify-between gap-2 text-xs hover:text-primary"
                >
                  <span className="min-w-0 truncate pr-1">{d.name}</span>
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    {highDrawIds.has(d.id) && (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-warning">
                        own
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {d.ma === null ? 'unknown' : `${d.ma}mA`}
                    </span>
                  </span>
                </button>
                {/* Assignment lives beside the draw, because deciding where a
                    pedal plugs in is a question about its current. */}
                {powerSupply && (
                  <select
                    aria-label={`Output for ${d.name}`}
                    className="w-full text-xs border rounded-none px-1.5 py-0.5 bg-background text-muted-foreground"
                    value={d.outputId ?? ''}
                    onChange={(e) => assignPedalToOutput(d.id, e.target.value || null)}
                  >
                    <option value="">Not assigned</option>
                    {powerSupply.outputs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label} - {o.voltage}V {o.ratedMa}mA
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          {power.highDraw.length > 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              <span className="font-mono text-[10px] uppercase tracking-widest text-warning">own</span>
              {' '}- more than a typical {TYPICAL_OUTPUT_MA}mA output gives, so each of these
              wants an output to itself.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <PanelHeader
      title="Power"
      meta={count > 0 ? `${count} pedal${count === 1 ? '' : 's'}` : undefined}
    />
  );
}
