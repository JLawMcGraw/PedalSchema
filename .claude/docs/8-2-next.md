# What to do next (2026-08-02, after P1.5)

> **STATUS: P0, P2–P7 are all done.** See § Outcome at the foot of this file
> for what the work actually proved — including that this document's diagnosis
> of the cable-length regression was wrong twice, and what it turned out to be.
> Remaining: Group 3 (research) and Group 4 (gated on a product decision).

Successor to `8-2-plan.md`, written after P1.5 landed on `routing/one-router`.
Same convention: ordered by what it costs to be wrong, every claim tied to a
measurement or code trace taken today rather than to recollection.

P1.5 did not just close a roadmap item. It surfaced one finding that **reorders
everything below it**, and demotes the follow-up P1.5 itself named.

---

## The finding that reorders the list

P1.5 made the optimizer score the geometry it draws. That immediately exposed
something the renderer had been quietly absorbing:

```
Cables served by the corridor router, drawn side, both saved boards

                  BEFORE P1.5        AFTER P1.5
J$ Home (9)       10 / 10            1 / 10        <-- collapse
test (20)         18 / 21            18 / 21       unchanged
```

**On J$ Home the corridor router now serves one cable in ten.** And the one
survivor is not a survivor: it is the 0.5in facing-jack pair, which is written
straight into `paths[index]` by the shortcut at `lanes/index.ts:360-380` and
never enters lane assignment at all. Of the cables that actually reach the
corridor graph, **zero** are served.

**Corroborated live, and refined.** `node .claude/scripts/verify-optimize.js`
reads the real app rather than the harness:

```
Classic Jr 18x12.5   9 pedals, 11 cables    lane-router cables:  1 -> 1
Classic Pro 32x16   20 pedals, 21 cables    lane-router cables: 18 -> 18
```

The Classic Jr renders **1 of 11** lane-served on the *saved* board, before any
Optimize runs. Rendering is untouched by P1.5 — step 1 was byte-identical — so
**the cliff was already firing on that board.** P1.5 did not cause it. What P1.5
changed is which side of it the optimizer lands on: the old scorer happened to
choose a layout that was 10/10 lane-served, the new one chooses 1/10.

That makes P6 worse, not better. Honest scoring ought to *prefer* layouts the
corridor router can serve. Instead it is picking one it cannot — because when
the cliff fires, every cable falls back at once and the resulting cascade
geometry scores better on crossings than a partially-laned board would.

The cliff is `assignLanes` failing wholesale, and the code says so plainly:

```ts
// lanes/index.ts:325 - inside the per-corridor loop
if (spacing < MIN_LANE_SPACING) return false;   // over capacity

// lanes/index.ts:431-433
if (!assignLanes(corridors, traversals)) {
  // Corridor over capacity somewhere - let every planned cable fall back
  return { paths: paths.map((p) => p ?? null) };
}
```

One over-capacity corridor anywhere on the board discards the lane assignment
for **every** cable. This is risk (b) from `8-2-plan.md`, the one it said to
"watch this hardest," firing on a real user board.

---

## P6 — `assignLanes` must degrade per corridor, not per board

*(The only correctness item. Everything else on this list is legibility,
ergonomics, or research.)*

**Why it is newly urgent.** Before P1.5 the cost function never called the lane
router, so this cliff only affected what was drawn. It is now a **step
discontinuity in the cost landscape** worth roughly `100 x nCables` between
candidate layouts that differ by a quarter inch of pedal position — one
corridor tips over capacity and every cable's geometry changes at once.
Optimize is choosing between layouts across that cliff.

**The hypothesis to test first, before anything else on this list.** P1.5 left a
recorded regression: J$ Home's drawn cable went 45.05in → 63.70in, attributed
to `CROSSING_PENALTY_INCHES = 8` being applied to true geometry for the first
time. **That attribution is now doubtful.** The same board is also the one where
lane assignment collapsed, and cascade fallback paths are longer than corridor
paths. Two candidate causes, one board:

| Hypothesis | Prediction if true |
|---|---|
| Crossing exchange rate | Lowering `CROSSING_PENALTY_INCHES` recovers the 18.65in |
| The cliff (this item) | Fixing `assignLanes` recovers it with the penalty untouched |

Test the cliff first. It is the one that is a defect either way, and if it is
the cause then re-tuning a global weight to compensate would have been exactly
the overfitting `8-2-plan.md` warned about.

**Shape of the fix.** Fail the corridor, not the board. When a corridor cannot
seat `n` lanes at `MIN_LANE_SPACING`, drop the cables that cannot fit — cheapest
first, by traversal length — and let *those* fall back, leaving every other
cable's lane intact. `assignLanes` returns the set that could not be seated
instead of a boolean; the realize loop skips them; the caller falls back per
cable exactly as it already does for `planned[i] === null`.

**Do not** raise `LANE_SPACING` or lower `MIN_LANE_SPACING` to make the symptom
go away. `geometry/index.ts:80,89` documents why both exist, and
`lane-spacing-authority.test.ts` guards their ownership.

**Verification.** The instrumentation the cliff needs does not exist, so build it
first: count all-null-then-fallback events per Optimize and per render. Then:

- J$ Home's lane-served count must recover toward 10/10, measured the same way
  as the table above (`DRAWN CABLES` strategy tally in the fingerprint).
- Re-run the fingerprint. If drawn cable length returns toward 45in with
  `CROSSING_PENALTY_INCHES` untouched, the crossing item below is closed as a
  red herring — say so explicitly rather than leaving both open.
- `config-matrix` compared **by trial ID**, not by count.
- `router-parity.test.ts` must stay green: it is now the thing standing between
  scoring and drawing.

---

## P0 — The gates could not see a totally broken feature *(fixed, but read this)*

Between P1.5 landing and this being noticed, **Optimize was completely dead**:
the button spun forever on every click. Meanwhile:

```
vitest run                    269 passing
saved-board fingerprint       byte-identical
router-parity                 9/9 green
tsc --noEmit                  clean
```

Every one of those runs the engine **in Node**, where `window` genuinely does
not exist and a `typeof window` guard behaves correctly. The optimizer ships
inside a Web Worker, which bundlers build as a *client* bundle — so the same
guard folds to `true` and the window access throws. `engine/debug-flag.ts` was
written after this bit the first time; P1.5 pulled `cables/route-cables.ts`
into the worker's import graph and it bit again, harder, because a
module-level throw kills the worker before `self.onmessage` exists, so
`run-optimize`'s inline fallback never runs and the promise never settles.

Two guards now exist, and they are not redundant:

| Guard | Catches | Runs |
|---|---|---|
| `__tests__/worker-safety.test.ts` | the known pattern, statically, over the worker's actual import graph | CI, milliseconds |
| `.claude/scripts/verify-optimize.js` | the real thing failing by any mechanism | manual, needs a dev server |

`verify-optimize.js` asserts three things separately, because each has failed
on its own: the run **settles**, **nothing fell back inline** (the silent mode —
the feature "works" while freezing the editor), and there are **no page
errors**.

**Standing instruction for the rest of this list: any change that adds an
import edge into `layout/` must be verified in the browser, not only in Node.**
P6 and P7 both touch `lanes/` and `routing-cost.ts`, which are squarely in the
worker's graph.

---

## P7 — What is a crossing worth?

**Blocked on P6.** `CROSSING_PENALTY_INCHES = 8` (`routing-cost.ts:38`) means 3
crossings are worth 24 inch-equivalents, and P1.5 applied that rate to true
geometry for the first time. If P6 recovers J$ Home, this stops being urgent and
becomes a deliberate tuning exercise with no fire under it.

If it is still live after P6: sweep against both saved boards **and**
`config-matrix`, comparing trial IDs. Two boards is far too thin a corpus to tune
a global weight against on its own — `8-2-plan.md` records the straddler lesson
where 165 fixed / 146 broken read as a 240→221 improvement.

---

## P4 — Lane separation on dense boards *(re-measured, and it grew)*

`8-2-plan.md` said to do P4 after P1.5 and re-measure first, because unification
changes which cables are lane-served versus fallback, and fallback cables are the
only ones `separateParallelRuns` may move (`route-cables.ts:183`).

**It changed a lot.** On J$ Home the movable population went from **0 of 10** to
**9 of 10**. The pass that was inert on that board is now doing nearly all the
work on it. So P4 is bigger than the roadmap sized it — but it is also
**downstream of P6**: fix the cliff and the movable population shrinks back
toward zero, which may make P4 small again or moot on this board.

**Do P6 first, then re-measure P4 a second time.** The original defect stands
regardless: `LANE_TOLERANCE = 10` is declared locally at `route-cables.ts:84`
while the `laneViolations` invariant flags `< 9` (`MIN_LANE_SPACING`,
`geometry/index.ts:89`), so the post-pass can "succeed" at 10px against an
invariant satisfied at 9. Move `LANE_TOLERANCE` into `geometry` under the
existing single-authority test either way — that is a one-line ownership fix
with a guard test already built for it.

---

## P5 — `calculateGreedyPlacement`'s contract

Unchanged by today's work; carried forward from `8-2-plan.md` intact.

`findValidPositionInZone` (`layout/index.ts:728-799`) has two returns with no
validity check and a non-nullable return type, so callers have no failure
branch. Harmless today because both production callers go through
`calculateOptimalLayoutJoint`, which scores colliding candidates `Infinity`.

Make the contract honest rather than different: surface `placementDegraded`,
which already exists (`layout/index.ts:82`, set at `:285` and `:301`) and is
consumed only by the internal retry loop — **it is never returned**, so no caller
can distinguish a degraded placement from a clean one. Do **not** fix by
returning null; `index.ts:349-351` records that being tried and turning a wrong
answer into no answer.

15 invocations across 5 test files, plus a prose reference at `debug-flag.ts:11`.
Prefer a sibling `calculateGreedyPlacementWithDiagnostics` over churning all of
them.

Feeds P2 directly.

---

## P2 — Say *why* a board will not fit

Unchanged and still worth doing. `deriveRows` (`rows.ts:111-175`) already
computes the corridor width, the used/spare arithmetic and the rejected count,
then discards all of it and returns only `RowBand = {y, height}`. `noLegalCandidate`
is not a capacity check — it is `!anyLegalCandidate` (`layout/index.ts:1113`),
i.e. every greedy candidate overlapped or left the board.

Widen `deriveRowBands`' return with a `RowFit` diagnostic, report the arithmetic
in `summarizeOptimization`, and feed P5's `degraded` flag in alongside. Keep the
"could not fit" lead so `optimize-e2e.test.ts:291-293` stays meaningful rather
than being loosened to accommodate the change.

---

## P3 — Perimeter cables *(shrunk — verify it still has a subject)*

**Measured today: `perimeter` never reaches the screen on either saved board.**
It appears only in the cost path, and after P1.5 it is rarer there too. So the
roadmap's framing — "on screen it is just a cable taking a strange path" — does
not describe anything either board currently does.

Still cheap and still correct: `cable-renderer.tsx:58` destructures without
reading `strategy`, so dash the stroke for `'perimeter'` and add a `<title>`.
Enable pointer events **only on a perimeter cable's stroke** — the wrapper `<g>`
at `cable-renderer.tsx:71` sets `pointerEvents: 'none'` and that is load-bearing,
because cables render beneath pedals (`editor-canvas.tsx:346-350`) and would
otherwise swallow the pointer during a drag.

**Before building it, confirm it has a subject.** If no board in `config-matrix`
produces a drawn perimeter route either, this is decoration on a code path users
never see, and it belongs below the data work rather than above it.

---

## Group 3 — Data *(unblocked, independent, good filler)*

Needs no vitest and touches no engine code, so it parallelizes cleanly against
everything above.

**13 unresearched jack layouts**, re-confirmed today:

```
catalogue            67 pedals
confirmed            50
researched, unknown   4      (BOSS multi-FX - genuinely undetermined, leave them)
NOT researched       13
```

Cry Baby GCB95, Fuzz Face, Big Muff Pi, Holy Grail, Small Clone, TS9, Klon
Centaur, Carbon Copy, Dyna Comp, Phase 90, RAT 2, Ditto Looper, Polytune 3.

Two angles not yet tried: the Klon and Fuzz Face are heavily photographed by
collectors, and Cry Baby / RAT 2 / Phase 90 are current production whose printed
manuals may carry mechanical drawings even where the text does not.

Workflow: edit `scraper/pedal_jacks.json`, then `DRY_RUN=1 node
scraper/import-pedal-jacks.js` before the real run. Record a source URL per jack;
never invent a layout; prefer leaving a pedal unresearched over guessing.

**Two image gaps.** Vox AC30 is 368×295 (weakest of the 19) — try a Wayback
capture of the older voxamps.com page. Marshall JCM2000 DSL has no photo and no
Wayback capture; Wikimedia Commons is the remaining route, and **licence must be
checked per file** — CC BY or PD is fine, avoid CC BY-SA because our knockout
creates a derivative. That is the recorded Klon trap.

---

## Group 4 — Power supply *(unchanged: designed, unbuilt, cuttable)*

Still larger than everything above combined. There is no supply entity anywhere:
no output count, no per-output capacity, no assignment. `TYPICAL_OUTPUT_MA = 100`
(`power/index.ts:27`) is documented as "not a limit this module enforces".

The tri-state trap survives all of it: `currentMa` null ≠ 0, and a `?? 0`
anywhere reports an inadequate supply as adequate. Only IR-200 has no recorded
draw and it is on nobody's board, so the null path cannot be reached by clicking
— `PROBE_UNKNOWN=1 node .claude/scripts/verify-power-panel.js` injects it.

Build only if the app should plan wiring rather than report demand.

---

## Housekeeping, cheap, do while passing through

| Item | Why | Where |
|---|---|---|
| Fix the worker's cost comment | Says "seconds of solid computation" for a 20-pedal board; measured 127.3ms after P1.5, 367.9ms before. 3x pessimistic in the file that exists to justify the worker | `layout/optimize.worker.ts:4-8` |
| Delete or fix `verify-optimizer.ts` | Says "run with npx tsx" — tsx is not installed — and imports `optimizer-v2`, a non-live path. Currently unrunnable | `.claude/scripts/verify-optimizer.ts` |
| Confirm the rolldown binding | `@rolldown/binding-win32-x64-msvc` was installed `--no-save` to work around the npm optional-dep bug. A clean `npm i` on Node 24 should pick it up properly — verify, so the next machine does not hit the same wall | `package-lock.json` |
| Decide the branch | 5 commits on `routing/one-router`, suite 266 green. Merge, PR, or keep accumulating Group 1 | — |

---

## Suggested order

0. **P0 is already done** — but its standing instruction applies to everything
   below: browser-verify anything that touches the worker's import graph.
1. **P6** — instrument the cliff, fix `assignLanes` to degrade per corridor,
   re-measure. This is the only correctness item and it probably subsumes P7.
2. **P7** — only if P6 does not recover J$ Home.
3. **P4** — re-measure a second time after P6; land the `LANE_TOLERANCE`
   ownership fix regardless.
4. **P5 → P2** — in that order; P5 feeds P2.
5. **Group 3** — anytime, in parallel, by anyone.
6. **P3** — after confirming it has a live subject.
7. **Group 4** — only on a decision that the app should plan wiring.

Housekeeping folds into whichever of these touches the same file.

---

## What this list assumes, and how to check it cheaply

Everything above rests on two saved boards, which proves "did not change the real
boards" and not "is better in general." For the general claim use
`config-matrix`, which sweeps boards × pedal sets × configuration combinations
and already asserts `laneViolations` empty, determinism and idempotence.

Baseline for all of it:

```
vitest run                    25 files, 269 tests pass, ~1.7s   (Node 24.18.1)
router-parity                 9 tests - scored geometry == drawn geometry
worker-safety                 3 tests - worker import graph is window-free
fingerprint corpus            J$ Home 9 pedals / test 20 pedals
node .claude/scripts/dump-configs-offline.js <out>
PEDAL_CONFIG_DUMP=<out> PEDAL_FINGERPRINT_OUT=<fp> npx vitest run saved-board-fingerprint
```

And the one that runs nothing in Node — needs `npm run dev` up:

```
node .claude/scripts/verify-optimize.js
  Classic Jr  18x12.5   9 pedals, 11 cables   settled  81ms   lane-router  1 -> 1
  Classic Pro 32x16    20 pedals, 21 cables   settled 201ms   lane-router 18 -> 18
  PASS - Optimize runs on the worker, settles, and never falls back inline
```

---

## Outcome — 2026-08-02

All of P0 and P2–P7 landed on `routing/one-router`. Suite 279 green, browser
gate passing, fingerprint stable.

### The cable-length regression: this document was wrong twice

P1.5 left J$ Home drawing 63.70in against a 45.05in baseline. This plan named
two candidate causes and set up a test to separate them. **Both were wrong**,
and both were killed by measurement rather than argument:

| Hypothesis | Prediction | Result |
|---|---|---|
| The `assignLanes` cliff (P6) | Fixing it recovers the 18.65in | 63.70 → **62.60in**. Falsified. |
| `CROSSING_PENALTY_INCHES` (P7) | Re-weighting recovers it | Swept 2/4/6/8 — **identical layout at every value**. Falsified. |

The actual cause was neither. Scoring the pre-P1.5 layout with today's cost
function showed it winning by **33.56** — so the optimizer *preferred* a layout
it never visited. A search failure, not a weighting one.

`calculateOptimalLayoutJoint` ran its two stages **once each**: every chain
order at the starting rotations, then every rotation at the winning order. That
walks a single path through (order × rotation) space, so the answer is only as
good as the first stage's guess, and the better layout needed a different order
*and* a different rotation. Alternating the stages until neither improves —
ordinary coordinate descent — recovers it exactly:

```
J$ Home drawn cable   45.05in   pre-P1.5, scored on a fiction
                      62.60in   honest scoring, single-pass search
                      45.05in   honest scoring, alternating search
                      score 135.08, and 45.08 scored vs 45.05 drawn
```

**Lesson worth keeping: a cost-function change can expose a SEARCH defect, and
the two are easy to confuse.** Both wrong hypotheses were plausible, and both
would have meant tuning a global constant to compensate for a local bug. What
settled it was scoring the old layout with the new function — a five-minute
experiment that should have come first.

### A crash nobody was looking for

Writing a fixture for P5 turned up `enumerateChainOrders` building **every**
permutation of a swappable group before the cap discarded them. One group of 12
pedals is 12! = 479,001,600 arrays generated to keep 48:

```
 6 pedals        720 perms     31ms
 8 pedals     40,320 perms     63ms
10 pedals  3,628,800 perms   1895ms
12 pedals       479m perms   heap exhausted, worker dead
```

Pre-existing, not a regression from the alternating search — forcing
`MAX_PASSES` back to 1 dies at exactly the same point. And in a Web Worker that
crash is not catchable: no reply, nothing `run-optimize` can rescue, and an
Optimize button that spins forever — the same visible symptom as the
route-cables landmine, by an unrelated route. 12 pedals now optimizes in 48ms.

### P3 was built at half scope, on purpose

Perimeter cables are dashed; the tooltip is not built. It needs pointer events
on a stroke that sits under draggable pedals, and **no board produces a drawn
perimeter route** — across every config-matrix fixture the tally is
`lane-router 68, l-horizontal 3, channel 3`, and neither saved configuration
produces one. With no subject to test against and no jsdom in the project,
shipping an untestable interaction change to annotate an invisible cable was
the wrong trade. Reasoning recorded at the call site.

### Still open

- **Group 3** — 13 jack layouts, 2 image gaps. Research, not code. Unblocked.
- **Group 4** — power supply. Gated on deciding the app should plan wiring
  rather than report demand.
- **The branch** — 15 commits on `routing/one-router`, unmerged.
