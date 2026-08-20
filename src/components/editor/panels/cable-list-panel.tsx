'use client';

import { PANEL_TITLE } from '@/components/editor/panels/panel-chrome';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import {
  generateCableList,
  generateEnhancedCableList,
  calculateCableSummary,
  type EnhancedCable,
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

/**
 * Cables and wiring.
 *
 * THE ANSWER GOES ABOVE THE DOCUMENT. You come to this panel to find out what
 * to buy; the wiring order is what you work from once you have it. The
 * shopping list was underneath twenty-four rows, which is the same fault the
 * Chain panel had when its warnings rendered after twenty-two pedals.
 *
 * Three things went, and none of them were carrying their weight:
 *
 *   THE NUMBER COLUMN - `1, 2, 2b ... 2t, 3, 4, 5, 5b, 5c, 6` was 24 labels
 *   encoding four groups, and the sub-letters restated the row order.
 *
 *   THE SIGNAL FLOW DIAGRAM - `Guitar -> PW-3 -> CP-1X -> ...` as a run-on
 *   mono paragraph. It said what the list above it said, and what the Chain
 *   panel says properly with a spine. It was also the last raw amber left in
 *   the panel.
 *
 *   THE UNBROKEN LIST - the boundary between the front of the amp and the
 *   effects loop is the biggest structural transition on a board, and it was
 *   rendered as just another row.
 */
export function CableListPanel() {
  const { placedPedals, pedalsById } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById }))
  );
  const { cables } = useDerivedConfiguration((d) => ({ cables: d.cables }));

  const cableConnections = useMemo(
    () =>
      cables.map((c) => ({
        fromType: c.fromType,
        fromPedalId: c.fromPedalId,
        fromJackType: c.fromJack,
        toType: c.toType,
        toPedalId: c.toPedalId,
        toJackType: c.toJack,
        calculatedLengthInches: c.calculatedLengthInches || 0,
        cableType: c.cableType,
        sortOrder: c.sortOrder,
      })),
    [cables]
  );

  const enhancedCables = useMemo(
    () => generateEnhancedCableList(cableConnections, placedPedals, pedalsById),
    [cableConnections, placedPedals, pedalsById]
  );
  const summary = useMemo(() => calculateCableSummary(cableConnections), [cableConnections]);
  const cableList = useMemo(() => generateCableList(cableConnections), [cableConnections]);

  const front = enhancedCables.filter((c) => c.segment === 'front');
  const loop = enhancedCables.filter((c) => c.segment === 'loop');

  if (cables.length === 0) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <Header count={0} />
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          Add pedals to see cable requirements
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Header count={cables.length} />

      {/* WHAT TO BUY, first. Four lines, and the reason anyone opens this. */}
      <div className="shrink-0 border-b">
        <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
          <h4 className={PANEL_TITLE}>What to buy</h4>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {summary.totalCount}
          </span>
        </div>
        <ul className="px-3 pb-2 pt-1">
          {cableList.map((item, index) => (
            <li
              key={`${item.cableType}-${item.lengthInches}-${index}`}
              className="flex items-baseline justify-between gap-2 py-0.5"
            >
              <span className="min-w-0 truncate text-xs">
                {item.lengthDisplay}{' '}
                <span className="text-muted-foreground">
                  {item.cableType === 'patch' ? 'patch' : 'instrument'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">{item.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Run label="Front of amp" cables={front} />
        {loop.length > 0 && <Run label="Effects loop" cables={loop} tone="loop" />}
      </div>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
      <h3 className={PANEL_TITLE}>Cables &amp; wiring</h3>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {count} connection{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

/**
 * One continuous run of cable, front of amp or through the loop.
 *
 * The spine is the same mark the Chain panel uses for the same idea - these
 * rows are one signal path, in order - which is what the old sub-index letters
 * were reaching for and failing to say.
 */
function Run({
  label,
  cables,
  tone = 'signal',
}: {
  label: string;
  cables: EnhancedCable[];
  tone?: 'signal' | 'loop';
}) {
  if (cables.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-1.5">
        <h4 className={PANEL_TITLE}>{label}</h4>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {cables.length}
        </span>
      </div>
      <div className="relative">
        <span
          aria-hidden
          className={`absolute bottom-2 left-3 top-2 w-px ${
            tone === 'loop' ? 'bg-muted-foreground/30' : 'bg-border'
          }`}
        />
        <div className="divide-y">
          {cables.map((cable, index) => (
            <div
              key={index}
              className="flex items-baseline gap-2 py-1.5 pl-6 pr-3 hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 text-xs leading-snug">
                <span className="font-medium">{plainEnd(cable.fromLabel, 'OUTPUT')}</span>
                <span className="mx-1 text-muted-foreground">&rarr;</span>
                <span className="font-medium">{plainEnd(cable.toLabel, 'INPUT')}</span>
              </span>
              {/* LENGTH LEADS. It is the actionable half - seventeen of the
                  twenty-four runs on the test board are the same 6" patch, so
                  the ones that are not are the whole point of reading this. */}
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                {formatShort(cable)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Patch (6")" -> `6"`. The type is already implied by the run it sits in. */
function formatShort(cable: EnhancedCable): string {
  const m = cable.cableTypeLabel.match(/\(([^)]+)\)/);
  return m ? m[1] : `${cable.lengthInches}"`;
}
