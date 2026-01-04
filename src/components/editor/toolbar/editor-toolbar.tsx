'use client';

import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Wand2 } from 'lucide-react';

interface EditorToolbarProps {
  onSave: () => void;
}

export function EditorToolbar({ onSave }: EditorToolbarProps) {
  const { zoom, zoomIn, zoomOut, resetZoom, gridVisible, toggleGrid, cablesVisible, toggleCables } =
    useEditorStore();
  const { name, isDirty, isSaving, collisions, placedPedals, optimizeLayout } = useConfigurationStore();

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between h-12 px-4 border-b bg-background">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          {isDirty && (
            <Badge variant="outline" className="text-xs">
              Unsaved
            </Badge>
          )}
          {collisions.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {collisions.length} collision{collisions.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* View controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={gridVisible ? 'secondary' : 'ghost'}
                size="sm"
                onClick={toggleGrid}
              >
                Grid
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle grid</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={cablesVisible ? 'secondary' : 'ghost'}
                size="sm"
                onClick={toggleCables}
              >
                Cables
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle cables</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-2" />

          {/* Layout optimization */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={optimizeLayout}
                disabled={placedPedals.length === 0}
                className="gap-1"
              >
                <Wand2 className="w-4 h-4" />
                Optimize Layout
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Auto-arrange pedals based on signal chain order (right to left)
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-2" />

          {/* Zoom controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={zoomOut}>
                −
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>

          <Button variant="ghost" size="sm" onClick={resetZoom} className="min-w-[60px]">
            {Math.round(zoom * 100)}%
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={zoomIn}>
                +
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-2" />

          {/* Save */}
          <Button onClick={onSave} disabled={isSaving || !isDirty} size="sm">
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
