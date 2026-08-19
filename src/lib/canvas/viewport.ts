/**
 * Canvas viewport mathematics - pure, and pure on purpose.
 *
 * WHY EVERY FUNCTION HERE IS PURE: this repo has no DOM test environment.
 * `vitest.config.ts` sets no `environment`, so tests run in node, and
 * jsdom/happy-dom/@testing-library are absent from package.json. Adding jsdom
 * would buy nothing either - it performs no layout (getBoundingClientRect
 * returns zeros) and does not implement getScreenCTM, so SVG viewport fitting
 * is unrepresentable there.
 *
 * So the arithmetic lives here over plain numbers, where it CAN be tested, and
 * the DOM is reduced to one thin seam (use-canvas-viewport.ts) that supplies a
 * measured element size and nothing else.
 *
 * THIS MODULE IS ALSO A CONTRACT WITH THE VERIFICATION HARNESS.
 * `.claude/scripts/lib/twin.js` toScreen() converts board inches to screen
 * pixels for ~15 Playwright verify-*.js scripts. It cannot import from here (it
 * runs in node against a live browser), so it reimplements the same mapping.
 * viewport.test.ts holds a deliberate copy of its expression and asserts
 * agreement, so drift fails in `npm test` rather than three weeks later in a
 * screenshot gate.
 */

/**
 * World units per board inch. The canvas draws at 40px/inch.
 *
 * Deliberately duplicated rather than imported from `@/store/derived`: that
 * module pulls in the whole derived-state graph, and this one must stay
 * dependency-free to remain trivially testable. viewport.test.ts asserts the
 * two agree, so the duplication cannot drift silently.
 */
export const WORLD_UNITS_PER_INCH = 40;

/** Breathing room drawn around the board, in inches and world px. */
export const PADDING_INCHES = 2;
export const PADDING_PX = PADDING_INCHES * WORLD_UNITS_PER_INCH;

export const MAX_ZOOM = 4;
/**
 * Absolute floor. The EFFECTIVE floor is min(MIN_ZOOM, fitZoom * 0.9) - see
 * clampZoom. A fixed floor makes "Fit" unreachable on a small canvas: the
 * largest board (Pedaltrain Classic Pro, 1440x800 world px incl. padding) needs
 * ~0.22 to fit a 320px-wide phone canvas, which a 0.25 floor would forbid.
 */
export const MIN_ZOOM = 0.1;
export const ZOOM_STEP = 1.2;

export interface Size { width: number; height: number }
export interface Pan { x: number; y: number }
export interface Point { x: number; y: number }
export interface ViewBox { minX: number; minY: number; width: number; height: number }
export interface Bounds { minX: number; minY: number; width: number; height: number }

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

// ---------------------------------------------------------------------------
// Letterbox-aware mapping
//
// General over ANY viewBox/element aspect ratio, which is what makes it a
// superset of both the current formula and the aspect-matched one below.
// Assumes preserveAspectRatio="xMidYMid meet" (the SVG default): the drawing is
// uniformly scaled to FIT and then CENTRED, leaving equal bars on the
// unconstrained axis. Forgetting those bars was one of the three defects in the
// old screenToBoard.
// ---------------------------------------------------------------------------

/** CSS px per world unit once the viewBox has been fitted into the element. */
export function fitScale(vb: ViewBox, el: Size): number {
  if (vb.width <= 0 || vb.height <= 0 || el.width <= 0 || el.height <= 0) return 0;
  return Math.min(el.width / vb.width, el.height / vb.height);
}

/** Size of the centring bars, in CSS px, from the element top-left. */
export function letterbox(vb: ViewBox, el: Size): Point {
  const s = fitScale(vb, el);
  return {
    x: (el.width - vb.width * s) / 2,
    y: (el.height - vb.height * s) / 2,
  };
}

/** World unit -> CSS px offset from the element top-left corner. */
export function userToOffset(vb: ViewBox, el: Size, ux: number, uy: number): Point {
  const s = fitScale(vb, el);
  const lb = letterbox(vb, el);
  return { x: finite(lb.x + (ux - vb.minX) * s), y: finite(lb.y + (uy - vb.minY) * s) };
}

/** CSS px offset from the element top-left corner -> world unit. */
export function offsetToUser(vb: ViewBox, el: Size, ox: number, oy: number): Point {
  const s = fitScale(vb, el);
  if (s === 0) return { x: 0, y: 0 };
  const lb = letterbox(vb, el);
  return { x: finite((ox - lb.x) / s + vb.minX), y: finite((oy - lb.y) / s + vb.minY) };
}

/** CSS px offset -> board inches. The conversion drag and click-to-add need. */
export function offsetToInches(vb: ViewBox, el: Size, ox: number, oy: number): Point {
  const u = offsetToUser(vb, el, ox, oy);
  return { x: u.x / WORLD_UNITS_PER_INCH, y: u.y / WORLD_UNITS_PER_INCH };
}

/** Board inches -> CSS px offset. The exact inverse of offsetToInches. */
export function inchesToOffset(vb: ViewBox, el: Size, xIn: number, yIn: number): Point {
  return userToOffset(vb, el, xIn * WORLD_UNITS_PER_INCH, yIn * WORLD_UNITS_PER_INCH);
}

// ---------------------------------------------------------------------------
// viewBox construction
// ---------------------------------------------------------------------------

/**
 * Build the viewBox from pan/zoom against a MEASURED element size.
 *
 * `zoom` is CSS px per world unit - an absolute scale, so 100% genuinely means
 * 1:1 (40px per board inch). It previously meant "a multiple of whatever fits",
 * which is why the toolbar's "100%" label was never true.
 *
 * Matching the viewBox aspect to the element's is what keeps twin.js toScreen()
 * correct without editing it: when the two aspects agree, both letterbox terms
 * are exactly 0 and its formula degenerates to this one.
 *
 * `fallback` is returned verbatim before the element has been measured (SSR and
 * the first client frame), so the rendered attribute is stable across hydration.
 */
export function viewBoxFor(pan: Pan, zoom: number, el: Size, fallback: ViewBox): ViewBox {
  if (el.width <= 0 || el.height <= 0 || zoom <= 0) return fallback;
  return {
    minX: -PADDING_PX + pan.x,
    minY: -PADDING_PX + pan.y,
    width: el.width / zoom,
    height: el.height / zoom,
  };
}

export function viewBoxString(vb: ViewBox): string {
  return [vb.minX, vb.minY, vb.width, vb.height].join(' ');
}

// ---------------------------------------------------------------------------
// Content extent
// ---------------------------------------------------------------------------

/**
 * Everything that must remain reachable, in world px.
 *
 * NOT just the board: the guitar and amp glyphs are drawn OUTSIDE the padded
 * board box (editor-canvas.tsx getExternalEndpointPx), so defining content as
 * board+padding alone would let a user zoom in and lose them permanently behind
 * the pan clamp.
 */
export function contentBounds(
  boardWidthInches: number,
  boardDepthInches: number,
  externalPointsPx: Point[] = [],
  glyphHalfExtentPx = 60
): Bounds {
  let minX = -PADDING_PX;
  let minY = -PADDING_PX;
  let maxX = boardWidthInches * WORLD_UNITS_PER_INCH + PADDING_PX;
  let maxY = boardDepthInches * WORLD_UNITS_PER_INCH + PADDING_PX;

  for (const p of externalPointsPx) {
    minX = Math.min(minX, p.x - glyphHalfExtentPx);
    minY = Math.min(minY, p.y - glyphHalfExtentPx);
    maxX = Math.max(maxX, p.x + glyphHalfExtentPx);
    maxY = Math.max(maxY, p.y + glyphHalfExtentPx);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Zoom and pan policy
// ---------------------------------------------------------------------------

/** The zoom at which `content` exactly fits `el`. */
export function fitZoom(content: Bounds, el: Size): number {
  if (content.width <= 0 || content.height <= 0 || el.width <= 0 || el.height <= 0) return 1;
  return Math.min(el.width / content.width, el.height / content.height);
}

/** Clamp to [effective floor, MAX_ZOOM]. The floor always admits fitZoom. */
export function clampZoom(zoom: number, el: Size, content: Bounds): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  const floor = Math.min(MIN_ZOOM, fitZoom(content, el) * 0.9);
  return Math.max(floor, Math.min(MAX_ZOOM, zoom));
}

/** The pan that centres `content` in `el` at `zoom`. */
export function fitPan(content: Bounds, el: Size, zoom: number): Pan {
  if (el.width <= 0 || el.height <= 0 || zoom <= 0) return { x: 0, y: 0 };
  const visW = el.width / zoom;
  const visH = el.height / zoom;
  return {
    x: content.minX + (content.width - visW) / 2 + PADDING_PX,
    y: content.minY + (content.height - visH) / 2 + PADDING_PX,
  };
}

/**
 * Zoom about a fixed point: the world unit under `anchorOffset` does not move.
 *
 *   u = a/zoomOld + (-PAD + panOld)  =  a/zoomNew + (-PAD + panNew)
 *   =>  panNew = panOld + a * (1/zoomOld - 1/zoomNew)
 *
 * Independent of PADDING and of element size, which is why it is two lines and
 * has an exact invariant to test rather than a tolerance.
 */
export function panForZoomAt(pan: Pan, oldZoom: number, newZoom: number, anchorOffset: Point): Pan {
  if (oldZoom <= 0 || newZoom <= 0) return pan;
  return {
    x: pan.x + anchorOffset.x * (1 / oldZoom - 1 / newZoom),
    y: pan.y + anchorOffset.y * (1 / oldZoom - 1 / newZoom),
  };
}

/**
 * Keep the board on screen.
 *
 * Per axis: if the visible extent is at least the content extent, the axis is
 * FORCE-CENTRED and not user-controllable - that is what stops a zoomed-out
 * board drifting off into empty grey. Otherwise the pan is clamped to the
 * content, with a small overscroll so edge glyphs stay comfortable to reach.
 */
export function clampPan(pan: Pan, zoom: number, el: Size, content: Bounds): Pan {
  if (el.width <= 0 || el.height <= 0 || zoom <= 0) return { x: 0, y: 0 };

  // minX = -PADDING_PX + pan, so a viewBox min of m corresponds to pan m + PADDING_PX.
  const axis = (p: number, elLen: number, cMin: number, cLen: number): number => {
    const vis = elLen / zoom;
    if (vis >= cLen) return cMin + (cLen - vis) / 2 + PADDING_PX;
    const over = Math.min(0.15 * vis, PADDING_PX);
    const lo = cMin - over + PADDING_PX;
    const hi = cMin + cLen - vis + over + PADDING_PX;
    return Math.max(lo, Math.min(hi, p));
  };

  return {
    x: finite(axis(pan.x, el.width, content.minX, content.width)),
    y: finite(axis(pan.y, el.height, content.minY, content.height)),
  };
}

/** Pan by a CSS-pixel delta (pointer/wheel movement) at the current zoom. */
export function panByPixels(pan: Pan, zoom: number, dxPx: number, dyPx: number): Pan {
  if (zoom <= 0) return pan;
  return { x: pan.x + dxPx / zoom, y: pan.y + dyPx / zoom };
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

/**
 * Classify a wheel event.
 *
 * ctrl/meta+wheel zooms, bare wheel pans. Browsers synthesise ctrlKey for a
 * trackpad pinch, so honouring it gives pinch-to-zoom for free and matches the
 * platform gesture. Bare wheel panning matches Figma/Miro/Maps; the canvas is a
 * finite document inside overflow-hidden, so there is nothing else for a scroll
 * to mean.
 *
 * deltaMode MUST be normalised: Firefox reports LINE (1), and page-mode (2)
 * exists too. Treating either as pixels makes the canvas lurch.
 */
export function wheelIntent(
  e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaX: number; deltaY: number; deltaMode: number },
  el: Size
): WheelIntent {
  const unitX = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.width : 1;
  const unitY = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.height : 1;
  let dx = e.deltaX * unitX;
  let dy = e.deltaY * unitY;

  if (e.ctrlKey || e.metaKey) {
    return { kind: 'zoom', factor: Math.exp(-dy / 200) };
  }
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return { kind: 'pan', dx, dy };
}
