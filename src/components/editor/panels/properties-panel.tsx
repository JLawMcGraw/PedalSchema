'use client';

import { useConfigurationStore } from '@/store/configuration-store';
import { useEditorStore } from '@/store/editor-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCategoryColor, getCategoryLabel } from '@/lib/constants/pedal-categories';
import type { ChainLocation } from '@/types';

export function PropertiesPanel() {
  const { selectedPedalId } = useEditorStore();
  const {
    placedPedals,
    pedalsById,
    removePedal,
    rotatePedal,
    updatePedalLocation,
    amp,
    useEffectsLoop,
    collisions,
  } = useConfigurationStore();

  const selectedPlaced = placedPedals.find((p) => p.id === selectedPedalId);
  const selectedPedal = selectedPlaced
    ? pedalsById[selectedPlaced.pedalId] || selectedPlaced.pedal
    : null;

  if (!selectedPlaced || !selectedPedal) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <div className="px-2 py-2 border-b shrink-0">
          <h3 className="font-semibold text-sm">Properties</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs p-4 text-center">
          Select a pedal to view properties
        </div>
      </div>
    );
  }

  const hasCollision = collisions.some((c) => c.pedalIds.includes(selectedPlaced.id));

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="px-2 py-2 border-b shrink-0">
        <h3 className="font-semibold text-sm">Properties</h3>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-2 space-y-3">
          {/* Pedal info */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-2 py-1.5 bg-muted/50 border-b flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded shrink-0"
                style={{ backgroundColor: getCategoryColor(selectedPedal.category) }}
              />
              <span className="text-xs font-medium truncate flex-1 min-w-0">{selectedPedal.name}</span>
            </div>
            <div className="p-2 space-y-1.5">
              <div className="text-[10px] text-muted-foreground truncate">{selectedPedal.manufacturer}</div>
              <Badge variant="secondary" className="text-[9px]">{getCategoryLabel(selectedPedal.category)}</Badge>
            </div>
          </div>

          {/* Collision warning */}
          {hasCollision && (
            <div className="p-2 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="text-xs font-medium text-destructive">Collision</div>
              <div className="text-[10px] text-muted-foreground">Overlaps with another pedal</div>
            </div>
          )}

          {/* Details */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-2 py-1.5 bg-muted/50 border-b">
              <span className="text-xs font-medium">Details</span>
            </div>
            <div className="p-2 space-y-1.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size</span>
                <span>{selectedPedal.widthInches}" × {selectedPedal.depthInches}" × {selectedPedal.heightInches}"</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Power</span>
                <span>{selectedPedal.voltage}V{selectedPedal.currentMa && ` / ${selectedPedal.currentMa}mA`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Position</span>
                <span>X: {selectedPlaced.xInches.toFixed(1)}", Y: {selectedPlaced.yInches.toFixed(1)}"</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chain #</span>
                <span>{selectedPlaced.chainPosition}</span>
              </div>
            </div>
          </div>

          {/* Location */}
          {amp?.hasEffectsLoop && useEffectsLoop && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-2 py-1.5 bg-muted/50 border-b">
                <span className="text-xs font-medium">Signal Location</span>
              </div>
              <div className="p-2">
                <Select
                  value={selectedPlaced.location}
                  onValueChange={(value) => updatePedalLocation(selectedPlaced.id, value as ChainLocation)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="front_of_amp">Front of Amp</SelectItem>
                    <SelectItem value="effects_loop">Effects Loop</SelectItem>
                    {selectedPedal.supports4Cable && (
                      <SelectItem value="four_cable_hub">4-Cable Hub</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-1.5 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => rotatePedal(selectedPlaced.id)}
            >
              Rotate 90°
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => removePedal(selectedPlaced.id)}
            >
              Remove Pedal
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
