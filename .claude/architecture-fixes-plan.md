# Architecture Fixes — Implementation Plan (2026-07-15)

Implements the reviewed proposals from `.claude/architecture-review.md` in the recommended
order (P2 → P5 → P3 → P4-lite), scoped to what is safely verifiable in this pass.

## Phase 1 — P2: Save-path integrity (`editor-client.tsx`)

1. **Stale closure fix**: `handleSave` reads everything from
   `useConfigurationStore.getState()` — including `modulationInLoop`, which today is
   captured from the first-render snapshot and always saves `false`.
2. **Error checking**: every Supabase call's `{ error }` is checked; on failure the config
   stays dirty (toolbar keeps showing unsaved state) and the error is logged. `markClean()`
   only on full success.
3. **Kill the data-loss window** — no DB migration needed. RLS on `configuration_pedals`
   is `FOR ALL` for the owner, so upsert is allowed:
   - Save now sends rows WITH their client ids (`id: p.id`) via
     `upsert(..., { onConflict: 'id' })` — updates existing rows, inserts new ones.
   - Then prunes rows not in the current set (`delete ... not in (ids)`).
   - Worst-case failure mode flips from "all pedals deleted" to "stale rows remain until
     next save". Stable ids also stop the id churn (store ids previously diverged from DB
     ids after every save).
   - True single-transaction atomicity would need an RPC; deferred (see Deferred).
4. Add missing `modulationInLoop` to the init-effect dependency list.

## Phase 2 — P5: Dead code deletion

- Delete `src/lib/engine/layout/optimizer-v2.ts` (768 lines, unreferenced, loop disabled).
- Delete `src/lib/engine/routing/` (284 lines, zero importers).
- Remove unused exports: `calculateOptimalLayout`, `calculateSimpleLayout`
  (layout/index.ts), `optimizeForCableLength`, `calculateScore` (optimizer.ts).
- Clean orphaned imports flagged by lint (store, cables/index, routing-cost) and the three
  pre-existing `prefer-const` errors in cables/index.ts.

## Phase 3 — P3a: Store selector subscriptions

Every consumer currently does `useConfigurationStore()` bare → whole-editor re-render on
any change. Convert all 8 consumers (toolbar, 5 panels, canvas, editor-client) to
`useShallow` selector subscriptions. Same for the couple of bare `useEditorStore()` uses in
the same files. Mechanical, no behavior change.

## Phase 4 — P3b: Optimizer cost-function correctness (routing-cost.ts)

- **Delete `calculateCableCollisionPenalty`**: it re-checks every segment against ALL boxes
  including each cable's own source/destination, so every cable pays a constant ~100"
  penalty in every candidate layout — pure noise. The existing
  `validationFailurePenalty` already penalizes genuinely invalid paths using the shared
  validator with correct exclusions.
- **Per-segment signal-flow penalty**: evaluate front-of-amp chain as right-to-left and the
  FX-loop chain as left-to-right (matching the placer), instead of demanding global
  right-to-left across both chains — which penalized the optimizer 100"/pedal for the
  intended loop layout.

## Phase 5 — P4-lite: Manual chain ordering that survives (wire `chain_position_locked`)

The DB column exists (migration 20240109000001) but nothing uses it, and
`updatePedalChainPosition` has no UI caller — manual reordering is unreachable today, and
the rules engine renumbers everything on every `addPedal`.

- `PlacedPedal.chainPositionLocked?: boolean` in types; loaded in `page.tsx`; saved in
  `handleSave`.
- `updatePedalChainPosition` sets `chainPositionLocked = true` on the moved pedal; new
  store action `setChainPositionLocked` to unlock.
- Signal-chain engine: locked pedals are excluded from rule processing and re-inserted at
  their pinned slot after unlocked pedals are ordered; renumbering happens last.
- Fix the stale `splitByLocation` result (split AFTER position assignment).
- Signal-chain panel: up/down reorder buttons per pedal (calls
  `updatePedalChainPosition`) and a lock badge that unlocks on click — makes the whole
  mechanism reachable.

## Phase 6 — Tests + verification

- New vitest suite for the signal-chain engine: category default ordering, locked-pedal
  preservation across adds, fresh chain positions in split results.
- Full gate: `tsc --noEmit`, `vitest run`, `next build`, eslint on changed files.
- Save-path runtime behavior against live Supabase cannot be exercised here → reported as
  UNVERIFIED with exact manual steps.

## Explicitly deferred (from the review, in recommended future order)

1. **P1 full derived-state pipeline** — correct end-state, but chain normalization
   currently *mutates* `placedPedals` (it's canonicalization, not derivation); the lock
   semantics from Phase 5 need to exist first so that "derived chain order" and "user
   intent" are separable. Do next session.
2. **RPC transactional save + generated Supabase types** (`supabase gen types`) and the
   page.tsx mapping rewrite.
3. **Web Worker for the optimizer** (or replacing SA with bounded local search).
4. **Manhattan lane router** for parallel-cable aesthetics.
5. **Undo/redo** (trivial after P1), CI workflow, remaining lint burn-down.

---

# Follow-on session: P1 derived-state pipeline + CI (2026-07-15)

## P1 — Derived-state pipeline

Source of truth in the store shrinks to: `id, name, description, board, amp, flags,
placedPedals, pedalsById, routingConfig, isDirty, isSaving`. The four derived fields
(`cables`, `collisions`, `warnings`, `suggestions`) and the three `recalculate*` actions
are REMOVED.

- **Normalization stays imperative but becomes one function**: `normalizeChain()` runs the
  rules engine and writes back `chainPosition`/`location` (respecting locks). Called only
  from chain-affecting mutations (add/remove pedal, amp/flag changes, location change,
  unlock). Position-only mutations (move/rotate/reorder/loop-toggles) call nothing.
- **Derivation is pure and memoized**: new `src/store/derived.ts` exports
  `deriveBoardState(sourceSlice)` → `{ cables, routedCables, collisions, warnings,
  suggestions }` with last-call memoization on input identities (immer gives new
  references only for changed slices). Cable ROUTING moves in here too — the canvas stops
  owning it.
- **Hook**: `useDerivedConfiguration(selector)` wraps
  `useConfigurationStore(useShallow(s => selector(deriveBoardState(s))))`. Because the
  derived object is identity-stable per state version, components re-render only when
  their slice actually changes.
- Engine gets a public `analyze()` (warnings/suggestions WITHOUT reordering) so derivation
  cannot mutate order.
- Consumers updated: canvas (routedCables, collisions), toolbar (collisions),
  cable-list (cables), properties (collisions), signal-chain panel (warnings/suggestions).
- Known break: `.claude/scripts/test-fixture.js` reads `getState().cables` — debug script,
  will be updated to note the new source.

## CI (P7)

`.github/workflows/ci.yml`: on push/PR → npm ci, tsc --noEmit, vitest run, next build.

## Verification

tsc + vitest (existing 14 + new derive tests: correctness and memoization identity) +
build + eslint on changed files.
