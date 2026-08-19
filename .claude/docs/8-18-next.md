# What is left after R2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Read `.claude/CLAUDE.md` first — the verification protocol in it
> governs every task here, and "no errors thrown" is not evidence.

**Goal:** Close the four items remaining after R2 (`45afa18`), in the order that
costs least to be wrong about, without loosening anything that currently holds.

**Architecture:** Three of the four are audits or measurements, not features. Only
Task 3 changes engine behaviour, and it is the one this plan recommends AGAINST
doing. Every task ends in one of three states: a measured "nothing to do", a
measured fix with a before/after diff, or a question that only the owner can
answer. None of them ends in a judgement call made without numbers.

**Tech stack:** Next.js 16 / React 19 / TypeScript, Zustand store, Vitest (the
only TS runner in `node_modules/.bin` — there is no `tsx`, `ts-node` or
`vite-node`), Playwright for app-level gates, Supabase for the real boards.

---

## STATUS — executed 2026-08-18

| Task | Outcome |
|---|---|
| 1. Re-derive BigSky | **CLOSED at gate (a)** — physical, no code. `5892ed4`. Conclusion survived; every number behind it did not, and the operative cause turned out to be the STANDOFF, not lane capacity. |
| 2. Comment sweep | **DONE**, and the plan's "low yield" estimate was wrong. `fit-explanation` asserted `corridorInches >= 0`, which nothing can fail. `7f893b3`, `0d7bf47`. Follow-on: the dead lenient tier removed in `217e8f7`. |
| 3. R3 / the 1.23x | **DECIDED AGAINST** by the owner. Moved to the "deliberately NOT doing" list in `roadmap-next.md`. Do not execute the steps below without a fresh decision. |
| 4. Owner decisions | Resolved. The red cables closed as physical (Task 1). "Decide what `test` should be" was **not a decision** — the modulation switch is a control the owner flips by preference, and had been carried as an open task for three sessions. |

**Kept rather than deleted** because the standing rules, the verification
ladder and the two harness traps below are what the next session needs, and
Task 3 is the record of a decision rather than a queue item.

---

## Standing rules for every task

**These are not optional and they are why the engine is in the state it is.**

1. **Measure before you touch anything.** Take the baseline first. Every claim in
   this repo's history that turned out to be wrong was written without one.
2. **A plan is not evidence.** This file included. Check each claim below against
   the code before acting on it — three of the last roadmap's items were already
   done when they were written up as open.
3. **Never loosen a clearance to make a failure go away.** `clearance-contract.test.ts`
   exists so the next loosening is deliberate, with the arithmetic redone.
4. **Never score with a different router than the one that draws.** That is the
   P1.5 defect; `router-parity.test.ts` gates it.
5. **A budget or allowance entry is a defect that has not been read closely
   enough.** Both tables are empty. Adding an entry needs the measurement beside it.

### The verification ladder (run in this order)

```bash
# 1. Unit + integration. Baseline is 388 passed / 4 skipped.
npm test

# 2. Typecheck and build (build also proves the worker bundle is sane)
npx tsc --noEmit && npm run build

# 3. The real boards, offline. Requires .env.local.
SP="$TMPDIR/pedalschema"; mkdir -p "$SP"
node .claude/scripts/dump-configs-offline.js "$SP/configs.json"
PEDAL_CONFIG_DUMP="$SP/configs.json" PEDAL_FINGERPRINT_OUT="$SP/fp-after.txt" \
  npx vitest run saved-board-fingerprint

# 4. The real boards, in a browser. Requires dev server on :3000.
node .claude/scripts/verify-optimize.js
```

### Before/after diffing a behaviour-neutral change

`git stash` the source file only — never the tests — so both runs use the same
assertions:

```bash
PEDAL_CONFIG_DUMP="$SP/configs.json" PEDAL_FINGERPRINT_OUT="$SP/fp-after.txt" \
  npx vitest run saved-board-fingerprint
git stash push -m baseline -- src/lib/engine/<file>.ts
PEDAL_CONFIG_DUMP="$SP/configs.json" PEDAL_FINGERPRINT_OUT="$SP/fp-before.txt" \
  npx vitest run saved-board-fingerprint
git stash pop
diff "$SP/fp-before.txt" "$SP/fp-after.txt" && echo "IDENTICAL"
```

### Two traps that cost time this session

- **Vitest swallows `console.log` here.** A diagnostic that logs will appear to
  run and print nothing. Collect output into an array and `writeFileSync` it.
- **Vitest's default test timeout is 5s.** A full-pipeline replay of the
  22-pedal board takes ~8s and reports as a FAILED test while still producing
  correct output. Pass `{ timeout: 60000 }` as the second argument to `it`.

---

## Task 1 — Re-derive the BigSky diagnosis

**Do this first. It is the only item where the answer is genuinely unknown, and
it is currently load-bearing: it is the stated reason not to write any code.**

**This task is a MEASUREMENT PROTOCOL, not a TDD cycle.** There is deliberately
no failing test written up front, because we do not yet know whether there is a
defect. Writing speculative test steps here would be inventing the conclusion.
The decision gate at Step 5 says what to do with each possible outcome.

### Background, and why the recorded answer is suspect

`sessions.md` concludes the two red cables on `test` are physical, not a routing
failure, on this arithmetic:

```
row 1 bottom          203.2
BigSky top            218.0
raw corridor           14.8px
usable after margins    2.8px
LANE_SPACING           12px      -> seats exactly ONE run
three rows take 203 + 204 + 204 = 611px of a 640px board
```

Two things no longer match the board:

- It was measured with `use_4_cable_method = true`. The database now reads
  **false** (checked 2026-08-18: `updated_at 2026-08-18T19:55Z`).
- It assumes **three** rows. A replay on the current rows puts pedals at **four**
  distinct y positions (0, 5.45, 8.44, 10.9).

So the conclusion may well still hold — but it is currently inherited, not
verified, and it is guarding a constant this project has already been burned by
twice.

**Files:**
- Read: `.claude/docs/sessions.md` (the "Why four cables are red" and "The last
  two red cables" sections)
- Read: `src/lib/engine/geometry/index.ts` — BOTH `OBSTACLE_MARGIN` (currently 6,
  dropped from 8 on 2026-08-18) and `LANE_SPACING` live there, not in `lanes/`
- Create (temporary, delete before commit): `src/lib/engine/__tests__/tmp-bigsky.test.ts`

**Step 1: Dump the current board**

```bash
SP="$TMPDIR/pedalschema"; mkdir -p "$SP"
node .claude/scripts/dump-configs-offline.js "$SP/configs.json"
```

Expected: three configurations listed, including `test: 22 pedals on Classic Pro (32x16)`.

**Step 2: Write a diagnostic that prints the corridor arithmetic**

Model it on the R2 diagnostic. It must replay the FULL pipeline
(`signalChainEngine.calculate` → `calculateOptimalLayoutJoint` → `deriveBoardState`)
exactly as `saved-board-fingerprint.test.ts` does — not a reimplementation — and
report, for the `test` config as stored:

- every pedal's box in px (`x*40`, `y*40`, `w*40`, `d*40`), sorted by y then x
- the distinct row bands and the raw gap between each adjacent pair
- for each gap: `usable = gap - 2 * OBSTACLE_MARGIN`, and `floor(usable / LANE_SPACING) + 1` runs it seats
- for each INVALID cable: its endpoints, which jack (side + percent), its
  `laneOutcome`, and which corridor it needed
- how many cables already occupy that corridor

Remember the two traps: write output to a file, and set `{ timeout: 60000 }`.

**Step 3: Run it and read the numbers**

```bash
PEDAL_CONFIG_DUMP="$SP/configs.json" npx vitest run src/lib/engine/__tests__/tmp-bigsky.test.ts
```

**Step 4: Construct the ASCII diagram**

Per `CLAUDE.md`, spatial claims are proved by extracted coordinates and a diagram
built FROM them — not by looking at a screenshot. Draw the rows, the corridor in
question, its usable band, and the runs competing for it.

**Step 5: DECISION GATE — pick exactly one**

- **(a) The board really is full.** The corridor seats fewer runs than need it,
  and no placement change helps because the rows already consume the depth.
  → Write the re-derived arithmetic into `sessions.md`, replacing the stale
  figures. Mark the task list item verified with today's date. **Write no code.**
  Delete the diagnostic. Commit as `docs:`.

- **(b) The corridor has room and the router is not using it.** → This is a
  routing defect. STOP and switch to @superpowers:systematic-debugging. Do not
  fix it from inside this task; the four phases exist because this is exactly
  where guessing starts.

- **(c) A placement change would fix it.** → Do NOT implement it here. Record
  the finding and the measurement, and raise it with the owner: it will move
  pedals on a real saved board, which is their call.

**Step 6: Whatever the outcome, clean up**

```bash
rm -f src/lib/engine/__tests__/tmp-bigsky.test.ts
npm test           # must be 388 passed / 4 skipped
git status --short # must be clean apart from intended edits
```

**Forbidden in this task:** changing `OBSTACLE_MARGIN`, `LANE_SPACING`, `ROW_GAP`
or `COLLISION_SPACING`. If the arithmetic says a constant is wrong, that is a
finding to report, not a change to make — see standing rule 3.

---

## Task 2 — Sweep the test suite's comments against the code

**Expected yield: LOW. Do this only if Task 1 closes quickly.**

The one instance found on 2026-08-18 (`d6ac166`) was real: `lane-router.test.ts`
carried a 55-line docblock describing per-case allowances that no longer existed
and a guard described as "built and reverted" that had in fact landed, while the
lookup underneath silently allowed one extra crossing on every case. But a scan
for the same shape across the suite found no second instance — the other `?? N`
hits are fixture builders, not assertion slack. So this is tidying with a small
chance of a real find, not an audit with a known target.

**Files:** all 40 of `src/**/*.test.ts`. Known-stale references to start from:

```bash
grep -rnE "roadmap|Phase [0-9]|P[0-9]\.5|will be|once we|TODO" src --include="*.test.ts"
```

`optimize-e2e.test.ts:411` ("roadmap phase 5"), `rotation-search.test.ts:2`
("roadmap Phase 4"), `config-matrix.test.ts:19,139` ("Phase 2 of the roadmap")
and `lane-router.test.ts:2` ("roadmap Phase 3") all cite a numbering scheme
`roadmap-next.md` no longer uses.

**Step 1: For each file, read the docblock and the assertions together**

The question is not "is the prose old" but **"does the assertion still do what
the prose says it does"**. Only the second kind is worth changing.

**Step 2: For any mismatch, prove which side is wrong before editing**

If the comment claims a property is enforced, test that it actually is — tighten
the assertion and run it. If it passes, the comment was right and the assertion
was slack (that is what happened in `d6ac166`). If it fails, the comment was
aspirational and must be rewritten to the truth, with the measurement.

**Step 3: Commit per file, not in a batch**

A comment-only change and an assertion-strengthening change must not share a
commit — one is documentation, the other is a behaviour gate.

**Step 4: Verify**

```bash
npm test   # 388 passed, or MORE if an assertion was strengthened
```

**Guardrail:** do not delete test files. The suite was audited on 2026-08-18: no
`.skip`, no `.todo`, no references to removed code, no redundant coverage. The
two skipped FILES are `skipIf(!DUMP)` opt-in harnesses
(`saved-board-fingerprint`, `jack-resolution-catalogue`) and both are load-bearing.

---

## Task 3 — R3: the optimizer's 1.23x  (DECIDED AGAINST 2026-08-18)

**The owner decided against this on 2026-08-18. It now lives in the
"deliberately NOT doing" list in `roadmap-next.md`. What follows is kept as the
write-up of HOW it would be done if that decision is ever revisited — it is not
a pending task, and it should not be picked up as one.**

Measured through the worker in a real browser on 2026-08-18: Optimize settles in
**1923ms** on the 22-pedal board and **116ms** on the 9-pedal one, both reporting
"already optimal". That is not slow. The 1.23x buys a property that was expensive
to earn and is currently enforced rather than tolerated — `LANE_CROSSING_ALLOWANCE`
is an empty table with a zero default because of it.

If the owner does want it:

**Files:**
- Modify: `src/lib/engine/cables/route-cables.ts` — the never-worse guard is inside
  `routeCablePaths` (declared line 316), NOT `routeAllCables` (line 436)
- Test: `src/lib/engine/__tests__/lane-router.test.ts`, `src/lib/engine/__tests__/router-parity.test.ts`

**The approach, and the only safe one:** the second routing pass only matters
where the two routers disagree. `laneOutcome` already records which cables the
corridor served, so the cascade pass can be skipped when every cable was
`lane-routed` or `shortcut` and nothing was `evicted`/`unattached-*`.

**Step 1: Write the failing performance test**

Assert the guard is skipped on a board where the corridor served every cable —
by counting `routeOnce` invocations, not by timing. A timing assertion is a
flaky test; see @superpowers:condition-based-waiting.

**Step 2: Run it, watch it fail**

**Step 3: Implement the skip**

**Step 4: Prove the property still holds**

```bash
npx vitest run src/lib/engine/__tests__/lane-router.test.ts   # 9 passed, allowance still 0
npx vitest run src/lib/engine/__tests__/router-parity.test.ts
npm test
```

**Step 5: Prove it on the real boards, both ways**

Fingerprint diff must be EMPTY, then `node .claude/scripts/verify-optimize.js`
must still report "already optimal" on both boards.

**Step 6: Report the measured speedup**

If it is not a large multiple, revert. The current cost is 1.9s on the largest
real board; a change that trades a correctness guarantee for 200ms is a bad trade.

**Forbidden:** scoring with a different router than the one that draws (P1.5),
and reintroducing a non-zero allowance to make a case pass.

---

## Task 4 — The two owner decisions (BLOCKED — needs the owner)

Not work. Listed so they are not mistaken for work, and so the next session does
not re-measure them.

**4a. What should `test` be stored as?** Measured 2026-08-18 on the current rows:

```
                  length      crossings   score      invalid cables
DIRTY (stored)    147.54in    8           480.74     Timeline -> BigSky   [evicted]
                                                     BigSky -> amp_return [evicted]
CLEAN             131.22in    12          496.42     DM-2W -> Timeline    [unattached-from]
                                                     BigSky -> amp_return [evicted]
```

Clean is shorter and scores WORSE. Dirty is stored and is what the cost model
prefers. This is a wiring preference; the engine has no opinion worth overriding.

**4b. The red cables.** INDEPENDENT of 4a — both settings leave exactly two, and
`BigSky -> amp_return` is red under both, with rows at the same four y positions
either way. Task 1 re-derives whether anything can be done about it.

---

## Suggested order

1. **Task 1** — unknown answer, load-bearing, cheap to measure.
2. **Task 4** — surface the numbers to the owner; they may moot Task 1(c).
3. **Task 2** — only if there is time; low yield.
4. **Task 3** — only on the owner's instruction.

Stopping after Task 1 is a legitimate outcome. The tree is clean, the suite is
388 green with zero budgets and zero allowances, and both real boards are
verified unchanged in a live browser.
