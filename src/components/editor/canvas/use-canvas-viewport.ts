'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '@/store/editor-store';
import {
  viewBoxFor,
  viewBoxString,
  offsetToInches,
  inchesToOffset,
  PADDING_PX,
  WORLD_UNITS_PER_INCH,
  type Bounds,
  type ViewBox,
} from '@/lib/canvas/viewport';

/**
 * The ONE place the canvas touches the DOM for geometry.
 *
 * Everything else - the arithmetic, the clamps, the zoom anchoring - lives in
 * `@/lib/canvas/viewport` as pure functions, because vitest runs in node here
 * and anything that reads `getBoundingClientRect` is untestable. Keeping the
 * seam this thin is what makes the rest of it provable.
 *
 * `screenToBoard` used to do this inline in editor-canvas.tsx, with its own
 * copy of the arithmetic - and that copy was wrong in three ways for an unknown
 * length of time. One seam, one implementation.
 */
export function useCanvasViewport(
  boardWidthInches: number,
  boardDepthInches: number,
  reachableBounds: Bounds,
  /**
   * False while the configuration is still loading. WITHOUT THIS the hook fits
   * to the placeholder board dimensions on first mount, `hasFitted` latches,
   * and the real board never gets framed - an 18in board came out at zoom 0.62
   * instead of 0.93 and looked plausible enough to ship.
   */
  ready: boolean
) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { zoom, pan, viewportSize, setViewportSize, setBounds } = useEditorStore(
    useShallow((s) => ({
      zoom: s.zoom,
      pan: s.pan,
      viewportSize: s.viewportSize,
      setViewportSize: s.setViewportSize,
      setBounds: s.setBounds,
    }))
  );

  /**
   * The box the view FRAMES on load - the board plus its padding, i.e. exactly
   * what the viewBox showed before the canvas could pan. Kept separate from the
   * reachable box on purpose: the reachable box includes the guitar and amp
   * glyphs drawn outside the board, and fitting to THAT would silently rescale
   * every board on first paint.
   */
  const fitBounds: Bounds = {
    minX: -PADDING_PX,
    minY: -PADDING_PX,
    width: boardWidthInches * WORLD_UNITS_PER_INCH + PADDING_PX * 2,
    height: boardDepthInches * WORLD_UNITS_PER_INCH + PADDING_PX * 2,
  };

  useEffect(() => {
    if (!ready) return;
    setBounds(fitBounds, reachableBounds);
    // fitBounds is derived from the two board dimensions, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, boardWidthInches, boardDepthInches, reachableBounds, setBounds]);

  /**
   * Measure via a CALLBACK REF, not an effect.
   *
   * An effect keyed on [setViewportSize] looked equivalent and was not:
   * EditorCanvas early-returns "Select a board to get started" before the <svg>
   * exists, so on first mount `svgRef.current` was null, the effect bailed, and
   * it never ran again when the board arrived - its deps had not changed. The
   * canvas then rendered the pre-measurement fallback viewBox forever, which
   * looked exactly like the old behaviour and would have shipped unnoticed.
   *
   * A callback ref fires precisely when the element attaches and detaches,
   * which is the actual condition being waited on.
   *
   * ResizeObserver rather than a window listener: the canvas column also
   * changes width when a side panel opens, which no window event reports.
   */
  const observerRef = useRef<ResizeObserver | null>(null);
  /**
   * The attached element AS STATE, not just as a ref.
   *
   * Consumers that need to register native listeners (the wheel handler needs
   * { passive: false }, which React's onWheel cannot give) must run an effect
   * WHEN THE ELEMENT ATTACHES. A ref does not trigger that: an effect reading
   * `ref.current` on mount sees null - EditorCanvas early-returns before the
   * <svg> exists - and never re-runs, because a ref object is stable. That
   * exact mistake silently disabled measurement once and the wheel once.
   */
  const [svgNode, setSvgNode] = useState<SVGSVGElement | null>(null);
  const attachSvg = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef.current = el;
      setSvgNode(el);
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el) return;
      const measure = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setViewportSize({ width: r.width, height: r.height });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observerRef.current = ro;
    },
    [setViewportSize]
  );

  /**
   * Stable pre-measurement viewBox.
   *
   * Rendered during SSR and on the first client frame, before the
   * ResizeObserver has reported. It must NOT depend on a measured size or React
   * reports a hydration mismatch on the attribute. It is also exactly the box
   * the canvas used before this change, so the very first painted frame is
   * unchanged.
   */
  const fallback: ViewBox = { ...fitBounds };

  const viewBox = viewBoxFor(pan, zoom, viewportSize, fallback);
  const viewBoxAttr = viewBoxString(viewBox);

  /** Element-relative pixel offset of a pointer event. */
  const offsetOf = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const clientToInches = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const size = { width: r.width, height: r.height };
      const vb = viewBoxFor(pan, zoom, size, fallback);
      return offsetToInches(vb, size, clientX - r.left, clientY - r.top);
    },
    // `fallback` is derived from the board dimensions, which are in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pan, zoom, boardWidthInches, boardDepthInches]
  );

  const inchesToClient = useCallback(
    (xIn: number, yIn: number) => {
      const el = svgRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const size = { width: r.width, height: r.height };
      const vb = viewBoxFor(pan, zoom, size, fallback);
      const off = inchesToOffset(vb, size, xIn, yIn);
      return { x: off.x + r.left, y: off.y + r.top };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pan, zoom, boardWidthInches, boardDepthInches]
  );

  /**
   * Viewport hooks for the verification scripts.
   *
   * Registered HERE rather than beside the other __pedalSchema* getters in
   * derived.ts: that file's comment deliberately keeps screen positions out of
   * the snapshot, and this is screen geometry. `verify-viewport.js` uses these
   * to cross-check twin.js's mapping against the app's own and against the
   * browser's getScreenCTM.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      __pedalSchemaViewport?: () => unknown;
      __pedalSchemaInchesToClient?: (x: number, y: number) => { x: number; y: number };
    };
    w.__pedalSchemaViewport = () => {
      const el = svgRef.current;
      const r = el?.getBoundingClientRect();
      const s = useEditorStore.getState();
      return {
        zoom: s.zoom,
        pan: s.pan,
        viewportSize: s.viewportSize,
        contentBounds: s.contentBounds,
        viewBox: el?.getAttribute('viewBox'),
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
      };
    };
    w.__pedalSchemaInchesToClient = (x, y) => inchesToClient(x, y);
    return () => {
      delete w.__pedalSchemaViewport;
      delete w.__pedalSchemaInchesToClient;
    };
  }, [inchesToClient]);

  return { svgRef: attachSvg, svgEl: svgRef, svgNode, viewBox, viewBoxAttr, offsetOf, clientToInches, inchesToClient };
}
