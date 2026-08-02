# 8/2 Plan

Clearing the remainder of `.claude/docs/roadmap-next.md`, plus two gaps that
today's amp/board photo work surfaced.

Ordered by what it costs to be wrong, matching the roadmap's own convention.
Every claim below is grounded in a measurement or a code trace taken 2026-08-02,
quoted with it, so none of it has to be re-derived to decide whether it is worth
doing.

---

## Context

Six roadmap items are open, and only one of them is a correctness bug. The rest
are legibility, ergonomics, or contract hygiene. The photo work closed today
also left two data gaps worth recording rather than forgetting.

**Delivery: three grouped commits** — routing, then UI, then data — each
self-verifying, so work can stop cleanly at any group boundary.

| Group | Items | Why grouped |
|---|---|---|
| 1. Routing | P1.5, P4, P5 | All touch the router/placer; P4's fix is a consequence of P1.5 |
| 2. UI | P2, P3 | Both surface an engine decision the user currently cannot see |
| 3. Data | 13 jacks, 2 images | Research-bound, no engine risk |
| 4. Power supply | P1 second half | Designed here, built last, cuttable |

---

## Group 1 — Routing

### P1.5 — One router, not two *(the only correctness bug)*

**The defect.** The optimizer scores layouts with a different, more pessimistic
router than the one that draws them:

```
Optimize SCORES:  routing-cost.ts:193  → routeCableWithObstacles   (per-cable cascade)
The user SEES:    derived.ts:133 → route-cables.ts:287 → routeCablesWithLanes (batch, corridor model)
```

`routing-cost.ts:202-205` charges `CABLE_COLLISION_PENALTY_INCHES * 2` = **100
inch-equivalents** to `routingFailures` whenever `result.valid === false`. A
cable the corridor model routes cleanly can fail the cascade, so Optimize is
steered away from layouts that are demonstrably fine. Scored `cableLength` also
never accounts for lane jogs or `separateParallelRuns` shifts, so scored length
≠ drawn length even for cables that do route.

*(Detail — `strategy` is never scored. `'fallback-invalid'` is not matched by
name anywhere in the cost function; the only failure signal consumed is the
boolean `valid` from `validateCablePath`. The roadmap's phrasing implies
otherwise.)*

**Why it is tractable.** The inputs already line up:

- `routeCablesWithLanes(requests, obstacles)` needs *strictly less* than the
  cost function already holds — no board, no scale, no pedals, no RoutingConfig.
- `routing-cost.ts:141` already builds an identically-constructed `obstacles`
  (same `generateObstacles` call as `route-cables.ts:266`).
- Both cable sets come from the same `deriveSignalTopology` and are emitted in
  the same entry/chain/exit order (`cables/index.ts:195-227` vs
  `routing-cost.ts:215-235`).
- The tuple `addCableRoute` builds is already field-for-field `LaneRouteRequest`.

**The one structural obstacle.** The lane router is inherently **batch**:
`assignLanes` (`lanes/index.ts:309-338`) derives a cable's perpendicular lane
from how many cables share its corridor. Routed one at a time, every cable
centres in its corridor (n=1) — different geometry *and* zero lane separation.
The cost model's `addCableRoute` (`routing-cost.ts:188-213`) fuses request
construction with result accumulation, so it must be split into
collect → batch-route → accumulate. Nothing it accumulates has a cross-cable
dependency, and `detectCableCrossings` (`:238`) is already batch.

**Shape of the change.**

1. Extract the batch routing core into **`route-cables.ts` itself** — not a new
   file. `lane-spacing-authority.test.ts:14-22` asserts *by filename* that
   `cables/route-cables.ts` imports `LANE_SPACING` from geometry and does not
   redefine it; moving this logic elsewhere would silently satisfy that test
   while defeating its purpose.

   ```ts
   export interface RoutedPath {
     path: Point[]; strategy: RoutingStrategy | 'lane-router';
     valid: boolean; validation?: ValidationResult;
   }
   export function routeCablePaths(
     requests: LaneRouteRequest[], obstacles: ObstacleSet,
     options?: { laneRouter?: boolean },
   ): RoutedPath[]
   ```

   Body is `route-cables.ts:284-335` verbatim, minus the `cable`/`fromPos`/
   `toPos` fields the caller already holds. **No `board`, no `scale`** — see
   below.

2. `routeAllCables` keeps endpoint resolution and `Cable[]` mapping (the cost
   model has no `Cable` objects) and becomes a thin wrapper. It has **two**
   callers, not one: `derived.ts:133` and `editor-canvas.tsx:90` (drag preview).

3. `calculateRoutingCost` splits `addCableRoute` (`:188-213`) into **collect**
   (push a `LaneRouteRequest` + its id pair) and **accumulate** (today's
   per-cable arithmetic, unchanged). The segment walk at `:215-235` is
   *textually unchanged* — same call shape, same argument order — which is what
   keeps its correspondence to `cables/index.ts:197-229` visually verifiable.
   `detectCableCrossings` at `:238` is untouched and now sees drawn geometry.

**Correction to an earlier assumption: `separateParallelRuns` does NOT need
`board`/`scale`.** It uses them only at `route-cables.ts:124-127`, and
`generateObstacles` sets `boardBounds` to exactly those values
(`obstacles/index.ts:100-105`), so `-LANE_BOARD_OVERHANG ≡ boardBounds.minX -
LANE_BOARD_OVERHANG`. Derive from `obstacles.boardBounds` and delete the
parameters. The shared entry point takes `(requests, obstacles)` only.

**Scope decision: INCLUDE `separateParallelRuns` in the cost path.** Excluding
it would put the divergence back exactly where it hurts: it only does work on
cables the lane router *failed* to serve, which is precisely the straining
boards where cost-vs-render disagreement changes a decision. "The two routers
agree except when routing is hard" is the same defect in a smaller box. It also
changes **crossings**, not just length — nudging a co-linear cable onto an
adjacent lane can create or destroy an intersection that `detectCableCrossings`
counts at 8 inch-equivalents.

Add an early `if (movable && movable.size === 0) return;` at its top: when the
lane router serves every cable, all three sweeps currently do nothing but
re-collect runs. Free win for the renderer too, and it makes inclusion cost
~zero on well-routed boards. Land it in the extraction commit, where it is
provably behaviour-neutral.

**Fix a blind spot BEFORE unifying.** The lane router does *not* always run
`isPathClear` before returning a path — the facing-jack shortcut at
`lanes/index.ts:361-370` returns early, checking only that the two standoffs are
near-collinear and within `2*STANDOFF+1`. Nothing checks what is between them.
So `route-cables.ts:307`'s hardcoded `valid: true` is *unearned* for that
subset, and unification would propagate it straight into `routingFailures`. Gate
the shortcut on `isPathClear` first — otherwise an honest score improvement is
indistinguishable from an inherited blind spot.

**Performance: the risk is smaller than the roadmap implies. Measure, do not
pre-optimise.**

- `MAX_EVALUATIONS = 200` is a ceiling real boards never approach. The actual
  budget is `1 + (candidateOrders-1) + 2*nRotatable`; orders cap at 48
  (`index.ts:1001`) and rotations are ≤2 per pedal (180° is banned by
  `mayRotateTo`). A 12-pedal fully-rotatable board is ~72 evaluations.
- Measured baseline: `lane-router.test.ts`'s `wide/twelve` case — a *complete*
  `calculateOptimalLayoutJoint` plus a full render route — runs in **19ms**.
  There is roughly a 75× budget before a ~1.5s bar is threatened.
- **Memoising corridors is a non-starter.** Every evaluation calls
  `calculateGreedyPlacement` with a different order/rotation → different
  `tempPlacedPedals` → different `obstacles` → different corridor graph. Cache
  hit rate ≈ 0, and each `calculateRoutingCost` already builds corridors once.
- **Do not touch `MAX_EVALUATIONS`** — it would degrade search quality and
  confound the before/after comparison.
- If it does blow up, in order: the `movable.size === 0` early return;
  `findCorridorPath`'s `queue.sort` on every pop (`lanes/index.ts:277`);
  `traversals.find` in the realize loop (`lanes/index.ts:416-417`); and only
  then a `{ laneSeparation: false }` flag, never silently.

**Risk that unifying makes layouts WORSE** — four mechanisms, each with a
detection route:

- **(a) Loss of the failure gradient.** `routingFailures` is currently the
  dominant discriminator on hard boards. If it collapses toward 0 the landscape
  flattens, and since ties keep the baseline, **Optimize does nothing more
  often**. Detect: count non-zero `routingFailures` before/after, and compare
  "Already optimal - nothing moved." rates.
- **(b) The `assignLanes` cliff — watch this hardest.** It returns `false` on
  the *first* over-capacity corridor and *all* cables fall back
  (`lanes/index.ts:325`, `:407-410`). That is a step discontinuity worth
  ~100×nCables between neighbouring candidates — a genuinely new property of the
  cost landscape. Detect: instrument how often a full all-null-then-fallback
  occurs per Optimize. More than a few percent means `assignLanes` should
  degrade per-corridor instead (a separate change).
- **(c) The collision guard's precondition** — see the landmine note above.
  Static reading suggests it survives (overlapping boxes merge into one band, so
  no corridor exists between them and the cable still falls back and is still
  invalid), but the test decides, not the reasoning.
- **(d) Non-separability.** Cable geometry is now coupled across all cables via
  lane assignment. Not a correctness problem — nothing assumes separability —
  but it forecloses any future incremental-rescoring optimisation.

**Sequencing — the extraction lands separately, so the diff is readable:**

| Step | Change | Gate |
|---|---|---|
| 0 | Capture baseline fingerprint + perf numbers | — |
| 1 | Extract `routeCablePaths`; retarget `separateParallelRuns`; early return; wrapper | **Zero behaviour change** — suite green *and* byte-identical fingerprint |
| 2 | Gate the facing-jack shortcut on `isPathClear` | Fingerprint diff small and explainable |
| 3 | Switch `routing-cost.ts` to collect → route → accumulate | Green except the known strategy-set failure |
| 4 | Export `ROUTING_STRATEGIES`; fix the test; add parity tests | All green |
| 5 | Re-fingerprint, diff, re-measure | Checklist (a)–(d) |

**P1.5 is a cost-function rebalance, which trips a recorded landmine.**
`calculateOptimalLayoutJoint` has three collision guards. Mutation testing on
2026-08-01 found the `baselineEligible` guard (the user's own layout) is
currently unreachable — *because* a 0.02in overlap still scores ~4× worse than a
spaced layout, so a colliding baseline can never win on points. That
unreachability "is a property of the COST function, not of the guard, and cost
functions get rebalanced."

Removing up-to-100-inch `routingFailures` penalties **is** such a rebalance. So:
- Re-run the guard mutation test (disable each, run the suite) after P1.5.
- `placement-property.test.ts`'s "cannot profit from colliding, however small the
  overlap" is the tripwire that fires the day the baseline guard becomes
  load-bearing. It must still pass, and if it fails, the guard is now doing real
  work rather than being dead code.
- Do **not** delete the baseline guard as dead code at any point in this plan.

**Known breakage, and how to fix the class rather than the instance.**
`optimize-e2e.test.ts:74-85` asserts every `cableDetails[].strategy` is in a
hardcoded set that omits `'perimeter'` **and** `'lane-router'`. It passes today
only because no test board needs a perimeter route — verified: those 31 tests
pass in 575ms right now. Any unification breaks it.

Do not just add two strings. Invert the declaration in
`routing-strategies.ts:188-199`:

```ts
export const ROUTING_STRATEGIES = ['facing','direct',…,'perimeter','fallback-invalid'] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];
```

The test then checks against `[...ROUTING_STRATEGIES, 'lane-router']`. The type
is derived from the value, so adding a strategy can never again leave a
hardcoded test list stale.

**Pin the two paths together permanently** — finding the gap is the point of
P1.5, so close it with a test. New `__tests__/router-parity.test.ts`: over the
same cases `lane-router.test.ts:20-29` uses, run
`calculateOptimalLayoutJoint`, apply its placements/rotations/chainOrder exactly
as `simulate.ts:70-80` does, run the renderer path at those pedals, then assert
`cableDetails.length === routedCables.length` (catches the endpoint-drop
asymmetry: `route-cables.ts:280` silently skips unresolved endpoints,
`routing-cost.ts:170` cannot) and path-for-path equality of rounded coordinates
and strategy. Plus the cheap structural assertion in the
`lane-spacing-authority` style: `routing-cost.ts` must not match
`/routeCableWithObstacles/`.

Two setup details or it fails for the wrong reason: pass `makeAmp(true)` and
match `useEffectsLoop` (`derived.ts:132` uses `useEffectsLoop && amp?.hasEffectsLoop`
while `routing-cost.ts:146` synthesises a pseudo-amp — they agree only when the
amp has a loop), and use `scale = 40` on both sides.

---

### P4 — Lane separation on dense boards

Two cables running 1–2px apart for 150px read as one cable. Routes are legal and
distinct; the diagram's job is undermined.

Root cause is a **threshold mismatch plus a second lane authority**, not the
lane router:

- `LANE_SPACING = 12`, `MIN_LANE_SPACING = 9` live in `geometry/index.ts:80,89`
  and have a guard test pinning ownership (`lane-spacing-authority.test.ts`).
- But `LANE_TOLERANCE = 10` is declared **locally** in
  `route-cables.ts:84`, alongside `MIN_PARALLEL_OVERLAP = 12`. The post-pass
  `separateParallelRuns` accepts separation `>= 10` while the invariant
  `laneViolations` flags `< 9` — so the post-pass can "succeed" at 10px and the
  invariant is satisfied, yet the roadmap's measured violations were at 1–2px,
  meaning those cables were never moved at all.
- `separateParallelRuns` skips `!rc.valid` cables and pins lane-routed ones
  (`route-cables.ts:183`), so only fallback cables can move.

Do P4 **after** P1.5 and re-measure first: unifying the routers changes which
cables are lane-served vs fallback, which is exactly the population P4 is about.
The fix may be substantially smaller afterwards.

Move `LANE_TOLERANCE` into `geometry` under the existing single-authority test.

---

### P5 — `calculateGreedyPlacement`'s contract

`findValidPositionInZone` (`layout/index.ts:729-799`) has two returns with no
validity check — the narrow-zone bail at `:744-746` and the terminal clamp at
`:791-798` ("Truly full board - clamp within bounds (will show as a
collision)"). The return type is non-nullable, so callers have no failure branch.

Currently harmless: both production callers (`index.ts:941`, `:982`) go through
`calculateOptimalLayoutJoint`, which scores any colliding candidate `Infinity`
via `hasPlacementCollision`.

**Do not fix by returning null.** `index.ts:349-351` records that this was
already tried and turns a wrong answer into no answer.

Instead make the contract *honest* rather than *different*: return
`{ placements, degraded }`. `placementDegraded` already exists
(`index.ts:82`, set at `:285` and `:301`) and is consumed only by the internal
retry loop (`:565-596`) — it is **never returned**, so no caller can tell a
degraded placement from a clean one. Surfacing it costs nothing and feeds P2.

14 test call sites across 5 files reference `calculateGreedyPlacement`; a
tuple/object return touches all of them, so prefer adding an optional
out-parameter or a sibling `calculateGreedyPlacementWithDiagnostics` if the
churn is not worth it.

---

## Group 2 — UI

### P2 — Say *why* a board will not fit

Today: `routing-cost.ts:470-476`

> "Could not fit these pedals on this board - your layout was left alone. Try a
> larger board or removing a pedal."

Honest, not actionable. Phase 6 established the binding constraint is usually
**corridors, not area**: three rows of ~5.1in pedals on a 16in board leave 0.2in
between rows against a ~0.24in patch cable.

`noLegalCandidate` is not a capacity check at all — it is
`!anyLegalCandidate` (`index.ts:1113`), i.e. *every greedy candidate overlapped
or left the board*. There is no explicit area/depth test anywhere.

`deriveRows` (`rows.ts:106-172`) already computes everything needed and throws
it away, returning only `RowBand = {y, height}`:

| Discarded | Where | Why it matters |
|---|---|---|
| `gap` — corridor width | `rows.ts:121, 158-166` | Nobody downstream knows the corridor collapsed to `MIN_ROW_CLEARANCE` (0.15in) |
| `used` / `spare` / rejected `count` | `rows.ts:133-166` | The "needed X in, board has Y in" arithmetic |
| oversize-depth `continue` | `rows.ts:145` | A pedal deeper than every band silently becomes a straddler with no record |

**Cheap version:** widen `deriveRowBands`' return to include a `RowFit`
diagnostic, and have `summarizeOptimization` report the arithmetic that failed.
Feed P5's `degraded` flag in alongside.

Test pinning the current message: `optimize-e2e.test.ts:291-293` asserts
`s.headline` matches `/could not fit/i` and *not* `/already optimal/i`. Keep the
"could not fit" lead and append the arithmetic, so the assertion stays
meaningful rather than being loosened to accommodate the change.

---

### P3 — Show a perimeter cable as what it is

`routeAroundBoard` draws the cable that cannot fit between rows around the
outside of the board. Correct, and what a player actually does — run it
underneath — but on screen it is just a cable taking a strange path.

`RoutedCable.strategy` already carries `'perimeter'`
(`route-cables.ts:25-42`), so the data is present.
`cable-renderer.tsx:58` destructures `{ cable, path, valid, fromPos, toPos }` —
**it never reads `strategy`**. Stroke varies only by `cable.cableType` and
`valid` (`:65-68`).

Change: read `strategy`, dash the stroke for `'perimeter'`, and add a `<title>`
for the tooltip.

**The catch, and why it is safe here.** The wrapper `<g>` at
`cable-renderer.tsx:70` sets `pointerEvents: 'none'`, and that is load-bearing:
cables render *beneath* pedals (`editor-canvas.tsx:346-350`), so hit-testing
them would let a cable swallow the pointer when you drag a pedal sitting over
it. A `<title>` needs pointer events to show.

Resolution: enable pointer events **only on a perimeter cable's stroke**. A
perimeter route is by definition outside the board, where there are no pedals to
drag — so it cannot conflict. Do not lift `pointerEvents` on the group as a
whole.

Verify by extracting the drag behaviour, not by looking: confirm a pedal drag
still starts when the press lands on a cable (`.claude/scripts/verify-drag-undo.js`
already drives drags).

Smallest item on the list; do it first in Group 2 for a quick win.

---

## Group 3 — Data

### The 13 unresearched jack layouts

`node .claude/scripts/verify-pedal-jacks.js` — current state, measured today:

```
catalogue            67 pedals
confirmed            50
researched, unknown   4
NOT researched       13   (0 of them carry unattributed jack rows)
```

Approach: a research pass — manuals, Wayback captures of dead product pages,
retailer product photography — accepting some will still come up empty.

**Workflow:** edit `scraper/pedal_jacks.json` (the source of truth — a pedal's
rows are replaced wholesale by what the file says), then
`DRY_RUN=1 node scraper/import-pedal-jacks.js` before the real run. The
migration contract already enforces *jack rows exist ⇒ `jacks_source_url` set*,
and *confidence `unknown` ⇒ no rows at all* (a recorded absence, not a guess).

**Discipline that already applies:** record a source URL per jack, never invent
a layout, and prefer leaving a pedal unresearched over guessing. A product photo
is legitimate evidence (that is how the four owner pedals were resolved on
2026-08-01). Owner inspection is an accepted provenance value. Sides are
board-relative, documented in the JSON's `_readme`.

The 13, from `--list`: Cry Baby GCB95, Fuzz Face, Big Muff Pi, Holy Grail,
Small Clone, TS9 Tube Screamer, Klon Centaur, Carbon Copy, Dyna Comp, Phase 90,
RAT 2, Ditto Looper, Polytune 3.

Mostly 1990s-and-earlier analogue pedals whose makers never published a jack
diagram — the reason this stalled. Two angles that have not been tried:
the Klon and the Fuzz Face are heavily photographed by collectors, and several
(Cry Baby, RAT 2, Phase 90) are current production with printed manuals whose
*mechanical* drawings may show jack positions even though the text does not.

The separate "researched, unknown" 4 are BOSS multi-FX/large-format units
(SY-300, XS-100, MD-500, IR-2) — already looked at, layout genuinely
undetermined. Leave them.

### Two image gaps

- **Vox AC30 is 368×295** — the weakest of the 19 mirrored, soft above card
  size. Vox publishes nothing larger on that page. Try a Wayback capture of the
  older voxamps.com AC30 page; `provenanceFor` already resolves an archived
  URL's inner licence correctly.
- **Marshall JCM2000 DSL has no photo** — discontinued, no marshall.com page,
  no Wayback capture (CDX returns `[]`). Wikimedia Commons is the remaining
  route. **Check the licence per file:** CC BY or PD is fine and the unused
  `image_attribution` column exists for the credit line. **Avoid CC BY-SA** —
  our knockout creates a derivative and share-alike would reach our output.
  That is the recorded Klon trap.

If neither source pans out, leave both as-is and update `UNSOURCED` — the
current state is already honest.

---

## Group 4 — Power supply *(designed here, built last)*

The demand half shipped 2026-08-01. The supply half is unbuilt, and is larger
than everything above combined, so it is sequenced last and is cuttable.

Current state: **there is no supply entity anywhere.** No output count, no
per-output capacity, no assignment. `TYPICAL_OUTPUT_MA = 100`
(`power/index.ts:27`) is explicitly documented as "not a limit this module
enforces". `PowerSummary` is purely demand-side:

```ts
{ knownTotalMa, unknown[], pedalCount, highDraw[], byVoltage[] }
```

It is derived non-persistently at `derived.ts:153` and rendered by
`power-panel.tsx`.

To say "output 3 is over" rather than "the board wants 986mA" needs: a supplies
table + migration, a per-output rating model, a pedal→output assignment
persisted on the configuration, and assignment UI in the Power tab.

**The tri-state trap must survive all of it:** `currentMa` null ≠ 0. A `?? 0`
anywhere turns "we do not know" into "free" and reports an inadequate supply as
adequate. The catalogue has exactly one pedal with no recorded draw (IR-200) and
it is on nobody's board, so the null path cannot be reached by clicking around —
`PROBE_UNKNOWN=1 node .claude/scripts/verify-power-panel.js` injects it.

Build only if the app should plan wiring rather than report demand.

---

## Files to modify

| Group | Files |
|---|---|
| P1.5 | `cables/route-cables.ts` (extract `routeCablePaths`, retarget `separateParallelRuns` :117-245, wrapper :256-345); `layout/routing-cost.ts` (split `addCableRoute` :188-213, drop import :25); `lanes/index.ts` (gate shortcut :361-370); `cables/routing-strategies.ts` (export `ROUTING_STRATEGIES` :188-199); `layout/__tests__/optimize-e2e.test.ts` (:81-85); **new** `__tests__/router-parity.test.ts`; **new, env-gated** `__tests__/saved-board-fingerprint.test.ts` |
| P4 | `geometry/index.ts` (adopt `LANE_TOLERANCE`); `cables/route-cables.ts` (:84); `__tests__/lane-spacing-authority.test.ts` (extend guard) |
| P5 | `layout/index.ts` (`findValidPositionInZone` :729-799, surface `placementDegraded` from :82) |
| P2 | `layout/rows.ts` (widen return), `layout/routing-cost.ts` (:470-476 headline), `components/editor/toolbar/optimization-summary.tsx` |
| P3 | `components/editor/canvas/cable-renderer.tsx` (:58, :70) |
| Data | `scraper/pedal_jacks.json` + `scraper/import-pedal-jacks.js`; `scraper/mirror-gear-images.js` (`AMP_SOURCES`, `UNSOURCED`) |
| Power | **new** migration + supplies table; `lib/engine/power/index.ts`; `components/editor/panels/power-panel.tsx`; `store/derived.ts` (:153) |

---

## Verification

Per group:

- **P1.5** — step 1 must be byte-identical fingerprint (proves the extraction is
  behaviour-neutral); then fingerprint diff on both saved boards after step 3;
  `config-matrix.test.ts` (its determinism check at `:232-233` is the guard
  against ordering sensitivity the batch coupling could introduce); re-run the
  collision-guard mutation test; three perf numbers — evaluation count,
  per-call `calculateRoutingCost` over 1000 iterations on the `wide/twelve`
  fixture, and wall-clock `calculateOptimalLayoutJoint` on both real boards.

  Not modified, deliberately: `layout/index.ts` (`MAX_EVALUATIONS` stays),
  `store/derived.ts`, `editor-canvas.tsx`, and
  `__tests__/lane-spacing-authority.test.ts` — preserved precisely by keeping
  `separateParallelRuns` in `route-cables.ts`.

  Expect `complexRouting` to shift: its `path.length > 3` test will be true for
  essentially every lane-router path, but it is already true for almost every
  cascade path (`direct` alone is 4 points), so it should become a constant
  offset that cancels in `summarizeOptimization`. **Measure it; do not re-tune
  it in this change** — note as a follow-up.
- **P4** — `laneViolations` on the real boards must go to zero; the
  single-authority test must cover `LANE_TOLERANCE`.
- **P5** — the 14 existing call sites must still compile and pass; a new
  assertion that a degraded placement is reported as degraded.
- **P2** — `optimize-e2e.test.ts:291-293` still passes; a new test that the
  headline names the failing arithmetic.
- **P3** — extract the drag behaviour with a pedal over a cable; confirm the
  dashed stroke applies only to `strategy === 'perimeter'`.
- **Data** — `verify-pedal-jacks.js` count moves; `verify-gear-images.js` still
  PASSes; provenance violations stay 0.

Baselines measured 2026-08-02, before any change:

```
vitest run                      21 files, 254 tests pass, ~1.2s
optimize-e2e + lane-router      31 tests pass, 575ms
verify-gear-images.js           PASS - every card renders as expected
provenance                      pedals 67/62 photos, amps 12/11, boards 8/8, 0 violations
verify-pedal-jacks.js           50 confirmed / 4 researched-unknown / 13 not researched
```

**Fingerprint corpus** for before/after comparison on real data —
`node .claude/scripts/dump-configs-offline.js /tmp/configs-baseline.json`
(no server, no browser; it correctly loads `board_rails`, which matters because
a railless board derives rows and scores `rowAlignment` differently):

```
J$ Home    9 pedals
test      20 pedals
```

**The replay side must be a vitest file, not a standalone script** — verified:
`tsx`, `vite-node` and `ts-node` are all absent; only `vite` and `vitest` are in
`node_modules/.bin`. So add `__tests__/saved-board-fingerprint.test.ts` gated on
`describe.skipIf(!process.env.PEDAL_CONFIG_DUMP)` so CI is unaffected. It should
print, per config: `totalScore`, `totalLengthInches`, `crossingCount`, every
dimension's value and count, `cableDetails.map(d => [strategy, round2(routedDistance)])`,
a position snapshot (reuse `config-matrix.test.ts:148-152`), and the
`summarizeOptimization()` headline.

What to look for, in order: (i) did `routingFailures` go to zero and did
anything *else* get worse to compensate; (ii) did any board's headline change
from a real improvement to "Already optimal"; (iii) did `totalLengthInches` on
the **final chosen** layout go up. (i) plus (iii) together is the honest failure
signal — the score improved because the router got optimistic, while the cable
the user actually has to buy got longer.

*(Aside: `.claude/scripts/verify-optimizer.ts` says "run with npx tsx" and
imports `optimizer-v2` — it is currently unrunnable and points at a non-live
code path. Worth deleting or fixing while in here.)*

Two boards is a thin corpus, so it proves "did not change the real boards", not
"is better in general". For the general claim use `config-matrix.test.ts`, which
sweeps boards × pedal sets × every configuration combination and already asserts
`laneViolations` empty, determinism and idempotence.

**Compare sweeps by trial ID, not by count.** A net improvement can hide an
equal-sized swap; `comm -23` / `comm -13` on sorted failing-trial lists exposes
it. This is a recorded lesson from the straddler work, where 165 fixed / 146
broken looked like a 240→221 improvement.
