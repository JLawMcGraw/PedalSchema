'use client';

import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { describePowerSummary, TYPICAL_OUTPUT_MA } from '@/lib/engine/power';

export function PowerPanel() {
  const { power } = useDerivedConfiguration((d) => ({ power: d.power }));
  const { placedPedals, pedalsById } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById }))
  );
  const selectPedal = useEditorStore((s) => s.selectPedal);

  if (power.pedalCount === 0) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <div className="px-3 py-2 border-b shrink-0">
          <h3 className="font-semibold text-sm">Power</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs p-4 text-center">
          Add pedals to see what they draw
        </div>
      </div>
    );
  }

  const hasUnknown = power.unknown.length > 0;

  // Every pedal that draws current, biggest first - the order you would plan a
  // supply in.
  const draws = placedPedals
    .map((placed) => {
      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      return pedal ? { id: placed.id, name: pedal.name, ma: pedal.currentMa ?? null } : null;
    })
    .filter((d): d is { id: string; name: string; ma: number | null } => d !== null)
    .sort((a, b) => (b.ma ?? -1) - (a.ma ?? -1));

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0">
        <h3 className="font-semibold text-sm">Power</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Headline. "At least" whenever a pedal's draw is unrecorded - a bare
            number would be read as the whole story. */}
        <div className="border rounded-lg p-3">
          {/* The glanceable number carries its own qualifier. A separate "at
              least" badge beside a bare 301 repeated what the sentence below
              already said, and a reader who takes in only the numeral has to
              get the right idea from it alone. */}
          <div className="flex items-baseline gap-1.5">
            {hasUnknown && (
              <span className="text-2xl font-semibold text-muted-foreground" aria-hidden>
                ≥
              </span>
            )}
            <span className="text-2xl font-semibold tabular-nums">{power.knownTotalMa}</span>
            <span className="text-sm text-muted-foreground">mA</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {describePowerSummary(power)}
          </p>
        </div>

        {/* Voltage split, only when it can actually bite */}
        {power.byVoltage.length > 1 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium">By voltage</span>
            </div>
            <div className="p-3 space-y-1">
              {power.byVoltage.map((g) => (
                <div key={g.voltage} className="flex justify-between text-xs">
                  <span>{g.voltage}V</span>
                  <span className="text-muted-foreground tabular-nums">
                    {g.knownTotalMa}mA / {g.pedalCount} pedal{g.pedalCount === 1 ? '' : 's'}
                    {g.unknownCount > 0 && ` (${g.unknownCount} unknown)`}
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                Pedals on different voltages cannot share an output.
              </p>
            </div>
          </div>
        )}

        {power.highDraw.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium">Needs its own output</span>
            </div>
            <div className="p-3 space-y-1">
              {power.highDraw.map((h) => (
                <button
                  key={h.placedPedalId}
                  onClick={() => selectPedal(h.placedPedalId)}
                  className="flex justify-between w-full text-xs hover:text-primary"
                >
                  <span>{h.name}</span>
                  <span className="tabular-nums">{h.currentMa}mA</span>
                </button>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                More than a typical {TYPICAL_OUTPUT_MA}mA output gives, so each of these
                wants an output to itself.
              </p>
            </div>
          </div>
        )}

        {hasUnknown && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium">Draw not recorded</span>
            </div>
            <div className="p-3 space-y-1">
              {power.unknown.map((u) => (
                <button
                  key={u.placedPedalId}
                  onClick={() => selectPedal(u.placedPedalId)}
                  className="block w-full text-left text-xs hover:text-primary"
                >
                  {u.name}
                </button>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                Not counted above. The total is a floor until these are known -
                it is not that they draw nothing.
              </p>
            </div>
          </div>
        )}

        {/* Per-pedal, biggest first */}
        <div className="border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/50 border-b">
            <span className="text-xs font-medium">Every pedal</span>
          </div>
          <div className="p-3 space-y-1">
            {draws.map((d) => (
              <button
                key={d.id}
                onClick={() => selectPedal(d.id)}
                className="flex justify-between w-full text-xs hover:text-primary"
              >
                <span className="truncate pr-2">{d.name}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {d.ma === null ? 'unknown' : `${d.ma}mA`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
