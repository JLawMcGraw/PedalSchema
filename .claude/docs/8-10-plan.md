# Fixing what 8/10 left open

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to work
> through this task-by-task.

**Goal:** close the loose ends from the chain-order and jack-selection fixes -
one unverified data claim that ships today, the guards that would have caught
both bugs, and the duplicated policy the second one hid behind.

**Architecture:** no new subsystems. Three of the six tasks delete an
assumption and replace it with either data or a gate; one consolidates two
copies of a decision into the one that is already tested.

**Tech stack:** Next.js 16 / React, Zustand, Supabase (PostgREST), vitest,
Playwright for the browser gates.

Successor to `8-8-remaining.md`. Same convention: **ordered by what it costs to
be wrong, every claim tied to a measurement taken while writing this file.**

Baseline, measured now:

```
vitest              340 pass, 1 skipped      tsc clean, eslint src 0 errors
config-matrix       66/66 by trial ID        saved-board fp reproducible
browser gates       10 of 11 pass            verify-jack-render FAILS (exit 1)
jack duplicates     39 groups, 39 resolved   0 unmatched by a label rule
saved boards        J$ Home 9 / test 22      both fixed points of load, 0 red
```

---

## The shape of what is left

Two bugs were fixed on 8/10 and they were **the same bug twice**: an array
arriving from a PostgREST embed with no `ORDER BY`, consumed by something that
took the first element. Once by a non-total comparator (`applyDefaultOrdering`),
once by a bare `.find()` (`findJack`).

Everything in T1-T4 exists because of that pattern. T1 is the one claim from
the fix that was asserted rather than checked. T2 and T3 are the guards that
would have caught either bug on the day it was written. T4 is the second copy
of the jack decision, which the first fix did not reach.

---

## T1 - The LEFT convention is asserted, not verified. It ships today.

**Cost of being wrong:** three pedals draw their cables into the wrong physical
jack, on both saved boards, and nothing reports it. This is the weakest claim
shipped on 8/10.

`monoAffinity` in `src/lib/engine/cables/endpoints.ts` scores `LEFT` above
`RIGHT` on the convention that the left jack of a stereo pair is the mono one.
Seven of the twelve label patterns say `MONO` outright and need no convention.
This one does not. Measured, the pedals riding on it:

```
BigSky     input   [RIGHT IN]@68   [LEFT IN]@80        on `test`
BigSky     output  [LEFT OUT]@8    [RIGHT OUT]@20      on `test`
Timeline   input   [RIGHT IN]@68   [LEFT IN]@80        on `test`
Timeline   output  [LEFT OUT]@8    [RIGHT OUT]@20      on `test`
Flint      output  [LEFT OUT]@10   [RIGHT OUT]@24      on J$ Home
```

**All three are Strymon**, and strymon.net is a source this project has already
used successfully - it is where the 8/8 dimension correction came from. So this
is one page-read, not research.

**The fix is to delete the convention, not to confirm it.** If the enclosure
says `L/MONO`, then the LABEL should say so, and `monoAffinity` can go back to
matching only `MONO`. Data carrying the fact beats code carrying a guess - the
same reasoning migration `20260801000004` applied to invented jack rows.

**Step 1.** Read the Timeline, BigSky and Flint pages/manuals on strymon.net.
Record, for each, what is silkscreened beside each output and input barrel.

**Step 2.** If the enclosure marks a mono jack, correct the three pedals' jack
labels to match, with provenance, using the existing contract columns:

```sql
-- one UPDATE per jack row; jacks_source_url / jacks_verified_at live on pedals
UPDATE pedal_jacks SET label = 'LEFT OUT (MONO)' WHERE id = '<row id>';
```

Write it as a script under `.claude/scripts/`, in the style of
`scraper/import-pedals.js`: check `error`, not just `data` - the tri-state trap
this project has now hit twice.

**Step 3.** Once the labels carry `MONO`, narrow `monoAffinity`: delete the
`LEFT` clause and its `RIGHT` penalty, keeping `GUITAR`/`BASS` and the bare
`OUTPUT`/`INPUT` rules.

**Step 4.** Re-run the catalogue check from T2 (build it first if T2 is not
done): expect `39 groups, 39 resolved, 0 unmatched` still.

**Step 5.** Fingerprint. If the labels confirm LEFT, expect **byte-identical**;
if they contradict it, expect `test` and J$ Home to both move, and that
movement is the bug being fixed.

```bash
node .claude/scripts/dump-configs-offline.js /tmp/c.json
PEDAL_CONFIG_DUMP=/tmp/c.json PEDAL_FINGERPRINT_OUT=/tmp/fp.txt \
  npx vitest run saved-board-fingerprint
```

**Step 6.** Commit, stating in the message which way the evidence went.

**If strymon.net does not say:** stop and record that, do not fall back to the
convention silently. An unattributable claim written as fact is the mistake
`20260801000004` had to undo. Leave the `LEFT` clause with a comment naming it
as unverified and the pedals it affects.

---

## T2 - Nothing keeps jack resolution correct as the catalogue grows

**Cost of being wrong:** silent. A new pedal with two same-type jacks and an
unrecognised label falls to the position fallback, which is **provably wrong**
for DD-7-shaped data (`[OUTPUT B]@22` before `[OUTPUT A (MONO)]@38`). Nobody
finds out.

`monoAffinity` matches free text, and `/pedals/new` lets a user type any label.
I verified 39 of 39 groups resolve correctly **once, by hand**, and left no
guard. The project already has the right pattern for this - `verify-pedal-jacks.js`
reports contract violations against the live catalogue.

**Files:**
- Create: `.claude/scripts/verify-jack-resolution.js`

**Step 1.** Write the script. It reads every pedal with its jacks from the
database, finds each group of two-or-more jacks sharing a `jack_type`, and
asserts a label rule fired - not merely that a jack was returned:

```js
// The failure this catches is NOT "no jack" - findJack always returns one.
// It is "no RULE matched, so position broke the tie", which the DD-7 proves
// is the wrong answer whenever the mono jack is not the lower one.
const unmatched = groups.filter((g) => monoAffinity(g.chosen.label) === 0);
```

Import the real scoring rather than restating it, so the gate cannot drift from
the router - the same reason `explain.ts` is shared by the renderer and the
legend. `endpoints.ts` is TypeScript and these scripts are plain node, so
either export `monoAffinity` and run the check inside a vitest file, or have
the script shell out. **Prefer the vitest file** - this project has no TS runner
other than vitest, which `saved-board-fingerprint.test.ts` documents.

Revised files:
- Create: `src/lib/engine/cables/__tests__/jack-resolution-catalogue.test.ts`,
  skipped without `PEDAL_ALL_PEDALS`, in the style of the fingerprint test
- Modify: `src/lib/engine/cables/endpoints.ts` - export `monoAffinity`
- Create: `.claude/scripts/dump-pedals-offline.js` - writes the catalogue JSON

**Step 2.** Run it against the live catalogue. Expected, measured today:

```
duplicate groups: 39   resolved by a label rule: 39   unmatched: 0
```

**Step 3.** Prove the gate can FAIL - the lesson from `knockout-regression.js`,
which was first run against the OLD algorithm to show it reproduced the
baseline. Add a pedal with two same-type jacks labelled `FOO`/`BAR` to the
fixture and confirm the check reports 1 unmatched. Without this, "0 unmatched"
is indistinguishable from a check that does nothing.

**Step 4.** Commit.

---

## T3 - There is no load -> save -> load test, and that is what broke

**Cost of being wrong:** the chain-order bug was exactly a round-trip bug. It
survived because every gate either replayed the database directly (the offline
fingerprint) or drove the UI without reloading. One invariant would have caught
it the day it was written.

Measured: no test in `src/**` matches round-trip / save-then-reload.
`verify-save-reorder.js` (109 lines) covers the DEFERRABLE constraint on the
save path, and `verify-loop-persist.js` covers one flag - neither asserts that
what comes back equals what went in.

**Files:**
- Create: `.claude/scripts/verify-round-trip.js`

**Step 1.** Write the gate. For every saved configuration: read the stored rows
straight from the database, load the editor, and assert the derived state is a
**fixed point** - no drift, and nothing dirty:

```js
// The three things that were false on 2026-08-10 and nobody noticed:
check(snap.isDirty === false,                 'clean on load');
check(drift.length === 0,                     'every chainPosition matches the row it came from');
check(deepEqual(cablesBefore, cablesAfter),   'a save with no edits changes no geometry');
```

**Step 2.** Run it. Expected, measured today:

```
J$ Home   9 pedals, 11 cables   isDirty=false  drift 0/9
test     22 pedals, 25 cables   isDirty=false  drift 0/22
```

**Step 3.** Prove it can fail - revert `applyDefaultOrdering` to
`return orderA - orderB;` in a scratch stash, run the gate, and confirm it
reports drift on `test`. Restore. **Do not skip this**: a round-trip gate that
passes on a healthy database is exactly the gate that passed all last week.

**Step 4.** Include the third check deliberately: press Save with no edits, and
assert the geometry is unchanged afterwards. That is the half of the round trip
`verify-save-reorder.js` does not cover, and it is where a write-side ordering
bug would live.

**Step 5.** Commit.

---

## T4 - The jack decision exists twice; the fix reached one copy

**Cost of being wrong:** latent today, measured. `src/lib/engine/layout/index.ts:192`
does its own lookup:

```ts
const jack = pedal.jacks!.find((j) => j.jackType === jackType);
```

`sameSideJackPad` reads only `.side`, and **all 39 duplicate groups have both
jacks on the same side** (measured: 39 same, 0 straddling), so it currently
gets the same answer `findJack` would. It is not wrong today.

It is worth fixing anyway because it is the **two-policies** smell this project
has been bitten by repeatedly - the facing-jack shortcut carries a comment
about it, and the perimeter rung "selected against one path and returned
another" for the same reason. The layout engine deciding which jack a pedal
uses, separately from the router that draws it, is how the optimizer comes to
score geometry it does not draw. P1.5 existed to end that.

**Files:**
- Modify: `src/lib/engine/layout/index.ts:187-196`
- Modify: `src/lib/engine/layout/index.ts:13` (import)

**Step 1.** Write a failing test asserting the layout agrees with the router on
a pedal whose duplicate jacks are on DIFFERENT sides - the case the catalogue
does not currently contain, which is precisely why it is unguarded:

```ts
// Create: src/lib/engine/layout/__tests__/jack-policy-parity.test.ts
it('uses the same jack the router does, even across sides', () => {
  const pedal = makePedalWithJacks([
    { jackType: 'output', side: 'left',  positionPercent: 20, label: 'OUTPUT B' },
    { jackType: 'output', side: 'bottom', positionPercent: 40, label: 'OUTPUT A (MONO)' },
  ]);
  expect(effectiveSideUsedByLayout(pedal)).toBe(findJack(pedal, 'output').side);
});
```

**Step 2.** Run it. Expected: FAIL - the layout takes `left`, `findJack` takes
`bottom`.

**Step 3.** Replace the local `.find()` with `findJack(pedal, jackType)` and
import it from `../cables/endpoints`.

**Step 4.** Run the test. Expected: PASS.

**Step 5.** Fingerprint. Expected **byte-identical**, because no catalogue
pedal straddles sides. If it moves, the measurement above was wrong and that is
worth more than the refactor - stop and find out why.

**Step 6.** Sweep the rest of the class while it is fresh. 28 `.find()` calls
in `src/lib`/`src/store`/`src/app` touch jack/rail/output/pedal/cable/supply
arrays. Two can match more than one row; the other is
`derived.ts:282`, a debug-only hook (`__pedalSchemaSetSupply`) and not a
product path. Confirm that count still holds and record it in the commit, so
the next person does not redo the sweep.

**Step 7.** Commit.

---

## T5 - A broken gate is a gate that stops catching things

**Cost of being wrong:** low and bounded - it fails loudly (exit 1). But it has
been failing, and nobody noticed, which is the actual problem.

`verify-jack-render.js` throws `Conspiracy Theory not found in store after
adding`. Measured: the pedal EXISTS in the catalogue (67 pedals, one match), so
the data is fine and the script's UI flow is stale. It arms the add by
`page.click('button:has-text("Conspiracy Theory")')` after filling the search
box, then clicks the canvas to place.

**Files:**
- Modify: `.claude/scripts/verify-jack-render.js:32-38`

**Step 1.** Run it headed to see which step fails:
`HEADLESS=false node .claude/scripts/verify-jack-render.js` - or add a
screenshot before the store read.

**Step 2.** Fix the selector or the two-step arm/place flow to match the
current `pedal-library-panel.tsx`.

**Step 3.** Run it. Expected: `ALL CHECKS PASSED`, exit 0.

**Step 4.** While here, add a one-line runner so the suite is runnable at all -
its absence is why this went unnoticed:

```bash
# Create: .claude/scripts/verify-all.sh - read-only gates only.
# Deliberately EXCLUDES optimize-and-save.js, which writes a layout.
```

**Step 5.** Commit.

---

## T6 - The legend below `lg` was reasoned about, not rendered

**Cost of being wrong:** cosmetic, on mobile only.

The mobile FABs sit at `bottom-4` in a sibling stacking context; the legend
lifts to `bottom-14` below `lg` to clear them. That was derived from reading
the CSS and never rendered - `verify-cable-legend.js` runs at 1600x1100, which
is above the breakpoint.

**Files:**
- Modify: `.claude/scripts/verify-cable-legend.js`

**Step 1.** Add a second pass at a phone viewport (`390x844`), asserting the
legend's bounding box does not intersect either FAB's:

```js
const overlap = (a, b) => !(a.x + a.width < b.x || b.x + b.width < a.x ||
                            a.y + a.height < b.y || b.y + b.height < a.y);
check(!overlap(legendBox, fabBox), 'legend clears the mobile action buttons');
```

Geometry, not a screenshot - the same reason the rest of that gate compares
strokes rather than pixels. Though do take one screenshot as evidence: the
19rem-block defect got through the DOM check and was caught by eye.

**Step 2.** Run. Fix the offset if it overlaps.

**Step 3.** Commit.

---

## Decisions for the owner, not tasks

These need a person, and guessing at them is how the width veto survived.

- **`GUITAR IN` over `BASS IN` is hard-coded** in `monoAffinity`, affecting the
  AW-3 and BF-3. That is a product decision - "this is a guitar app" - written
  into the router. If bass rigs ever matter it belongs on the configuration,
  not in a constant.
- **Boards saved during the chain-order window carry the scramble as data.**
  Both current boards are clean (verified: 0 drift, fixed points), so this is
  moot at n=2. It stops being moot the moment anyone else has a board, because
  the tie-break now faithfully preserves a "saved order" that may be an
  artifact, and nothing can tell the two apart afterwards. Decide the policy
  before there are users, not after.
- **`Drawn through EQ-200, GE-7, GEB-7`** names the cable's own destination.
  Accurate - it clips that pedal's body on a middle segment - but it may read
  as a bug. Trivial to filter the endpoints out; unclear that it should be.

---

## Deliberately not in this plan

- **Partial-span horizontal corridors.** The measured remedy for 8 of 25 cables
  having no corridor to attach to, and the only sizeable engineering item left.
  Kept out because its payoff is TIDINESS, not length: A\* already returns a
  shortest axis-aligned clear path, so the +74.4in of detour on `test` is not
  recoverable. See the 2026-08-10 entry in `sessions.md`. Worth doing when
  crossings or loom quality become the complaint - not before.
- **Widening `OBSTACLE_MARGIN` or `PERIMETER_OFFSET`.** Recorded going wrong
  twice.
- **Re-Optimizing `test`.** ~1.3 from its own optimum; Optimize overwrites a
  hand-arranged board, so it is the owner's click.
- **Photos for Big Muff Pi and Small Clone, and the four jack layouts.**
  Unchanged, still blocked on a person.

---

## Suggested order

1. **T1** - the only item that is wrong on screen today, and it is one page-read.
2. **T3** - the guard with the widest reach; build it before touching more data.
3. **T2** - keeps T1's answer true as the catalogue grows.
4. **T4** - consolidation, fingerprint-neutral, cheap while the context is warm.
5. **T5**, **T6** - housekeeping, any time.

T1 and T2 are one piece of work. T3 stands alone and is the one to do if only
one gets done.

## What this plan assumes

Still two saved boards, both the owner's. Every "measured on the saved boards"
number here - including T1's blast radius and T4's byte-identical prediction -
is n=2. `config-matrix` is the only thing that speaks generally, and it has no
fixture with duplicate jacks on different sides, which is why T4 builds one.
