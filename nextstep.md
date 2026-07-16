# Next Steps Plan: Layout Optimizer + Cable Routing Fixes

This plan focuses on eliminating order violations with FX loop + clean/dirty modulation, reducing cable crossings/overlaps, and ensuring cables never route through pedals.

## 1) Repro + Diagnostics (one-time setup)
- Add a small debug fixture (board + 8-12 pedals) that reproduces:
  - FX loop enabled with modulationInLoop true.
  - Order violations or overlaps on layout.
  - Cable intersections / cable-through-pedal routes.
- Add a simple “export current state as JSON” debug action (or document how to capture it) so issues can be reproduced reliably.
- Add debug toggles for:
  - `debug=optimizer` placement logs.
  - `debug=cables` routing logs + invalid path highlighting.

## 2) Layout Optimizer: Fix Ordering + FX Loop Zoning
### 2.1 Dynamic FX loop boundary
- Replace fixed `ampZoneBoundary = board.widthInches * 0.35` in `src/lib/engine/layout/optimizer-v2.ts:295-305` with a dynamic boundary.
- Compute required widths in `createSignalFlowLayout`:
  - `frontWidth = sum(pedal widths) + spacing`
  - `loopWidth = sum(pedal widths) + spacing`
- Derive `ampZoneBoundary` so both zones fit when possible:
  - `ampZoneBoundary = clamp(loopWidth, minZoneWidth, board.widthInches - minZoneWidth)`
- If pedals exceed total board width, allow controlled overflow into the opposite zone:
  - adjust `findValidPositionInZone` call to relax zone bounds before falling back to `(0,0)`.

### 2.2 Preserve global chain order across zones
- In `createSignalFlowLayout` (`src/lib/engine/layout/optimizer-v2.ts:320-465`), add a post-pass:
  - Verify monotonic X positions for each chain segment per zone (front-of-amp and effects loop).
  - If violated, re-place that zone using stricter row constraints (no row overflow that inverts X order).

### 2.3 Avoid hard fallback to `(0,0)`
- Replace `(0,0)` fallback at `src/lib/engine/layout/optimizer-v2.ts:392-395` and `src/lib/engine/layout/optimizer-v2.ts:458-461` with a best-effort placement:
  - Finds nearest valid position even if it means relaxing zone boundaries.
  - Returns a “placement warnings” list that the UI can surface (not a silent collision).

### 2.4 Collisions vs cable clearance
- Update `COLLISION_SPACING` in `src/lib/engine/collision/index.ts:7` to be >= `OBSTACLE_MARGIN / 40`.
- If changing margin, update both:
  - `src/lib/engine/pathfinding/index.ts:13-15`
  - `src/lib/engine/obstacles/index.ts:22-25`

## 3) Signal Chain Rules: Clean/Dirty Modulation Consistency
- Ensure modulationInLoop affects `location` only and does not override `locationOverride`:
  - `src/lib/engine/signal-chain/rules.ts:202-228`
- Add explicit handling so modulation in loop is ordered relative to delay/reverb:
  - add a rule after `time-effects-in-loop` in `src/lib/engine/signal-chain/rules.ts`
  - stabilize ordering inside loop group by category defaults or explicit sub-order.
- Add a rule to avoid mixing effects-loop and front-of-amp ordering when `useEffectsLoop` toggles mid-session:
  - normalize `location` based on context before assigning `chainPosition` in `src/lib/engine/signal-chain/index.ts:49-90`.

## 4) Cable Routing: Stop Cables Through Pedals
### 4.1 Remove “expanded exclude” for adjacent pedals
- In `src/lib/engine/cables/validation.ts:58-90`, remove the “expanded exclude” logic.
- Replace with:
  - endpoint tolerance only for source/destination boxes (small 2-4px)
  - do not exclude other pedals based on margin overlap.

### 4.2 Board bounds enforcement
- In `src/lib/engine/pathfinding/index.ts:576-599`, clamp grid bounds to `boardBounds` passed from obstacles.
- In `src/lib/engine/cables/routing-strategies.ts:151-220`, reject any candidate path that leaves board bounds (except for explicit off-board endpoints).

### 4.3 Reduce over-aggressive direct/L-path shortcuts
- In `src/lib/engine/pathfinding/index.ts:536-574`, tighten or disable L-path shortcuts when obstacles are present.
- Prefer A* for medium-length paths if `boxes.length > 0` and distance > ~60px.

## 5) Cable Rendering: Reduce Crossings + Overlap
### 5.1 Offset parallel cables by group, not globally
- In `src/components/editor/canvas/editor-canvas.tsx:332-343`, compute `cableIndex`/`totalCables` per group:
  - Same from/to pair (regardless of direction), or
  - Same from type (guitar/amp) and first pedal, or
  - Same chain adjacency (pedal i → pedal i+1).
- Assign `cableIndex`/`totalCables` per group, not across the entire cable list.

### 5.2 Increase and scale offsets
- Increase base offset in `src/lib/engine/cables/routing-strategies.ts:50-115` from 4px to 8–12px.
- Scale offset based on group size and path length (cap at ~24-32px).

### 5.3 Optional: “bundle lanes” in channels
- If using channel routing in `src/lib/engine/cables/routing-strategies.ts:201-219`, clamp channel Y to a shared lane per group so cables run side-by-side.

## 6) Tests + Verification
- Add unit tests for:
  - FX loop zoning with mixed pedal sizes.
  - ModulationInLoop ordering in effects loop.
  - No collision fallback to `(0,0)`.
- Add routing tests to verify:
  - No path intersects obstacle boxes.
  - Paths do not exit board bounds (except for amp/guitar endpoints).
- Manual QA checklists:
  - FX loop enabled + modulationInLoop = true.
  - Dense board with tight spacing.
  - Multiple parallel cables (ensure side-by-side routing).

## 7) Staged Implementation Order
1. Fix collisions/clearance + validation exclusion (prevents cables through pedals).
2. Enforce board bounds in routing.
3. Cable grouping offsets (reduce overlap).
4. Dynamic FX loop zoning + overflow handling.
5. Order verification + reflow if violated.
6. Tests + QA pass.
