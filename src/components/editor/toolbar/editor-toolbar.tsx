'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { useDerivedConfiguration } from '@/store/derived';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Wand2, Grid3X3, Cable, MoreHorizontal, ZoomIn, ZoomOut, Undo2, Redo2 } from 'lucide-react';
import { OptimizationSummary } from './optimization-summary';

interface EditorToolbarProps {
  onSave: () => void;
}

export function EditorToolbar({ onSave }: EditorToolbarProps) {
  const { selectedPedalId, selectPedal } = useEditorStore(
    useShallow((s) => ({ selectedPedalId: s.selectedPedalId, selectPedal: s.selectPedal }))
  );
  const removePedal = useConfigurationStore((s) => s.removePedal);
  const { zoom, zoomIn, zoomOut, resetZoom, gridVisible, toggleGrid, cablesVisible, toggleCables } =
    useEditorStore(
    useShallow((s) => ({ zoom: s.zoom, zoomIn: s.zoomIn, zoomOut: s.zoomOut, resetZoom: s.resetZoom, gridVisible: s.gridVisible, toggleGrid: s.toggleGrid, cablesVisible: s.cablesVisible, toggleCables: s.toggleCables }))
  );
  const { name, isDirty, isSaving, isOptimizing, saveError, placedPedals, optimizeLayout, undo, redo, canUndo, canRedo } = useConfigurationStore(
    useShallow((s) => ({
      name: s.name,
      isDirty: s.isDirty,
      isSaving: s.isSaving,
      isOptimizing: s.isOptimizing,
      saveError: s.saveError,
      placedPedals: s.placedPedals,
      optimizeLayout: s.optimizeLayout,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.history.past.length > 0,
      canRedo: s.history.future.length > 0,
    }))
  );
  const { collisions } = useDerivedConfiguration((d) => ({ collisions: d.collisions }));

  /**
   * Every global editor shortcut lives here, in one handler, so "what does
   * this key do" has a single answer rather than one per component that
   * happened to be mounted.
   *
   *   Cmd/Ctrl+Z          undo          Shift+Cmd/Ctrl+Z or Ctrl+Y   redo
   *   Delete / Backspace  remove the selected pedal
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Delete the selected pedal. Backspace as well as Delete: Mac laptop
      // keyboards have no Delete key, and its Backspace is labelled "delete".
      //
      // Bare key only - a modifier means the user meant something else
      // (Cmd+Z is right below, and Cmd/Alt+Backspace is a browser Back
      // gesture we have no business hijacking).
      //
      // preventDefault matters even so: plain Backspace still navigates Back
      // in some browsers, and losing an unsaved board to a stray keypress is
      // a far worse outcome than the delete itself.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!selectedPedalId) return;
        e.preventDefault();
        removePedal(selectedPedalId);
        // removePedal records history, so Cmd+Z brings it back. Clearing the
        // selection afterwards keeps the Properties tab from describing a
        // pedal that is no longer on the board.
        selectPedal(null);
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selectedPedalId, selectPedal, removePedal]);

  return (
    <TooltipProvider>
      <div className="flex flex-col">
      <div className="flex items-center justify-between h-12 px-2 sm:px-4 border-b bg-background gap-2">
        {/* Left side - name and badges */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          <span className="font-medium truncate">{name}</span>
          {isDirty && !saveError && (
            <Badge variant="outline" className="text-xs shrink-0">
              Unsaved
            </Badge>
          )}
          {/* A failed save is NOT the same as "not saved yet": the work is
              still only in the browser and will be lost on close. Say so, and
              say why - the reason used to reach the console and nowhere else. */}
          {saveError && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-xs shrink-0 max-w-[16rem] truncate">
                  Save failed
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="text-xs">{saveError}</p>
                <p className="text-xs mt-1 opacity-80">Your changes are still here. Try saving again.</p>
              </TooltipContent>
            </Tooltip>
          )}
          {collisions.length > 0 && (
            <Badge variant="destructive" className="text-xs shrink-0">
              {collisions.length}
            </Badge>
          )}
        </div>

        {/* Right side - controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* View controls - hidden on mobile, shown in dropdown */}
          <div className="hidden md:flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={gridVisible ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={toggleGrid}
                  className="gap-1.5"
                >
                  <Grid3X3 className="h-4 w-4" />
                  <span className="hidden lg:inline">Grid</span>
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
                  className="gap-1.5"
                >
                  <Cable className="h-4 w-4" />
                  <span className="hidden lg:inline">Cables</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle cables</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 mx-1" />
          </div>

          {/* Undo / Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} className="px-2">
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (⌘Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo} className="px-2">
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Layout optimization */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={optimizeLayout}
                disabled={placedPedals.length === 0 || isOptimizing}
                className="gap-1.5"
              >
                <Wand2 className={`h-4 w-4 ${isOptimizing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">
                  {isOptimizing ? 'Optimizing...' : 'Optimize Layout'}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Auto-arrange pedals based on signal chain order
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

          {/* Zoom controls - condensed on mobile */}
          <div className="hidden sm:flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={zoomOut} className="px-2">
                  <ZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <Button variant="ghost" size="sm" onClick={resetZoom} className="min-w-[52px] px-2 tabular-nums">
              {Math.round(zoom * 100)}%
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={zoomIn} className="px-2">
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

          {/* Mobile overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="md:hidden px-2">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={toggleGrid}>
                <Grid3X3 className="h-4 w-4 mr-2" />
                {gridVisible ? 'Hide Grid' : 'Show Grid'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleCables}>
                <Cable className="h-4 w-4 mr-2" />
                {cablesVisible ? 'Hide Cables' : 'Show Cables'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={zoomOut}>
                <ZoomOut className="h-4 w-4 mr-2" />
                Zoom Out
              </DropdownMenuItem>
              <DropdownMenuItem onClick={resetZoom}>
                Reset Zoom ({Math.round(zoom * 100)}%)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={zoomIn}>
                <ZoomIn className="h-4 w-4 mr-2" />
                Zoom In
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Save */}
          <Button onClick={onSave} disabled={isSaving || !isDirty} size="sm">
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
      <OptimizationSummary />
      </div>
    </TooltipProvider>
  );
}
