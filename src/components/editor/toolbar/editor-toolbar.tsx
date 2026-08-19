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
import { MagicWand, GridFour, PlugsConnected, DotsThree, MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { OptimizationSummary } from './optimization-summary';
import { EditableTitle } from './editable-title';

interface EditorToolbarProps {
  onSave: () => void;
}

export function EditorToolbar({ onSave }: EditorToolbarProps) {
  const { selectedPedalId, selectPedal } = useEditorStore(
    useShallow((s) => ({ selectedPedalId: s.selectedPedalId, selectPedal: s.selectPedal }))
  );
  const removePedal = useConfigurationStore((s) => s.removePedal);
  const { zoom, zoomIn, zoomOut, fitToContent, zoomTo100, gridVisible, toggleGrid, cablesVisible, toggleCables } =
    useEditorStore(
    useShallow((s) => ({ zoom: s.zoom, zoomIn: s.zoomIn, zoomOut: s.zoomOut, fitToContent: s.fitToContent, zoomTo100: s.zoomTo100, gridVisible: s.gridVisible, toggleGrid: s.toggleGrid, cablesVisible: s.cablesVisible, toggleCables: s.toggleCables }))
  );
  const { isDirty, isSaving, isOptimizing, saveError, placedPedals, optimizeLayout, undo, redo, canUndo, canRedo } = useConfigurationStore(
    useShallow((s) => ({
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
      } else if (key === '=' || key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        // Taken from the browser's own zoom deliberately: in a canvas app the
        // board is what the user means by "zoom in". Matched on BOTH key and
        // code - the character depends on the layout and the shift state.
        e.preventDefault();
        zoomIn();
      } else if (key === '-' || key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomOut();
      } else if (key === '0') {
        e.preventDefault();
        fitToContent();
      } else if (key === '1') {
        e.preventDefault();
        zoomTo100();
      }
      /*
       * Bare arrow keys are DELIBERATELY not claimed. They are the natural
       * binding for nudging the selected pedal, and taking them for panning
       * now would only have to be undone. Space is not claimed here either -
       * it activates a focused <button> and this toolbar is full of them, so
       * space-to-pan is scoped to the canvas instead.
       */
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selectedPedalId, selectPedal, removePedal, zoomIn, zoomOut, fitToContent, zoomTo100]);

  return (
    <TooltipProvider>
      <div className="flex flex-col">
      <div className="flex items-center justify-between h-12 px-2 sm:px-4 border-b bg-background gap-2">
        {/* Left side - name and badges */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          <EditableTitle />
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
                  <GridFour className="h-4 w-4" />
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
                  <PlugsConnected className="h-4 w-4" />
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
              <Button
                variant="ghost"
                size="sm"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
                className="px-2"
              >
                <ArrowCounterClockwise className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (⌘Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
                className="px-2"
              >
                <ArrowClockwise className="h-4 w-4" />
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
                <MagicWand className={`h-4 w-4 ${isOptimizing ? 'animate-spin' : ''}`} />
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
                <Button variant="ghost" size="sm" onClick={zoomOut} aria-label="Zoom out" className="px-2">
                  <MagnifyingGlassMinus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            {/* The percentage is now literally true: `zoom` is CSS px per world
                unit, so 100% is 1:1 at 40px per board inch. It used to mean
                "a multiple of whatever fits", which matched nothing. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={fitToContent} className="min-w-[52px] px-2 tabular-nums">
                  {Math.round(zoom * 100)}%
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit the board to the window (Cmd/Ctrl+0)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={zoomIn} aria-label="Zoom in" className="px-2">
                  <MagnifyingGlassPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

          {/* Mobile overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="More actions" className="md:hidden px-2">
                <DotsThree className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={toggleGrid}>
                <GridFour className="h-4 w-4 mr-2" />
                {gridVisible ? 'Hide Grid' : 'Show Grid'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleCables}>
                <PlugsConnected className="h-4 w-4 mr-2" />
                {cablesVisible ? 'Hide Cables' : 'Show Cables'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={zoomOut}>
                <MagnifyingGlassMinus className="h-4 w-4 mr-2" />
                Zoom Out
              </DropdownMenuItem>
              <DropdownMenuItem onClick={fitToContent}>
                Fit to Board ({Math.round(zoom * 100)}%)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={zoomTo100}>
                Actual Size (100%)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={zoomIn}>
                <MagnifyingGlassPlus className="h-4 w-4 mr-2" />
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
