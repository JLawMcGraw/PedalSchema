'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '@/store/editor-store';
import { useConfigurationStore } from '@/store/configuration-store';
import { Button } from '@/components/ui/button';
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
import { BoardReadout } from './board-readout';
import { EditableTitle } from './editable-title';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  onSave: () => void;
}

/**
 * One item on the control rule.
 *
 * The rule has NO buttons in the shadcn sense - no fills, no borders, no
 * hover surfaces. Everything on it is a label in the micro register that
 * happens to be clickable, and the only filled element in the band is Save.
 * That is the whole point of the band: a row of nine outlined buttons reads
 * as nine invitations, and after the board is built the user is looking at
 * their board, not at the toolbar.
 *
 * Still a real <button>: the presentation changed, the semantics did not.
 * Every one of these keeps the tooltip and the keyboard shortcut it had.
 */
function RuleItem({
  onClick,
  disabled,
  active,
  label,
  icon,
  className,
  ...rest
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
  icon?: React.ReactNode;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em]',
        'transition-colors duration-200',
        // 45% when unavailable, per the handoff - dimmed rather than removed,
        // so the rule does not change width as history fills up.
        disabled ? 'opacity-45' : 'hover:text-foreground',
        active ? 'text-primary' : 'text-muted-foreground',
        className
      )}
      {...rest}
    >
      {icon}
      {label}
    </button>
  );
}

/** A 1px x 14px hairline. Not <Separator>: that carries its own margins. */
function RuleSep({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-3.5 w-px shrink-0 bg-border', className)} />;
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
  const { isDirty, isSaving, isOptimizing, saveError, saveConflict, placedPedals, optimizeLayout, undo, redo, canUndo, canRedo, unsavedEdits } = useConfigurationStore(
    useShallow((s) => ({
      isDirty: s.isDirty,
      isSaving: s.isSaving,
      isOptimizing: s.isOptimizing,
      saveError: s.saveError,
      saveConflict: s.saveConflict,
      placedPedals: s.placedPedals,
      optimizeLayout: s.optimizeLayout,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.history.past.length > 0,
      canRedo: s.history.future.length > 0,
      // Distance from the save point, not stack depth - see savedHistoryDepth.
      unsavedEdits: Math.abs(s.history.past.length - s.savedHistoryDepth),
    }))
  );

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
        // selection afterwards keeps the Properties drawer from describing a
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
       * it activates a focused <button> and this band is full of them, so
       * space-to-pan is scoped to the canvas instead.
       */
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selectedPedalId, selectPedal, removePedal, zoomIn, zoomOut, fitToContent, zoomTo100]);

  return (
    <TooltipProvider>
      <div className="flex flex-col">
        {/*
          THE HUD BLOCK.

          An ASCII frame drawn with a real border plus two knockout notches,
          rather than with box-drawing characters - `design-direction.md` asks
          for the instrument-panel register, and └─┘ glyphs in a text node
          cannot survive a resize, a font fallback or a selection.

          The notches knock the border out by painting `bg-background` over it,
          which is why this box sits directly on the page substrate and not on
          `bg-card`: the trick needs the label's background to be the same
          colour as whatever is behind the border it interrupts.
        */}
        <div className="border-b border-border px-4 pb-2.5 pt-3">
          <div className="relative border border-border px-4 pb-3 pt-3.5">
            {/* Top-left notch. The name is the same inline rename as before -
                EditableTitle is unchanged, only the type around it moved. */}
            <div className="absolute -top-1.5 left-3 flex items-center gap-1 bg-background px-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.2em] text-muted-foreground">
              <span>Board —</span>
              <EditableTitle />
            </div>

            {/* Top-right notch. */}
            <div className="absolute -top-1.5 right-3 flex items-center gap-1.5 bg-background px-1.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.2em] text-primary">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              Live
            </div>

            <BoardReadout />
          </div>

          {/*
            THE CONTROL RULE. One row, no fills except Save.
          */}
          <div className="flex items-center gap-3.5 px-0.5 pt-2.5">
            <div className="hidden items-center gap-3.5 md:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <RuleItem
                    onClick={toggleGrid}
                    active={gridVisible}
                    label="Grid"
                    icon={<GridFour className="h-3.5 w-3.5" />}
                  />
                </TooltipTrigger>
                <TooltipContent>Toggle grid</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <RuleItem
                    onClick={toggleCables}
                    active={cablesVisible}
                    label="Cables"
                    icon={<PlugsConnected className="h-3.5 w-3.5" />}
                  />
                </TooltipTrigger>
                <TooltipContent>Toggle cables</TooltipContent>
              </Tooltip>

              <RuleSep />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <RuleItem
                  onClick={undo}
                  disabled={!canUndo}
                  aria-label="Undo"
                  label="Undo"
                  icon={<ArrowCounterClockwise className="h-3.5 w-3.5" />}
                />
              </TooltipTrigger>
              <TooltipContent>Undo (⌘Z)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <RuleItem
                  onClick={redo}
                  disabled={!canRedo}
                  aria-label="Redo"
                  label="Redo"
                  icon={<ArrowClockwise className="h-3.5 w-3.5" />}
                />
              </TooltipTrigger>
              <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
            </Tooltip>

            <RuleSep />

            <Tooltip>
              <TooltipTrigger asChild>
                <RuleItem
                  onClick={optimizeLayout}
                  disabled={placedPedals.length === 0 || isOptimizing}
                  label={isOptimizing ? 'Optimizing' : 'Optimize'}
                  icon={<MagicWand className={cn('h-3.5 w-3.5', isOptimizing && 'animate-spin')} />}
                />
              </TooltipTrigger>
              <TooltipContent>
                Auto-arrange pedals based on signal chain order
              </TooltipContent>
            </Tooltip>

            <RuleSep className="hidden sm:block" />

            <div className="hidden items-center gap-3.5 sm:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <RuleItem
                    onClick={zoomOut}
                    aria-label="Zoom out"
                    label=""
                    icon={<MagnifyingGlassMinus className="h-3.5 w-3.5" />}
                  />
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>

              {/* The percentage is now literally true: `zoom` is CSS px per
                  world unit, so 100% is 1:1 at 40px per board inch. It used to
                  mean "a multiple of whatever fits", which matched nothing. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <RuleItem
                    onClick={fitToContent}
                    label={`${Math.round(zoom * 100)}%`}
                    className="min-w-[34px] justify-center tabular-nums"
                  />
                </TooltipTrigger>
                <TooltipContent>Fit the board to the window (Cmd/Ctrl+0)</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <RuleItem
                    onClick={zoomIn}
                    aria-label="Zoom in"
                    label=""
                    icon={<MagnifyingGlassPlus className="h-3.5 w-3.5" />}
                  />
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
              </Tooltip>
            </div>

            {/* Mobile overflow menu - the groups hidden above live here. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="More actions" className="md:hidden px-2">
                  <DotsThree className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
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

            <div className="flex-1" />

            {/* A failed save is NOT the same as "not saved yet": the work is
                still only in the browser and will be lost on close. Say so,
                and say why - the reason used to reach the console and nowhere
                else. It outranks the edit count because it is the more urgent
                of the two facts, and they occupy the same slot. */}
            {saveError ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="cursor-default truncate font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-destructive"
                  >
                    Save failed
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-xs">{saveError}</p>
                  <p className="text-xs mt-1 opacity-80">Your changes are still here. Try saving again.</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              isDirty && (
                <span className="hidden font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground sm:inline">
                  Unsaved — {unsavedEdits} {unsavedEdits === 1 ? 'edit' : 'edits'}
                </span>
              )
            )}

            {/* Save is the ONLY filled element in the band. */}
            {/* `data-save-board` because three gates click this by its label,
                and the label is not constant: it reads "Saving..." mid-flight,
                which does not contain "Save". */}
            <button
              type="button"
              data-save-board
              onClick={onSave}
              disabled={isSaving || !isDirty || Boolean(saveConflict)}
              className={cn(
                'bg-primary px-3 py-[5px] font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.2em] text-primary-foreground',
                'transition-opacity duration-200',
                'disabled:opacity-45'
              )}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <OptimizationSummary />
      </div>
    </TooltipProvider>
  );
}
