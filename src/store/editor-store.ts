import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  clampPan,
  clampZoom,
  fitPan,
  fitZoom,
  panForZoomAt,
  panByPixels as panByPixelsPure,
  contentBounds as contentBoundsPure,
  ZOOM_STEP,
  type Bounds,
  type Pan,
  type Point,
  type Size,
} from '@/lib/canvas/viewport';

/**
 * A board large enough that nothing is clamped away before the canvas has
 * measured itself. Replaced by the real bounds on the first `setContentBounds`.
 */
const DEFAULT_CONTENT: Bounds = contentBoundsPure(32, 16);

interface EditorState {
  // View controls
  /**
   * CSS px per world unit. zoom 1 means 1:1 - 40px per board inch - so the
   * toolbar's percentage is now literally true. It previously meant "a multiple
   * of whatever happens to fit", which is why "100%" never matched anything.
   */
  zoom: number;
  pan: Pan;
  /**
   * The canvas element's measured size. Zero until the ResizeObserver in
   * `use-canvas-viewport` reports; every clamp is a no-op until then.
   */
  viewportSize: Size;
  /**
   * Everything that must stay REACHABLE, in world px - board plus the guitar
   * and amp glyphs drawn outside it. Governs the pan clamp.
   */
  contentBounds: Bounds;
  /**
   * What the view FRAMES on load: the board box, exactly what the canvas
   * showed before it could pan. Deliberately NOT contentBounds - fitting to
   * the wider box would rescale every board on first paint and break the
   * verification scripts that assert fixed screen positions.
   */
  fitBounds: Bounds;
  /** Set once real bounds arrive; the initial fit waits for it. */
  boundsReady: boolean;
  /** Fit happens once, when both a size and real bounds are known. */
  hasFitted: boolean;
  gridVisible: boolean;
  cablesVisible: boolean;

  // Selection
  selectedPedalId: string | null;

  // Interaction mode
  mode: 'select' | 'pan' | 'add-pedal';
  pedalToAdd: string | null; // pedal ID to add when clicking

  // Actions
  setViewportSize: (size: Size) => void;
  /** Both boxes in one call - two actions would race the initial fit. */
  setBounds: (fit: Bounds, content: Bounds) => void;
  setZoom: (zoom: number) => void;
  /** The clamped primitive every other zoom action goes through. */
  zoomAt: (zoom: number, anchorOffset: Point) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Scale the board to fit the canvas and centre it. */
  fitToContent: () => void;
  /** True 1:1 - 40px per board inch. */
  zoomTo100: () => void;
  resetZoom: () => void;
  setPan: (pan: Pan) => void;
  panBy: (delta: Pan) => void;
  /** Pan by a pointer/wheel delta in CSS pixels. */
  panByPixels: (dxPx: number, dyPx: number) => void;
  toggleGrid: () => void;
  toggleCables: () => void;
  selectPedal: (id: string | null) => void;
  setMode: (mode: 'select' | 'pan' | 'add-pedal') => void;
  setPedalToAdd: (pedalId: string | null) => void;
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportSize: { width: 0, height: 0 },
    contentBounds: DEFAULT_CONTENT,
    fitBounds: DEFAULT_CONTENT,
    boundsReady: false,
    hasFitted: false,
    gridVisible: true,
    cablesVisible: true,
    selectedPedalId: null,
    mode: 'select',
    pedalToAdd: null,

    /*
     * THE INVARIANT FOR EVERY ACTION BELOW: `pan` and `zoom` are never assigned
     * without passing through clampPan/clampZoom. A single unclamped path is
     * enough to lose the board off-screen with no way back, which is the bug
     * this whole module exists to prevent.
     */

    /*
     * THE INITIAL FIT NEEDS BOTH A MEASURED SIZE AND REAL BOUNDS, and they
     * arrive in either order: the canvas ref callback fires during commit,
     * before the effect that reports the board's bounds. Fitting on whichever
     * came first used the placeholder 32x16 box and framed an 18in board at
     * 0.62 instead of 0.93. So both actions attempt the fit and `hasFitted`
     * decides which one wins.
     */
    setViewportSize: (size) =>
      set((s) => {
        if (size.width <= 0 || size.height <= 0) return {};
        if (s.viewportSize.width === size.width && s.viewportSize.height === size.height) return {};
        if (!s.hasFitted && s.boundsReady) {
          const zoom = clampZoom(fitZoom(s.fitBounds, size), size, s.contentBounds);
          const pan = clampPan(fitPan(s.fitBounds, size, zoom), zoom, size, s.contentBounds);
          return { viewportSize: size, zoom, pan, hasFitted: true };
        }
        // A later resize only re-clamps: a user who has zoomed in should not be
        // yanked back to fit by a window drag or a panel opening.
        const zoom = clampZoom(s.zoom, size, s.contentBounds);
        return { viewportSize: size, zoom, pan: clampPan(s.pan, zoom, size, s.contentBounds) };
      }),

    setBounds: (fit, content) =>
      set((s) => {
        const same = (a: Bounds, b: Bounds) =>
          a.minX === b.minX && a.minY === b.minY && a.width === b.width && a.height === b.height;
        if (s.boundsReady && same(s.contentBounds, content) && same(s.fitBounds, fit)) return {};
        if (!s.hasFitted && s.viewportSize.width > 0) {
          const zoom = clampZoom(fitZoom(fit, s.viewportSize), s.viewportSize, content);
          const pan = clampPan(fitPan(fit, s.viewportSize, zoom), zoom, s.viewportSize, content);
          return { fitBounds: fit, contentBounds: content, boundsReady: true, hasFitted: true, zoom, pan };
        }
        const zoom = clampZoom(s.zoom, s.viewportSize, content);
        return {
          fitBounds: fit, contentBounds: content, boundsReady: true,
          zoom, pan: clampPan(s.pan, zoom, s.viewportSize, content),
        };
      }),

    zoomAt: (zoom, anchorOffset) =>
      set((s) => {
        const next = clampZoom(zoom, s.viewportSize, s.contentBounds);
        const panned = panForZoomAt(s.pan, s.zoom, next, anchorOffset);
        return { zoom: next, pan: clampPan(panned, next, s.viewportSize, s.contentBounds) };
      }),

    setZoom: (zoom) =>
      set((s) => {
        const next = clampZoom(zoom, s.viewportSize, s.contentBounds);
        return { zoom: next, pan: clampPan(s.pan, next, s.viewportSize, s.contentBounds) };
      }),

    // Anchored on the canvas CENTRE, not the top-left corner. Top-left
    // anchoring is what made zooming in push the board off to the right with
    // no way to follow it.
    zoomIn: () =>
      set((s) => {
        const centre = { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 };
        const next = clampZoom(s.zoom * ZOOM_STEP, s.viewportSize, s.contentBounds);
        const panned = panForZoomAt(s.pan, s.zoom, next, centre);
        return { zoom: next, pan: clampPan(panned, next, s.viewportSize, s.contentBounds) };
      }),

    zoomOut: () =>
      set((s) => {
        const centre = { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 };
        const next = clampZoom(s.zoom / ZOOM_STEP, s.viewportSize, s.contentBounds);
        const panned = panForZoomAt(s.pan, s.zoom, next, centre);
        return { zoom: next, pan: clampPan(panned, next, s.viewportSize, s.contentBounds) };
      }),

    fitToContent: () =>
      set((s) => {
        if (s.viewportSize.width <= 0) return {};
        const zoom = clampZoom(fitZoom(s.fitBounds, s.viewportSize), s.viewportSize, s.contentBounds);
        return { zoom, pan: clampPan(fitPan(s.fitBounds, s.viewportSize, zoom), zoom, s.viewportSize, s.contentBounds) };
      }),

    zoomTo100: () =>
      set((s) => {
        const centre = { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 };
        const next = clampZoom(1, s.viewportSize, s.contentBounds);
        const panned = panForZoomAt(s.pan, s.zoom, next, centre);
        return { zoom: next, pan: clampPan(panned, next, s.viewportSize, s.contentBounds) };
      }),

    /**
     * Kept as an alias of fitToContent rather than removed: the toolbar's zoom
     * label and its overflow menu both call it, and "reset the view" now means
     * "fit the board" rather than "zoom 1, pan 0" - which on a large board used
     * to leave you looking at a corner.
     */
    resetZoom: () =>
      set((s) => {
        if (s.viewportSize.width <= 0) return { zoom: 1, pan: { x: 0, y: 0 } };
        const zoom = clampZoom(fitZoom(s.fitBounds, s.viewportSize), s.viewportSize, s.contentBounds);
        return { zoom, pan: clampPan(fitPan(s.fitBounds, s.viewportSize, zoom), zoom, s.viewportSize, s.contentBounds) };
      }),

    setPan: (pan) =>
      set((s) => ({ pan: clampPan(pan, s.zoom, s.viewportSize, s.contentBounds) })),

    panBy: (delta) =>
      set((s) => ({
        pan: clampPan({ x: s.pan.x + delta.x, y: s.pan.y + delta.y }, s.zoom, s.viewportSize, s.contentBounds),
      })),

    panByPixels: (dxPx, dyPx) =>
      set((s) => ({
        pan: clampPan(panByPixelsPure(s.pan, s.zoom, dxPx, dyPx), s.zoom, s.viewportSize, s.contentBounds),
      })),

    toggleGrid: () =>
      set((state) => ({ gridVisible: !state.gridVisible })),

    toggleCables: () =>
      set((state) => ({ cablesVisible: !state.cablesVisible })),

    selectPedal: (id) =>
      set({ selectedPedalId: id }),

    /**
     * Leaving add-pedal mode clears the pending pedal; entering it leaves the
     * pending pedal alone (setPedalToAdd is what supplies one).
     *
     * This used to pass `pedalToAdd: undefined` for the entering case. Zustand
     * merges with Object.assign, which does NOT skip undefined - it overwrites -
     * so entering the mode wrote `undefined` into a field typed `string | null`.
     * Harmless only because setPedalToAdd is the sole caller today.
     */
    setMode: (mode) =>
      set(mode === 'add-pedal' ? { mode } : { mode, pedalToAdd: null }),

    setPedalToAdd: (pedalId) =>
      set({ pedalToAdd: pedalId, mode: pedalId ? 'add-pedal' : 'select' }),
  }))
);

/**
 * Selection, for verification scripts.
 *
 * Lives here rather than beside the other __pedalSchema* hooks in derived.ts
 * because selection is editor-store state and derived.ts does not import this
 * store - reaching across for one getter would create the dependency the two
 * stores are kept apart to avoid.
 *
 * Goes through selectPedal, so a script cannot select in a way a click could
 * not.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __pedalSchemaSelect: (id: string | null) => void })
    .__pedalSchemaSelect = (id) => useEditorStore.getState().selectPedal(id);
}
