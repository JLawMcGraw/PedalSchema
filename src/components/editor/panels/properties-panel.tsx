'use client';

import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { useEditorStore } from '@/store/editor-store';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { getCategoryColor, getCategoryLabel } from '@/lib/constants/pedal-categories';
import { formatCurrentDraw, formatDimensions, formatVoltage } from '@/lib/format-pedal';
import { hasTopOrBottomSignalJack, isFootSwept } from '@/lib/engine/layout/rotation-eligibility';
import { BoardDetails } from './board-details';
import type { ChainLocation } from '@/types';

export function PropertiesPanel() {
  const { selectedPedalId } = useEditorStore(
    useShallow((s) => ({ selectedPedalId: s.selectedPedalId }))
  );
  const {
    placedPedals,
    pedalsById,
    removePedal,
    rotatePedal,
    setRotationLocked,
    updatePedalLocation,
    setUseLoop,
    amp,
    useEffectsLoop,
  } = useConfigurationStore(
    useShallow((s) => ({ placedPedals: s.placedPedals, pedalsById: s.pedalsById, removePedal: s.removePedal, rotatePedal: s.rotatePedal, setRotationLocked: s.setRotationLocked, updatePedalLocation: s.updatePedalLocation, setUseLoop: s.setUseLoop, amp: s.amp, useEffectsLoop: s.useEffectsLoop }))
  );
  const { collisions } = useDerivedConfiguration((d) => ({ collisions: d.collisions }));

  const selectedPlaced = placedPedals.find((p) => p.id === selectedPedalId);
  const selectedPedal = selectedPlaced
    ? pedalsById[selectedPlaced.pedalId] || selectedPlaced.pedal
    : null;

  // Nothing selected is not an empty state - it is when the BOARD is what you
  // are looking at. The panel used to spend a whole column on the sentence
  // "Select a pedal to view properties"; the board's own name and description
  // had no UI anywhere in the app.
  if (!selectedPlaced || !selectedPedal) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <div className="px-3 py-2 border-b shrink-0">
          <h3 className="font-semibold text-sm">Board</h3>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <BoardDetails />
          <p className="px-3 pb-3 text-muted-foreground text-xs">
            Select a pedal to edit its properties.
          </p>
        </div>
      </div>
    );
  }

  const hasCollision = collisions.some((c) => c.pedalIds.includes(selectedPlaced.id));

  // What the orientation controls should say. Foot-swept pedals are refused by
  // the optimizer outright, so offering a lock for them would imply that
  // unlocking does something.
  const footSwept = isFootSwept(selectedPedal);
  const canFaceDifferently = hasTopOrBottomSignalJack(selectedPedal);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Properties</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Identity. Was a bordered card with a filled header bar spending
            three stacked lines on a name, a manufacturer and a badge. */}
        <div className="flex items-center gap-2 px-3 py-3">
          <span
            aria-hidden
            className="h-8 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: getCategoryColor(selectedPedal.category) }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{selectedPedal.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {selectedPedal.manufacturer} &middot; {getCategoryLabel(selectedPedal.category)}
            </p>
          </div>
        </div>

        {hasCollision && (
          <p className="mx-3 mb-3 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            Overlaps another pedal
          </p>
        )}

        {/* Specs. A definition list, not a card - these are read, never set. */}
        <dl className="divide-y border-y text-xs">
          <Spec label="Size">
            {formatDimensions(
              selectedPedal.widthInches,
              selectedPedal.depthInches,
              selectedPedal.heightInches
            )}
          </Spec>
          <Spec label="Power">
            {formatVoltage(selectedPedal.voltage)} / {formatCurrentDraw(selectedPedal.currentMa)}
          </Spec>
          <Spec label="Position">
            X {selectedPlaced.xInches.toFixed(1)}&quot; &middot; Y {selectedPlaced.yInches.toFixed(1)}&quot;
          </Spec>
          <Spec label="Chain">{selectedPlaced.chainPosition}</Spec>
        </dl>

        {amp?.hasEffectsLoop && useEffectsLoop && (
          <div className="px-3 py-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Signal location
            </label>
            {/*
              `flexible` WAS MISSING FROM THIS LIST, and it is the default: 13
              of the 22 pedals on the test board carry it. Radix renders no
              value when the current one matches no item, so for the majority
              of pedals this control was a blank box - and shadcn's trigger is
              `w-fit`, so it collapsed to a bare caret and did not even look
              like a value was missing.

              It routes as front-of-amp today; the difference is that nobody
              chose it, so the chain rules stay free to move the pedal.
            */}
            <Select
              value={selectedPlaced.location}
              onValueChange={(value) => updatePedalLocation(selectedPlaced.id, value as ChainLocation)}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flexible">Let the chain rules decide</SelectItem>
                <SelectItem value="front_of_amp">Front of amp</SelectItem>
                <SelectItem value="effects_loop">Effects loop</SelectItem>
                {selectedPedal.supports4Cable && (
                  <SelectItem value="four_cable_hub">4-cable hub</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="divide-y border-y">
          {selectedPedal.supports4Cable && (
            <PedalSetting
              label="Use send/return loop"
              detail={
                selectedPlaced.useLoop
                  ? "Drive pedals route through this pedal's loop"
                  : 'Only the input and output jacks are used'
              }
              checked={selectedPlaced.useLoop}
              onChange={(checked) => setUseLoop(selectedPlaced.id, checked)}
            />
          )}

          {!footSwept && (
            <PedalSetting
              label="Keep facing forward"
              detail={
                selectedPlaced.rotationLocked
                  ? 'Optimize will not turn this pedal.'
                  : canFaceDifferently
                    ? 'Optimize may turn it when that shortens the cable run.'
                    : 'Its signal jacks are on the sides, so turning it would only lengthen the cables.'
              }
              checked={selectedPlaced.rotationLocked ?? false}
              onChange={(checked) => setRotationLocked(selectedPlaced.id, checked)}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 text-xs"
            onClick={() => rotatePedal(selectedPlaced.id)}
          >
            Rotate 90&deg;
          </Button>
          {/* A quiet text button. A full-width red slab made deleting the
              loudest thing in the panel, which is the wrong emphasis for the
              one action you cannot undo by looking at it. */}
          <button
            className="shrink-0 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
            onClick={() => removePedal(selectedPlaced.id)}
          >
            Remove
          </button>
        </div>

        {footSwept && (
          <p className="px-3 pb-3 text-[11px] text-muted-foreground">
            A treadle is played by rocking it, so Optimize never turns it.
          </p>
        )}

        {/*
          THE BOARD IS ALWAYS REACHABLE.

          It used to be an either/or: selecting a pedal replaced the board
          section outright, so the board's name, description and publish
          control could only be found by deselecting - and nothing on screen
          said so. It sits below the pedal now, which also uses the ~300px this
          panel was leaving empty.
        */}
        <div className="mt-2 border-t pt-3">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Board
          </p>
          <BoardDetails />
        </div>
      </div>
    </div>
  );
}

/** One read-only spec row. */
function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/** One switch, matching the Routing panel's settings rows. */
function PedalSetting({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
      </div>
      <Switch className="mt-0.5 shrink-0" checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
