'use client';

import { useRef } from 'react';
import { useConfigurationStore } from '@/store/configuration-store';
import { EditorCanvas } from '@/components/editor/canvas/editor-canvas';
import type { LoadedConfiguration } from '@/lib/load-configuration';

/**
 * Someone else's board, rendered by the real canvas.
 *
 * The canvas reads everything from the configuration store and takes no data
 * props, so a viewer is just the same store seeded from a different row. That
 * is deliberate reuse rather than a shortcut: a second, simpler renderer for
 * shared boards would drift from the one the owner sees, and a share link
 * whose picture disagrees with the editor is worse than no share link.
 *
 * `readOnly` is what makes it a viewer - see EditorCanvas.
 */
export function SharedBoardView({ config }: { config: LoadedConfiguration }) {
  /*
   * Seeded during the FIRST RENDER, not in an effect.
   *
   * The store is a module singleton and the canvas reads it directly, so an
   * effect would paint one frame of whatever the store already held - the
   * empty default, or the last board this tab had open - before correcting
   * itself. Doing it here means the canvas's first paint is already right,
   * and there is no "Loading the board" state to show.
   *
   * The ref guard makes it once-only; initConfiguration is idempotent anyway,
   * which is what makes this safe under StrictMode's double render.
   */
  const seeded = useRef(false);
  if (!seeded.current) {
    useConfigurationStore.getState().initConfiguration({
      id: config.id,
      name: config.name,
      description: config.description,
      isPublic: config.isPublic,
      shareSlug: config.shareSlug,
      board: config.board,
      amp: config.amp,
      useEffectsLoop: config.useEffectsLoop,
      use4CableMethod: config.use4CableMethod,
      modulationInLoop: config.modulationInLoop,
      placedPedals: config.placedPedals,
      pedalsById: config.pedalsById,
      routingConfig: config.routingConfig,
    });
    seeded.current = true;
  }

  return <EditorCanvas readOnly />;
}
