# PedalSchema — Full Architecture & Code Review (2026-07-15)

Scope: entire project — app routes, persistence, state management, engine, DB schema, UI
panels, testing. Follows the cable-routing surgical fixes (see `cable-routing-fix-plan.md`).

## Current architecture map

```
Next.js server page (editor/[id]/page.tsx)
  └─ fetches config + library from Supabase, hand-maps snake_case → camelCase
     └─ EditorClient ('use client')
         ├─ initConfiguration → configuration-store (Zustand, source of truth + derived data)
         │     mutations → imperative cascade: recalculateCollisions →
         │     recalculateSignalChain (rules engine, MUTATES chainPosition/location) →
         │     recalculateCables (topology builder, cables/index.ts)
         ├─ EditorCanvas → routeAllCables (memoized) → CableRenderer (presentational)
         ├─ optimizeLayout → greedy placement + simulated annealing (synchronous, main thread)
         └─ handleSave → UPDATE configurations; DELETE + re-INSERT configuration_pedals
```

## What is sound

- Clean separation of pure engine (`lib/engine`) from React components; the engine is
  fully unit-testable (proven by the new vitest suite).
- Supabase SSR setup (middleware session refresh, protected paths, RLS-first schema) is
  the standard, correct pattern.
- Server component fetches + client editor split is right for this app.
- UI component layer (radix + tailwind) is conventional and consistent.
- DB schema is well-normalized (boards/rails, pedals/jacks, configurations/configuration_pedals)
  with sensible enums and constraints.

## Bugs found (fix regardless of architecture)

1. **Stale-closure save** — `editor-client.tsx:99-149`: `handleSave` is `useCallback([])` but
   reads `configStore.modulationInLoop` from the closure. The first-render snapshot is the
   store default (`false`, since `initConfiguration` runs in an effect after first render), so
   **saving always writes `modulation_in_loop: false`** regardless of the toggle. Everything
   else correctly uses `getState()`. Fix: read modulationInLoop from `getState()` too.
2. **Silent save failures** — the Supabase `update`/`delete`/`insert` results are never
   checked (`{ error }` ignored; supabase-js doesn't throw), so `markClean()` runs even when
   the save failed. User sees "saved", data is gone.
3. **Non-transactional destructive save** — `DELETE configuration_pedals` then `INSERT`;
   a failure between the two (network, RLS, validation) permanently deletes the user's board
   contents. No transaction, no rollback.
4. **Signal-chain engine clobbers manual ordering** — every `addPedal`/toggle triggers
   `recalculateSignalChain`, which rebuilds `chainPosition` from category rules. A user's
   manual reorder (via `updatePedalChainPosition`) survives only until the next add. The
   `chain_position_locked` column was created for exactly this (migration
   `20240109000001`) but **no code reads or writes it**.
5. **`splitByLocation` returns stale data** — `signal-chain/index.ts:45-48`: front/loop chains
   are computed before `assignChainPositions`, so `SignalChainResult.frontOfAmpChain`/
   `effectsLoopChain` carry pre-renumbering positions. (Currently unused by callers — which
   is itself a smell.)
6. **Unwired migrations** — `chain_position_locked` and `routing_type`/`routing_config`
   exist in the DB with zero application code. Either implement or drop before they drift.

## Architectural problems and proposals

### P1 — Replace the imperative recalculation cascade with a derived-state pipeline

The store persists *derived* data (`cables`, `collisions`, `warnings`, `suggestions`) and
keeps it fresh through hand-sequenced `recalculate*()` calls after every mutation. This is
the same disease that broke cable routing: multiple representations of the same truth,
synchronized manually. Today there are still three independent derivations of cable
topology (store `recalculateCables`, optimizer `routing-cost.ts` chain-walking, and the
4-cable categorization duplicated in `cables/index.ts` + `routing-cost.ts`).

**Proposal.** Make the store hold only source-of-truth state:
`{ board, amp, flags, placedPedals, name, description }`. Derive everything else in one
pure, memoized function:

```
deriveBoardState(config) → {
  orderedChains,      // signal-chain engine output (front + loop, per-segment numbering)
  cables,             // ONE topology builder (used by UI list, renderer, optimizer)
  routedCables,       // routeAllCables (already built)
  collisions,
  warnings, suggestions,
  cableLengths,       // from routed path length × slack — not euclidean × 1.2
}
```

Components subscribe to slices of the derived object. Mutations become one-liners; there is
no cascade to forget or mis-order; optimizer and renderer consume literally the same cables.
This also fixes cable-length estimates (currently straight-line × 1.2, unrelated to drawn
routes, and rounded to standard sizes from wrong inputs).

Effort: medium. Highest architectural leverage in the codebase — it eliminates the
"split brain" problem class permanently.

### P2 — Make persistence transactional, checked, and typed

- Move the save into a single Postgres function called via RPC
  (`save_configuration(config jsonb)`): update the row + replace pedals in one transaction.
  Alternatively a Next.js Server Action wrapping the same SQL. Either kills the
  delete-then-insert data-loss window.
- Check every Supabase response; surface failures in the UI (the `isSaving`/`isDirty`
  plumbing already exists).
- Generate DB types (`supabase gen types typescript`) and replace the ~150 lines of
  hand-written `Record<string, unknown>` casts in `editor/[id]/page.tsx` with typed rows +
  one small mapping layer. Today a renamed column fails silently at runtime.
- Add a debounced autosave (the dirty-tracking already exists); `beforeunload` is the only
  guard right now.

Effort: small-medium. Directly addresses the data-loss bugs above.

### P3 — Fix state subscription and main-thread optimization

- Every panel, the toolbar, and the canvas subscribe to the entire store
  (`useConfigurationStore()` with no selector) — any change re-renders the whole editor.
  Switch to selector subscriptions (`useConfigurationStore(s => s.cables)` /
  `useShallow`). Mechanical change, big win during drags.
- `optimizeLayout` runs simulated annealing synchronously: ~550 full cost evaluations, each
  routing every cable (possibly A*). Move it to a Web Worker (the optimizer is already pure
  and serializable), or replace SA with what it de facto is: greedy layout + a bounded local
  improvement pass. The current acceptance rule (`MIN_IMPROVEMENT = 5`, dampened
  probabilities) already prevents real annealing, so the SA machinery is cost without benefit.
- Fix the cost function it optimizes (both are engine bugs, not tuning):
  `calculateCableCollisionPenalty` includes source/destination boxes so every cable pays a
  constant ~100" penalty (pure noise — use `result.valid` from the shared router instead);
  `calculateSignalFlowPenalty` demands global right-to-left order across BOTH chains while
  the placer deliberately lays the FX-loop chain left-to-right — the optimizer is penalized
  for the intended layout. Signal-flow ordering should be evaluated per segment.

### P4 — Restructure the signal-chain rules as a data-driven pass

The 8 rules are imperative array shuffles with overlapping responsibilities (`looper-last`
and `volume-end` both re-sort; location rules and order rules are mixed; `wah` appears in
4-cable category lists but isn't a category — `filter` is). The rebuild plan's
`PLACEMENT_RULES` table is the right destination:

- One declarative table: `category → { segment, order, subOrder, impedanceSensitive }`.
- One pass: assign segment (respecting `locationOverride` and, once wired,
  `chain_position_locked`), then stable-sort by (segment, order, user-pinned position).
- Number chains per segment (`front: 1..n`, `loop: 1..m`) instead of one global sequence —
  today `chainPosition` interleaves both chains, which is why routing-cost and layout keep
  re-filtering and re-sorting defensively.
- Warnings/suggestions stay as separate read-only analyzers (they're fine).

Effort: medium; deletes more code than it adds and makes rule conflicts impossible by
construction.

### P5 — Delete the dead 30% of the engine

`optimizer-v2.ts` (768 lines, disabled loop, unreferenced), `engine/routing/index.ts`
(284 lines, zero importers), `optimizeForCableLength`, `calculateOptimalLayout`,
`calculateSimpleLayout`, `calculateEuclideanDistance`, plus the duplicated 4-cable category
lists once P1 lands. Dead code here isn't neutral: session logs show past sessions
"fixing" optimizer-v2 believing it shipped. ~1,900 lines removable.

### P6 — Editor UX architecture (smaller, as-needed)

- Undo/redo: `editor-store` has `canUndo/canRedo` flags with no implementation. With P1
  (single source-of-truth slice) undo becomes trivial — snapshot `placedPedals` + flags per
  mutation (or use `zundo`). Remove the flags until then.
- `editor-canvas.tsx` mixes gesture handling, coordinate math, add-pedal placement logic,
  and rendering; extract `useCanvasGestures()` / `useScreenToBoard()` hooks so the SVG tree
  is declarative.
- The `SignalChainEngine` class is a stateless singleton — make it plain functions like the
  rest of the engine.
- Long-term visual quality: Manhattan lane router (documented in
  `cable-routing-fix-plan.md`) — assign cables to channel lanes instead of independent
  per-cable pathfinding; eliminates residual overlap of unrelated cables sharing a channel.

### P7 — Quality gates

- CI (GitHub Action): `tsc --noEmit` + `vitest run` + `next build` + `eslint`. All four run
  locally today; nothing enforces them.
- Burn down the 93 pre-existing lint errors (mostly `no-explicit-any` in older files,
  3 `prefer-const`).
- Grow the vitest suite along P1/P4: signal-chain rule table tests, cable topology tests
  (4-cable, NS-2 loop, FX loop), and a save round-trip test against a local Supabase.

## Suggested sequence

1. P2 bug fixes (stale closure, error checking, RPC save) — small, protects user data now.
2. P5 dead-code deletion — makes every later change smaller.
3. P1 derived-state pipeline — the structural fix; do before adding features.
4. P4 rules table + per-segment numbering (+ wire `chain_position_locked`).
5. P3 selectors + worker/greedy optimizer + cost-function fixes.
6. P6/P7 continuously.
```
