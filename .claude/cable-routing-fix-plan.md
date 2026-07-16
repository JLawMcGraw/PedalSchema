# Cable Routing Surgical Fix Plan (2026-07-15)

## Problem being fixed

Cable routing fails because the placement contract and the routing contract contradict each other:

- Validation requires cables ≥ `OBSTACLE_MARGIN = 25px` from every non-endpoint pedal.
- Placement guarantees only `COLLISION_SPACING = 0.5" = 20px` between pedals.
- A corridor between two pedals needs `2 × margin = 50px`; between rows on a Pedaltrain-style
  board the gap is ~10–35px. Between-row routing is geometrically impossible.

Secondary defects: two disagreeing validators, a rescue A* that inflates obstacles by 37.5px and
excludes nothing (guaranteed failure), three different definitions of the guitar/amp endpoint
positions, and a renderer that violates the Rules of Hooks and reroutes every cable on every
render frame.

## Fix 1 — One clearance constant, sized so routing is possible

**Decision: lower the routing margin to 8px; do NOT raise pedal spacing.**

Options considered:

| Option | Outcome |
|--------|---------|
| A. Margin 25 → 8px (chosen) | 20px pedal gaps admit a cable lane (2×8=16 < 20). Vertical corridors between pedals become routable. Row-gap problem disappears (cables route above rows or through corridors). Visually, 8px ≈ 0.2" clearance — cables hug pedals like real patch cables. |
| B. Raise spacing to ≥ 2×25+slack ≈ 1.4" | Boards lose ~30% capacity, and rail positions are fixed hardware — the between-row gap cannot be widened by the optimizer at all. Rejected. |

Implementation:
- New `src/lib/engine/geometry/index.ts` becomes the single home for `Point`, `Box`,
  `BoardBounds`, segment/box intersection math, and the constants
  (`OBSTACLE_MARGIN = 8`, `ENDPOINT_TOLERANCE = 4`, `STANDOFF = 12`, `GRID_CELL_SIZE = 8`).
- `pathfinding/index.ts` and `obstacles/index.ts` re-export from geometry (no more twin
  definitions with a "must match" comment).
- Standoffs recalibrated: fixed 12px (was dynamic 25–40px+, which lands inside neighbors at
  20px spacing). A standoff's only job is to exit the jack before turning.

## Fix 2 — One validator

**Decision: one validation policy implemented once in geometry, used by every layer.**

- Policy: per-segment check against every non-excluded box; first/last segments use
  `margin − ENDPOINT_TOLERANCE` (jacks sit on pedal edges), middle segments use full margin.
  The old separate "intermediate point in margin" check is redundant (a point inside a margin
  box makes its adjacent segments intersect that box) and is dropped.
- `geometry.findPathViolations(path, boxes, excludeIndices)` is the single implementation.
  `cables/validation.ts#validateCablePath` becomes a thin wrapper that maps pedal IDs ↔ box
  indices. `pathfinding`'s `validateRoute` and its private geometry copies are deleted;
  routing strategies validate mid-flight with the same function used for final acceptance.
- The doomed rescue path (`findPathAStar` with 37.5px-inflated boxes and `-1, -1` excludes) is
  deleted. Instead, the strategy-8 A* now excludes the source/destination boxes properly, so
  the search starts from the actual jack instead of a BFS-relocated point.

## Fix 3 — Route once, centrally

**Decision: a pure engine function routes all cables in one pass; the canvas memoizes it once;
`CableRenderer` becomes purely presentational.**

Options considered:
- Route in the Zustand store next to `recalculateCables` — couples geometry to state writes and
  reroutes on every store change even when nothing visual changed. Rejected.
- Route in a single `useMemo` at the canvas level (chosen) — recomputes only when
  `cables` / `placedPedals` / `board` / FX-loop state change. During pedal drags nothing
  recomputes until drop (today the broken per-cable memo reroutes every frame).

Implementation:
- New `src/lib/engine/cables/endpoints.ts`: single source of truth for external endpoint
  positions in inches (guitar `+1.5"`, amp `−1.5"`, return 0.2×depth, send 0.5, input 0.8/0.5 —
  the convention the amp panel actually draws) and pixel-space jack lookup that reuses the
  engine's `getJackPosition`/`findJack` instead of the renderer's duplicate.
- New `src/lib/engine/cables/route-cables.ts#routeAllCables(...)`: builds obstacles once,
  computes cable groups once, resolves endpoints, routes every cable, returns
  `{ cable, path, valid, fromPos, toPos }[]`.
- `cable-renderer.tsx`: no hooks, just draws a routed cable (fixes the Rules-of-Hooks
  violation — hooks after conditional return).
- `editor-canvas.tsx`: one `useMemo(routeAllCables)` above the early return; amp/guitar icons
  positioned from the shared endpoints module.
- `layout/routing-cost.ts` and `cables/index.ts` (length estimation) switch to the shared
  endpoint definitions, so the optimizer, the renderer, and the printed cable lengths finally
  agree on where the amp is.

## Better long-term option (presented, not applied now)

The 8-strategy cascade + grid A* is a fragile way to draw cables. The cleaner architecture is a
**Manhattan lane router**: derive horizontal channels from the row structure, assign each cable a
lane inside its channel (PCB-style), and render orthogonal paths with per-lane offsets. It is
deterministic, O(cables), and eliminates overlap between unrelated cables sharing a channel —
the remaining visual wart these fixes don't address. Recommended as the next project *if* visual
quality still disappoints after these fixes; the endpoints/validator/central-routing work here is
a prerequisite for it either way, so nothing is thrown away.

## Verification

- Install `vitest` (+ `test` script, path-alias config) — currently no test runner exists.
- New invariant tests (`src/lib/engine/cables/__tests__/routing-invariants.test.ts`):
  1. Chain of pedals at 0.5" spacing → every hop routes valid.
  2. Two realistic rows (rails 2"/8", 5.12"-deep pedals) → cross-row cable routes valid and
     stays on board.
  3. Guitar → first pedal and last pedal → amp input route valid on a full board.
  4. FX loop: amp send → left-zone pedal routes valid.
  5. Every returned path is independently re-checked against raw geometry (not just the
     validator's own verdict).
- `npm run build` must pass.
- Report per CLAUDE.md verification protocol with extracted coordinates.
