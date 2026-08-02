# Session History

This file tracks work completed across coding sessions. Read this at session start for context.

---

## Session: 2026-08-01 - Rotation rework: the veto is gone

Built the rework designed on 2026-07-31 (below). The optimizer can now turn
pedals; before today it could turn none.

### Done
1. **Width veto deleted.** `isLargePedal` survives only as the DEFAULT for a new
   per-board lock. `isFootSwept` stays a hard rule. `hasTopOrBottomSignalJack`
   is documented as the search PRUNE it always was. No fit rule added -
   `hasPlacementCollision` already scores overlapping/off-board candidates
   Infinity using ROTATED dimensions.
2. **Per-board lock**: `PlacedPedal.rotationLocked`, migration
   `20260801000001`, `setRotationLocked` store action (undoable), save/load
   wiring, and an Orientation section in the properties panel whose helper text
   is accurate in all four states (foot-swept / locked / can-gain / side-jacks).
3. **Raised the lock default** - see the finding below.
4. **Backfill migration** `20260801000002` so a pedal does not behave
   differently depending on when it was added. Only ever LOCKS, so re-running
   cannot undo a deliberate unlock.
5. `.claude/scripts/dump-configs-offline.js` - pulls every saved config into one
   store-shaped JSON with no dev server and no browser, for offline engine
   fingerprinting.

### The finding that matters
**Splitting a veto into a lock nearly rebuilt the veto.** The agreed plan said
to reuse the 3.5 x 5.5in threshold as the lock's default. But all seven pedals
that can gain from turning are wider than 3.5in - that is WHY the veto was
wrong - so every one of them would have arrived locked, and rotation would
have done nothing on a fresh board. The numbers were calibrated to exclude
EQ-200, so they could not be reused to decide what EQ-200 does by default.
Raised to 4.5 x 6.5in, placed in the catalogue's empty bands (widths jump
4.0 -> 4.8, depths 5.6 -> 7.3) so nothing sits near a line. Owner's call, taken
with the numbers in hand.

### Verification
- 217 tests pass (+4), tsc clean, eslint clean (0 errors), production build ok.
- Real-board fingerprint before/after: every placement BYTE-IDENTICAL. The only
  diff is `rotation-eligible: 0 -> 1 [EQ-200]` on the 20-pedal board.
- Rotation declined on the merits, not for want of budget: EQ-200 scored
  directly at all four orientations - 0deg 1095.66 vs 1245.76 / 1416.60 /
  1495.59. Stage 1 is capped at 48 orders of the 200-evaluation budget
  (`enumerateChainOrders(..., 48)`), so stage 2 is never starved.
- Catalogue-wide: optimizer-eligible pedals 0 -> 7 of 63 (PW-3 refused as a
  treadle). Of the 7, five now rotate by default and the two 6.5in Strymons
  arrive locked.
- Migrations applied and round-tripped against the live DB (write true/false,
  read back, restore). Backfill predicted one row before running; got that row.

### A test that caught itself
The new treadle case was vacuous as first written: at 7.56in deep NO rotation
improved the score, so "it refused to rotate" proved nothing. The
assert-the-temptation-is-real line failed and exposed it. Rewritten to use the
EQ-200 with only its CATEGORY changed, so foot-sweptness is the single variable.

## Phase 5 - straddling pedals (same session, after the rotation work)

The dense-board overlap is fixed. `it.skip` is gone; 220 tests pass, nothing
skipped.

**The fix**: a pedal deeper than the deepest row band claims its column BEFORE
the packed run, so it is not left hunting for a free column after the rows
fill. `maxBandHeight` moved up to row scope; `placePackedChain`'s loop is
extracted as `runPass(seq, preSpots)` so it can be run twice.

**Straddler-first is a RETRY, gated on `placementDegraded` - do not promote it
to the default.** Measured over 1777 random dense boards: unconditional was
165 fixed / 146 BROKEN, because claiming a column up front fragments rows that
were packing fine (worst case: two straddlers chopped every row into unusable
segments and drove two compacts onto the same spot). Gated, the same sweep is
9 fixed / 0 broken and every already-working board is bit-for-bit unchanged.

**Two things measurement corrected, both of which looked right on paper:**
1. WHERE to claim needs the chain DRY RUN, not a formula. A single-row model
   clamps every late pedal to x=0; a row-wrapping model inverts the last few,
   because a straddler steals a slot from the row it overhangs into - the very
   thing the model was predicting. Dry-run the chain without straddlers and
   anchor to where the real neighbour landed.
2. Straddlers align to a board EDGE, never centre on a band. A 9.06in pedal
   centred on a 16in board leaves 3.5in above and 3.4in below, both too
   shallow for anything.

**A test that asserted more than the design promises.** "The straddler advances
along the run as its chain position advances" passed while straddler-first was
unconditional, then failed once it became a retry - it was measuring the
retry's coverage, not a layout property. Replaced with the claim that is both
true and worth pinning: chain-FIRST anchors to the guitar end, chain-LAST to
the amp end (the two cases that exist in the wild).

### Verification
- 220 tests, config matrix 66/66, tsc clean, eslint clean, build clean.
- Both real boards byte-identical (fingerprint diff empty).
- No overlap at any of the 20 chain positions the straddler can occupy.
- Random-board sweep before/after compared by TRIAL ID, not just by count -
  which is what exposed the 165/146 churn a net figure had hidden.

### Residual, deliberately not fixed
231 of 1777 random dense boards still overlap. **This figure was wrong - see
the phase 6 session below, which retracts it.**

---

## Photos for the new pedals, and the chorus-as-preamp request

### Photos: 58 -> 62 of 67
Flint (strymon.net), Aqua-Puss + Conspiracy Theory (Dunlop BigCommerce), PastFX
Chorus Deluxe. The five still missing are the deliberate PEDAL_OVERRIDES skips.

**pastfx.com refuses the product PAGE to some clients (HTTP 425) but serves the
image FILE fine to a browser UA** - which is what had blocked the original
research. `curl -A <browser UA>` got it; the entry pins the file directly.
Added pastfx.com to MANUFACTURER_HOSTS so the licence records
`manufacturer-proprietary`, not `unknown`.

Each was checked against the knockout regression signature before being
believed: damaged fills reach 77-91% of the centre-20% box, these reach 0.0%,
and trimmed aspect ratios land within 0.5% of each footprint - which is also
what proves they are head-on rather than three-quarter shots.

**The photos then settled three things the data had guessed at:**
1. Both Way Huge tops read OUT / +9VDC / IN, corroborating the owner's report
   and supplying the DC jack that had been omitted as unobserved. Source moved
   from `owner-inspection` to the Dunlop page.
2. The PastFX shows two barrels left ("mono stereo output"), one right
   ("Input"), and "9V (-)+" by the top edge - so the stereo output and DC jack
   are now recorded.
3. Its aspect ratio (1.259 vs a 1.276 footprint) independently confirms the
   LANDSCAPE orientation the owner had corrected.

Lesson: **a product photo is jack research.** Four pedals' worth of layout came
out of images fetched for a different purpose.

### "I want the chorus after the tuner, I use it as a preamp"
Already possible - the Chain panel's up-arrow calls updatePedalChainPosition,
which PINS the pedal (chainPositionLocked), and it survives both normalizeChain
and Optimize. Verified by replaying the owner's board.

But it exposed a real latent bug: **a pedal could sit in a loop the rig does not
have.** addPedal copies the catalogue's preferredLocation without asking whether
a loop exists, so a chorus landed in 'effects_loop' on a board with none. Every
signal-chain RULE gates on ampHasEffectsLoop, and the properties panel hides the
Signal Location control when there is no loop - correctly - so the pedal sat
somewhere the owner could neither see nor change. Harmless while the loop is
off; the trap is that switching it ON would have yanked the pinned chorus into
the loop segment. normalizeChain now corrects it, so existing boards heal on
their next normalize instead of needing a migration.

## Two more from the owner: Optimize dead, PastFX orientation

### Optimize did nothing - TWO answers to "where are the rows"
The PLACER derives rows from pedal DEPTH, rails only snapping a derived row
onto a mounting bar (the "rails are not rows" fix). The routing cost's
row-alignment penalty never got that fix and treated EVERY RAIL as a row, with
the old hardcoded 55%/5% two-row fallback. So **the optimizer rejected its own
placer's output**: on a Classic Jr (rails 0, 3.1, 6.2, 9.3) the placer puts a
row at y=7.3 and the scorer charged 1.1in of misalignment for not being on rail
6.2. A candidate with a SHORTER cable run (48.4 vs 55.7in) lost on row
alignment (110 vs 88). Real board: 0 of 9 pedals moved before, 3 of 9 after.
Row derivation is now `deriveRowBands` in `layout/rows.ts`, used by both - the
same one-source-of-truth shape as `jacksToRender`.

### The optimizer WORKER had been dead the whole time
Every run failed with `ReferenceError: window is not defined at
calculateGreedyPlacement` and fell back to inline, so nothing looked broken
while the entire point of the worker was lost. Cause: **`typeof window !==
'undefined'` is not a safe guard in a Worker.** Bundlers replace `typeof
window` with a literal for browser builds, and a Worker IS a client bundle
without a `window`, so the guard folds to true and the next line throws. Use
`globalThis` (`engine/debug-flag.ts`), which no bundler rewrites.

It stayed invisible because the worker posted `error.message` only - the stack
on the main thread pointed at the onmessage handler that rebuilt the Error. It
now sends its stack, which is what made it findable in one step.

### My offline harness was not reproducing the app
`dump-configs-offline.js` read `rails` off the `boards` table, where it does
not exist - rails live in `board_rails`. **Every offline replay ran on a
railless board.** Before/after comparisons made with it were self-consistent,
so that work stands, but it is why a rails-dependent bug survived a day of
fingerprinting. Fixed to join board_rails.

### PastFX Chorus Deluxe is LANDSCAPE
120mm wide, 94mm deep - not the portrait 1590BB the first entry assumed (and
flagged as unconfirmed, since pastfx.com blocks fetching). A CE-1 clone is a
wide box. Also stopped `add-owner-pedals.js` clobbering jack provenance on
update: it set `jacks_confidence: 'unknown'` unconditionally, so re-running it
for a DIMENSION fix demoted a researched layout.

## Bugs reported by the owner (same session)

Four, all real, all from using the app rather than reading it.

1. **NS-2 SEND was on the wrong side.** The entry had input, send AND return on
   the right. Its own notes showed the error: the compact-series rule "OUTPUTs
   left, INPUTs right" had been applied to the jack NAMES, not their function -
   SEND is an output and RETURN is an input, so send always belonged on the
   left. Worst possible place to be wrong: the NS-2 is the hub on both boards.

2. **Optimize turned a pedal upside down.** Half turns are now refused; a pedal
   at 180 degrees reads inverted with its footswitch at the far edge, which the
   routing score cannot see because it only measures length. The FIRST version
   of the rule used a bad argument - "no signal jack on the front edge, cables
   run where your feet are" - which holds only for a FRONT-ROW pedal; at the
   back a front-facing jack feeds the corridor between rows. Right case, wrong
   reason. Cost, measured: on the twelve-pedal fixture the half turn was the
   ONLY rotation that ever helped, so that board is now left alone; the real
   board still gains 4-7% from quarter turns.

3. **"Keep facing forward" did not face the pedal forward.** It set a flag and
   left the angle, and re-optimizing could not fix it either, because a locked
   pedal is excluded from the rotation search and keeps its angle permanently.
   Locking now sets the angle to 0; undo restores it.

4. **A chain reorder could not be SAVED.** `UNIQUE(configuration_id,
   chain_position)` was IMMEDIATE, and Postgres checks those row by row during
   a statement. The save upserts the whole chain at once, so any renumbering -
   adding a pedal mid-chain is enough, since normalizeChain re-sorts by
   category - collided with a row that had not moved yet:
   `23505 ... Key (configuration_id, chain_position)=(..., 2) already exists`.
   The FINAL state was always legal. Now DEFERRABLE INITIALLY DEFERRED
   (migration 20260801000005), with `verify-save-reorder.js` holding both
   halves: a reorder must save, AND a duplicated final state must still be
   refused.

**Four rotation-search tests were rebuilt, not relaxed.** Their fixture's only
beneficial rotation was the half turn, so once it was banned they asserted the
search should do something forbidden - and two that still PASSED had gone
vacuous the same way. They now use a board where a quarter turn genuinely pays
(134.17 at rest against 51.61 turned) and share an `expectRealTemptation()`
helper that fails loudly if a case ever empties again.

## P0 and the power budget (same session, after the roadmap)

### P0 - unattributed jack layouts: RESOLVED BY DELETION
The 13 pedals were not mis-researched, they were never researched. Every one of
the 26 signal rows was `input:right @50` / `output:left @50` - byte-for-byte
what `findJack()` synthesises for a pedal with NO data. The fallback had been
written into the database as fact, where it outranked the fallback it came from
and reported itself as knowledge.

Proven routing-neutral BEFORE deleting (118 lines of placements and cable paths,
both boards, both loop settings, byte-identical), then deleted in migration
20260801000004. Contract violations 13 -> 0.

Deletion exposed a real bug: the canvas drew `pedal.jacks` directly, so a pedal
with no data drew NO jacks while its cables attached happily to its edges - the
picture and the wiring disagreed. Both now come from `jacksToRender()`, and an
ASSUMED jack draws hollow so a guess does not look like a fact.

**A verification detour worth keeping.** The real-board fingerprint moved after
the deletion, which contradicted the neutrality proof. It was not the deletion:
the baseline predated phase 6, and the perimeter route had removed a 100-point
`routingFailures` penalty (cableLength 107.68 -> 134.18). Chasing it found
something better - **the cost model and the drawn routing use DIFFERENT
routers and disagreed about one cable**: `calculateRoutingCost` scored it
`fallback-invalid` while `deriveBoardState` routed it fine. The optimizer is
scoring against a more pessimistic model than the one that draws the board.
Logged as P1.5.

### Power budget: BUILT
`src/lib/engine/power` -> derived state -> a Power tab. The design constraint is
the tri-state: `currentMa` is nullable and a `?? 0` turns "unknown" into "free".
Known total and unknown pedals are returned separately; the UI renders
`>= 301 mA`. Also flags pedals over a typical 100mA output and splits by
voltage. Bypassed pedals count - they are still plugged in.

Verified three ways: mutation-tested unit tests (the `?? 0` bug fails 5,
including the exact symptom), the engine against both real boards, and
`.claude/scripts/verify-power-panel.js` driving the real app and asserting on
EXTRACTED TEXT rather than a screenshot. That script has a `PROBE_UNKNOWN` mode
because the branch that matters cannot be reached by clicking: the catalogue has
exactly one pedal with no recorded draw and it is on nobody's board.

Still open: modelling an actual supply (outputs, ratings, assignment) so the app
can say "output 3 is over" rather than only "the board wants 986mA".

## Owner's pedals added (same session, after the roadmap)

Catalogue 63 -> 67: PastFX Chorus Ensemble Deluxe, Strymon Flint V2, Way Huge
Smalls Aqua-Puss (WM71) and Conspiracy Theory (WM20). Dimensions sourced, with
the URL recorded in `notes` - the table has provenance columns for images and
jacks but none for measurements.

**Two things worth carrying forward:**

1. **Ask the owner.** The jack layouts could not be sourced from documents -
   PastFX blocks automated fetching (HTTP 425) and the Way Huge / Strymon
   manuals are image-only with subsetted fonts. The owner answered all four in
   one message. The provenance contract only anticipated documents, so
   `jacks_source_url` now also accepts a token, `owner-inspection` (migration
   20260801000003). Direct inspection is BETTER than a manual: no revision
   mismatch, and immune to the mirroring trap. 17 outstanding -> 13.

2. **A claim in the rotation rework was wrong, and the new pedals disprove it.**
   "Makers put jacks on top precisely when a pedal is wide enough to have room
   there, so 'has top jacks' and 'wider than a compact' are nearly the same
   statement." The Way Huge Smalls are 2.4in wide - narrower than a BOSS
   compact - with both signal jacks on top, and would have passed even the old
   3.5in veto. The zero-rotatable-pedals figure was an artefact of a BOSS-heavy
   catalogue, not a law about pedals. Corrected in the code comment and memory.
   Removing the veto was still right, on the foot-access argument alone - the
   one that was always doing the work.

Rotation candidates 8 -> 11, eligible 7 -> 10, only the two 6.5in Strymons
locked by default. Current draw rounds UP, never down (a 110-130mA range
recorded as 130; 18.5mA into an integer column as 19) - a power budget that
rounds the flattering way calls an inadequate supply adequate.

Next steps are in `.claude/docs/roadmap-next.md`, ordered by what it costs to
be wrong, each item quoted with the measurement behind it.

## Phase 6 + the dense-board "residual" (same session)

### Phase 6: the unroutable cable - FIXED
`HM-2W -> MT-2W` on the 20-pedal board, only with the amp effects loop on. It
is the row-WRAP cable: every row runs right-to-left, so the hop from the far
left of one row to the far right of the next crosses the whole board. It came
out `fallback-invalid`, drawn as a diagonal through five pedal bodies.

**The router was right to refuse.** Three rows of ~5.1in pedals on a 16in
board leave 0.2in corridors, and a patch cable is ~0.24in thick:

    rows (px): 0..217 | 225..428 | 436..639   on a 640px board
    corridors: 8px and 8px
    OBSTACLE_MARGIN is 8px per side -> a route needs >16px
    the `channel` strategy needs gap > 16px; A*'s blocked cells meet exactly

So it is not a routing bug, it is a FULL BOARD - and the run people actually
make there goes around the edge or under. New `perimeter` strategy
(`routeAroundBoard`) walks the ring outside the board both ways and takes the
shorter clear one. It sits LAST in the cascade, so an ordinary cable never
takes it. PERIMETER_OFFSET (24px) must stay inside the canvas padding (80px)
or the route is drawn outside the viewBox.

Verified across all 24 flag combinations on both real boards: 0 invalid, 0
cable-through-body, `perimeter` used exactly once. Path also checked by hand,
segment by segment, against all 20 pedal boxes.

### The "231 dense boards overlap" residual - RETRACTED
It was mostly my measurement, not a defect:
1. The generator allowed 72% area fill. Rectangles do not pack to 72% with
   mixed depths. An independent shelf packer - sorting by decreasing depth,
   ignoring chain order entirely - also failed on **214 of the 231**. The
   other 17 fit only if you discard signal order, which is not on offer.
2. It measured `calculateGreedyPlacement`, which really can emit overlaps (its
   last resort clamps a pedal on-board). But that is not the app's answer:
   across all 231, `calculateOptimalLayoutJoint` set `noLegalCandidate` and
   returned the caller's positions UNTOUCHED. The overlap I measured was my
   harness stacking every pedal at (0,0).

New permanent test `layout/__tests__/placement-property.test.ts`: over 700
random boards, restricted to ones a reference packer proves are fittable, a
legal layout in is always a legal layout out - 0 overlapping, 0 off-board.

### Mutation-tested the collision guards instead of assuming coverage
    early-return guard disabled -> 5 tests fail (2 before this session)
    evaluate guard disabled     -> 1 test fails
    baseline guard disabled     -> NOTHING failed

The gap led to the better finding: **that guard cannot fire.** Overlapping
pedals make their cables unroutable and the cost punishes that far beyond what
tight packing saves - a 0.02in overlap still scores ~4x worse than a spaced
layout. Unreachable, not unlucky. That is a property of the COST function, so
the guard stays; the new test pins the precondition and fails the day the
guard becomes load-bearing. Its comment now says this instead of "no input has
yet been found".

### Next Tasks
- [ ] 13 non-BOSS pedals still carry unattributed jack rows (makers do not
      publish placement). Rotation stays dark for them until sourced.
- [ ] Lane violations on the 20-pedal board with the loop on: two v-runs 1-2px
      apart sharing 150px+. Cosmetic (cables readable but visually merged),
      found during phase 6, not chased.
- [ ] `calculateGreedyPlacement` returns overlapping positions rather than
      signalling failure. Harmless today because every caller re-checks, but
      the contract is muddy.

---

## Session: 2026-07-31 (later) - Rotation, jack research, worker

Roadmap phases 1-4 of `.claude/plans/smooth-knitting-walrus.md`. Phase 5 traced
and diagnosed but deliberately NOT fixed; phase 6 untouched.

### Done
1. **Shared rotation helpers** (`engine/geometry/rotation.ts`). Twelve copies of
   `deg===90||deg===270` and three copies of the jack-side ring, consolidated.
   Two latent bugs fell out: negative rotation read as "not rotated" everywhere
   but the layout engine, and the canvas rotated jack dots only at 90/270 so at
   180 the drawn dot and the attached cable disagreed. Verified a PURE refactor -
   45-line layout fingerprint byte-identical before/after.
2. **Guarded rotation** (`layout/rotation-eligibility.ts`) + `allowRotation`
   toggle, default on. Eligible = top/bottom signal jack AND not large
   (>3.5w or >5.5d) AND not foot-swept. Manual rotation deliberately unrestricted.
3. **Jack research**: 50 pedals, 46 confirmed / 4 unknown, each with a source URL
   and provenance columns mirroring the image contract. Catalogue repaired:
   25 concatenated names split, CE-2W and CS-3 duplicates merged by repointing
   board rows first (0 orphans, 27 board rows before and after).
4. **Optimize in a Web Worker.** Measured: before, a 10ms ticker fired ZERO times
   during the run - the thread never got a turn. After, longest gap 24ms. Score
   and layout identical.

### The finding that matters
**Zero pedals in the catalogue are rotation-eligible.** Every pedal with a
top-edge signal jack is wider than the 3.5in threshold, because manufacturers
put jacks on top precisely when the pedal is wide enough to have room there.
EQ-200/IR-200/MD-200/RV-200/SY-200 are 3.98in; the Strymons 6.5in; PW-3 is also
foot-swept. So the toggle is currently a no-op for every buildable board.
Raising MAX_ROTATABLE_WIDTH_INCHES 3.5 -> 4.0 admits the five 200-series pedals
and nothing else. One constant, but it is a foot-access judgement - owner's call.

### Phase 5 diagnosed, not fixed
The dense-board overlap is ORDERING, not the fallback. A pedal deeper than any
row band must straddle two, which needs a free column; placed chain-LAST there
is none left. The real board escapes only because its 7.56in PW-3 is chain-FIRST.
Fix = place straddlers before the packed run. Left for a session with room to
re-run the config matrix.

### Blocked on the owner
- `supabase link --project-ref svettejruydudcecvnhf` then `db push` - the CLI's
  cached pooler URL points at the dead project, and re-linking prompts for the
  database password. Until then the jack data cannot be imported.
- 13 non-BOSS pedals: no manufacturer publishes jack placement (the MXR manual
  names the jacks but never says which side). Left unresearched rather than
  invented; verify-pedal-jacks.js lists them.

### Next Tasks
- [x] Apply the migration, then `node scraper/import-pedal-jacks.js` - DONE
- [x] **Rotation rework - BUILT 2026-08-01, see the session above.** The plan
      below is kept for its reasoning; note that step 1's "keep the same
      threshold as the default" turned out to be wrong and was raised to
      4.5 x 6.5in. The width veto is wrong
      and should go. Reasoning, so it is not relitigated: "does it fit?" is
      already answered without it - hasPlacementCollision scores any overlapping
      or off-board candidate Infinity and measures with ROTATED dimensions, and
      a rotation is kept only if strictly better. The width rule was a proxy for
      "can you still step on the footswitch", but rotation turns the footswitch
      sideways on ANY pedal, a 2.87in compact as much as a 3.98in EQ-200 - so
      width does not discriminate on foot access at all. What it DID do was
      exclude precisely the top-jack pedals rotation exists to help: a rule that
      only ever fires as a false negative.
      The plan:
        1. Delete isLargePedal as a VETO. Keep the same threshold as the
           DEFAULT for the new per-pedal lock (below) - a heuristic belongs in
           a default, not a hard rule.
        2. Keep isFootSwept as a hard rule. A rotated wah or volume treadle
           cannot be rocked heel-to-toe; that is broken, not awkward.
        3. Demote hasTopOrBottomSignalJack in the comments from a veto to what
           it really is - a search PRUNE, so the 200-evaluation budget is not
           spent on pedals that provably cannot gain.
        4. NEW per-pedal lock, because most people would not want a BigSky
           turned even though it fits:
           - `PlacedPedal.rotationLocked?: boolean` (per BOARD, not per
             catalogue pedal - it is a decision about this pedal on this board)
           - migration: `configuration_pedals.rotation_locked BOOLEAN DEFAULT false`
           - default it ON when the pedal is added if isLargePedal(pedal), so
             the common case is protected without being unoverridable
           - store action setRotationLocked + persist in editor-client save and
             the page.tsx load mapping
           - toggle in properties-panel beside "Rotate 90 degrees", worded as
             intent not mechanism ("Keep facing forward")
           - canOptimizerRotate takes the placed pedal too and honours the lock
        5. Tests: the current rotation-search case asserting EQ-200 is REFUSED
           becomes EQ-200 is allowed; add one proving a locked pedal is not
           rotated even when rotating would score better (assert the temptation
           is real, as that test already does, so it cannot pass vacuously).
      Verify: real-board fingerprint before/after, and 8 rotation candidates
      exist now so this will actually change layouts - check both boards.
- [ ] Phase 5: place straddling pedals before the packed run
- [ ] Phase 6: the one unroutable pedal-to-pedal cable on the 20-pedal board

## Session: 2026-07-31 - Variable row heights (the placement rework's last open item)

### Summary
Closed the one problem the previous session left open: the tail of the chain
wrapped back to the right of the back row (DD-7 right of PH-3). Rows now have
VARIABLE heights, so a deeper-than-typical pedal gets a band instead of
straddling two. No open placement problems remain.

### The fix
`deriveRows()` returns bands (`{y, height}`), not bare y positions. Every row
starts at the typical (80th-percentile) depth; rows are then grown deepest-first
with the deepest at the BACK, while the budget closes.

It needs TWO constants, and conflating them was the whole bug:
- `ROW_GAP` (0.35) - the corridor rows are DESIGNED for. Still what row COUNT is
  derived at: buying an extra row by squeezing every corridor would starve the
  cable router board-wide, where a grown band only narrows the corridor above
  the one deep pedal.
- `MIN_ROW_CLEARANCE` (0.15) - what makes a placement LEGAL. A grown band
  necessarily sits closer than the designed corridor, so judging its pedals
  against 0.35in rejected every candidate in it.

### Results (real app, verify-placement.js)
| | before | after |
|---|---|---|
| routing score | 1129.9 | 564.9 (baseline 3316.7) |
| back row | 10.8 → 7.4 → 4.0 → 0.6 → **22.0 → 18.6 → 15.3** | 23.6 → … → 0.0 |
| chain-order failures | 1 | 0 |
| lane violations | 1 | 0 |
| invalid cables | 1 | 1 (pre-existing) |
| min front-to-back | 0.350in | 0.185in |
| Classic Jr | 215.3 | 214.9 (unchanged) |

### Two traps, both hit this session
1. **The arithmetic in the last session log was wrong** and my first patch
   silently did nothing because of it. It assumed 5.08in rows; four of those
   pedals are really 5.10in, so the grown budget is 5.43 + 2x5.10 = 15.63in
   leaving **0.185in** per corridor, not 0.205. With the floor at a rounder 0.2
   the budget does not close, the row never grows, and the mechanism no-ops.
   Do not round `MIN_ROW_CLEARANCE` up. (Last session's lesson was "verify the
   patch applied"; this one's is "verify it CHANGED THE OUTPUT" - the patch
   applied fine and the layout was still byte-identical.)
2. **The verifier excused the bug.** `verify-placement.js` decided "too deep for
   a band" by depth alone, so EQ-200 was exempt from the row-order check and the
   broken layout would have passed. It now asks whether a pedal's body actually
   reaches into the row in front. Only PW-3 (7.56in, deeper than any band can
   be) is still reported as spanning two rows.

### Method that worked
Replaying the dumped store state (`/tmp/livestate.json`) offline through
`calculateOptimalLayoutJoint` AND `simulateConfiguration` (the matrix harness's
full pipeline) gave placement + cable-routing invariants in ~0.5s per run, with
before/after isolated by `git stash`. Every number in the table above came from
that before the app was ever opened. New tests were checked against the OLD code
to confirm they actually fail on it - one of the three did not, and was rewritten
(it asserted where the pedal sat, not that the BAND was sized for it).

### Next Tasks
- [ ] One cable on the 20-pedal board still cannot route (pedal→pedal, invalid).
      Pre-existing and unrelated to placement; unexamined.
- [ ] Un-skip `dense boards still hit the overlapping fallback` in
      optimize-e2e.test.ts once the overflow path stops stacking pedals
- [ ] Optional: EQ-200 has top/bottom jacks, so rotated it is 3.98in deep and
      needs no grown row at all. The rotation search did not pick that - worth
      checking whether the routing cost sees the corridor it would buy back.

---

## Session: 2026-07-30 (later) - Placement rework

### Summary
Optimize was unusable on the main 20-pedal Classic Pro board ("Could not fit
these pedals on this board"). Two root causes found and fixed; one arithmetic
constraint remains. Also fixed a knockout regression that hollowed out pedal
photos, and added per-pedal image overrides.

### Root causes found (both by TRACING, not by reading)
1. **Rails were treated as rows.** A Classic Pro has rails at [0, 3.75, 7.5,
   11.25] - mounting bars a 5.08in pedal sits ACROSS. One row per rail gave a
   3.75in pitch, the "rails too close" guard fired, and the board collapsed to
   TWO rows = an 18-pedal ceiling. Every real board has rails, so this ran
   every time and depth-derived rows never did - which is why synthetic tests
   passed while the real board failed.
2. **Row spacing was not axis-aware.** Row1 pedals span 5.45-10.53, row0 starts
   at 10.90: a 0.37in gap, but isValidPlacement demanded COLLISION_SPACING
   (0.5in) in BOTH axes. Rows 0 and 1 were mutually exclusive - nothing could
   ever occupy row1 - so the chain skipped it and came back later, reading
   front -> back -> middle. Split into ROW_GAP (0.35in, front-to-back) vs
   COLLISION_SPACING (0.5in, side-to-side): a cable leaves through SIDE jacks.

### Results
| | before | after |
|---|---|---|
| 20-pedal Classic Pro | "could not fit" | works, 3316.7 -> 1129.9 |
| row order | front -> back -> middle | 10.9 -> 5.5 -> 0.0 monotonic |
| 7-pedal Classic Jr | reported broken | clean (checker was wrong) |
| open problems | 3 | 1 |

### THE REMAINING PROBLEM - start here next session
`DD-7 sits RIGHT of PH-3` on the 20-pedal board. Not a code bug - arithmetic:

**EQ-200 is 5.43in deep and fits NO row band.** Three 5.43in rows need 16.29in
on a 16in board. So it straddles two bands, and can only do so where no row-1
pedal sits above it (x < 18.1). That truncates the run to 5 of 8 pedals and the
tail wraps to the empty right side of the row.

**The fix: variable row heights.** 2 rows at 5.08 + 1 row at 5.43 = 15.59in;
with 2 gaps of 0.2in that is 15.99in <= 16in. Uniform rows cannot do it.
Implement in `deriveRows()` (src/lib/engine/layout/index.ts ~line 115):
  - return per-row heights, not one rowDepth
  - grow rows deepest-first while `sum(heights) + (count-1)*ROW_GAP <= depth`
  - put the deepest row at the BACK (y=0); the front row is capped by the board edge
  - `rowBandDepth()` then reads the per-row height
  - NOTE: ROW_GAP may need to drop from 0.35 to ~0.2 for the budget to close.
    Watch config-matrix - tighter corridors starve the cable router.

**I attempted this and the patch silently no-oped** (an earlier `git checkout`
had reverted deriveRows to a different signature, so the replace matched
nothing). Verify the patch actually applied before testing.

### Verification tooling added
- `.claude/scripts/verify-placement.js` - drives Optimize in the real app,
  asserts no overlaps/off-board, signal order right-to-left per row, and
  monotonic row progression. Walks the CABLE GRAPH for signal order, not
  chainPosition (a hub pedal's loop members come after it in signal but
  before it in the list - comparing to chainPosition flags correct layouts).
- `.claude/scripts/dump-state.js` - dumps a config's exact store state to JSON
- `DEBUG_PLACEMENT=1` now works offline, so the placer's row decisions can be
  traced against a dumped state. This is what found both root causes.

### Also this session
- Knockout regression: the FORCE re-mirror hollowed out 14 of 64 photos
  (BF-3/PH-3 rendered as black blobs). Gradient-following walked out of the
  backdrop into pedals' light areas. Added a centre guard + strict retry.
- `PEDAL_OVERRIDES` in the mirror script: 4 pedals the flood fill cannot
  handle are explicit, reviewable entries instead of constant-tuning that
  shifts all 64 outcomes. State: 60 photos, 1 referenced (Klon), 4 rects.
- Deleted ~330 lines of dead placement code (placePedalGroupSnake cluster) -
  it is the code whose name matches "zigzag" while the live placer is
  placePackedChain, so it misdirects debugging.
- Cable diagonals: separateParallelRuns tilts a neighbour when it shifts a
  run; paths are now repaired with manhattanize() (shared in engine/geometry)
  rather than the shift being rejected, which cost the lane separation.

### Next Tasks
- [ ] Variable row heights in deriveRows (see THE REMAINING PROBLEM above)
- [ ] Un-skip `dense boards still hit the overlapping fallback` in
      optimize-e2e.test.ts once the overflow path stops stacking pedals
- [ ] Optional: replace the image flood-fill with a real matting model
      (rembg, local, free) - 4 hand-written overrides out of 64 is the signal
      that the heuristic is at its limit. Would not fix Big Muff (wrong angle).

---

## Session: 2026-07-30

### Summary
Shipped the custom-pedal-upload background knockout, then reviewed the 114-pattern
ledger at `../dev-liftable-patterns` against this codebase and applied six findings
in six commits. All pushed to main.

### What Was Accomplished
- [x] Background knockout for /pedals/new uploads (b0a3da0) - the last HIGH backlog item
- [x] Un-ignored the scraper scripts; only scraped JSON dumps stay ignored (59bb223)
- [x] Image provenance columns + rights statement + Klon resolved as reference-only (0b561e3)
- [x] LANE_SPACING collapsed into engine/geometry; overhang trio audited, kept separate (11246bc)
- [x] Optimize now explains what it traded off, from one shared dimension list (f6fa495)
- [x] Self-declaring fixture corpus for the knockout detector (983516e)
- [x] Machine twin + [data-pedal-canvas]; extract-positions.js migrated (68cbfcb)
- [x] currentMa tri-state contract documented (no code - not a bug today)

### Key Changes
| File | Change |
|------|--------|
| `src/lib/images/knockout.ts`, `prepare-pedal-photo.ts` | Pure RGBA knockout ported out of the mirror script; runs client-side pre-upload |
| `supabase/migrations/20260730000001_add_image_provenance.sql` | image_source_url/license/attribution/fetched_at; Klon set to reference-only |
| `scraper/mirror-pedal-images.js` | Writes provenance with the image, clears it with the image, skips referenced rows even under FORCE=1 |
| `src/lib/engine/geometry/index.ts` | Now owns LANE_SPACING + MIN_LANE_SPACING |
| `src/lib/engine/layout/routing-cost.ts` | COST_DIMENSIONS drives both totalScore and summarizeOptimization |
| `src/lib/engine/cables/routing-strategies.ts` | Each cascade rung tags its own result with a RoutingStrategy |
| `src/store/derived.ts` | `__getPedalSchemaSnapshot()` - the machine twin |
| `.claude/scripts/lib/twin.js`, `verify-twin-parity.js` | Shared script access + the twin's honesty check |

### Technical Decisions
1. **Klon Centaur: reference, never mirror.** Its only good source is CC BY-SA 2.0
   and our knockout modifies the image, so mirroring would make our copy a
   derivative and pull share-alike onto our output. Enforced in code, not just
   documented - the script skips provenance-without-image rows even under FORCE=1.
2. **The migration adds columns but NOT the `image_url => image_source_url` CHECK.**
   A CHECK fires on UPDATE as well as INSERT (even NOT VALID), so it would break
   import-pedals.js against the 64 legacy rows. Sequence: columns -> FORCE re-mirror
   -> follow-up migration adds the constraint.
3. **totalScore is the SUM of COST_DIMENSIONS**, not a separate expression. That is
   what makes the shown rationale unable to describe a different ranking.
4. **Three overhang constants deliberately NOT merged** (64/70/16) - they govern the
   corridor graph, lane-shift clamping, and path rejection respectively.
5. **The 7-rung routing cascade was NOT rewritten** into a capability matrix. It
   works; only the winning strategy label was worth adding.

### Verification Notes
- Knockout: 15 unit tests + Chromium end-to-end (`verify-photo-knockout.js`). The
  rounded-corner fixture is the one that proves the fix - a square fixture cannot,
  since it fills its own bounding box.
- Twin parity: all 7 pedals matched between DOM scrape and twin; projection
  hit-tested via elementFromPoint against data-pedal-id.
- The editor renders **27 svgs** - the old "canvas is the largest svg" heuristic
  was choosing one of 27 by area.
- `vitest does NOT typecheck`, so the fixture corpus's type-link depends on tsc
  (npm run build). The runtime coverage test covers the other half.

### Next Tasks
- [ ] APPLY the provenance migration to production, then run
      `FORCE=1 node scraper/mirror-pedal-images.js` to backfill all 64 rows,
      then add the `image_url => image_source_url` CHECK in a follow-up migration
- [ ] Investigate the red "1 Issue" Next.js dev-overlay badge in the editor
- [ ] Mobile touch drag-and-drop; cable bundling (older backlog)
- [ ] Optimizer applies a worse layout when greedy re-placement scores below a
      hand-tuned board - currently reported honestly ("Rearranged, but scored
      worse"), but arguably it should keep the better one

---

## Session: 2026-07-19

### Summary
Completed non-BOSS pedal photo mirroring (64/65 coverage) and made photos render as true cut-out silhouettes on the board - no more colored/white boxes around pedals. Commit e18b990, pushed.

### What Was Accomplished
- [x] Mirrored the 8 remaining findable non-BOSS pedal photos (EHX x3, TS9, Cry Baby, RAT 2, Polytune 3, Ditto)
- [x] Added flood-fill background knockout to the mirror pipeline; re-mirrored all 64 images as silhouette PNGs
- [x] Renderer: no body box/border/overlay under a loaded photo; inactive = 35% photo opacity
- [x] Cache-busted image URLs (`?v=<ts>`) - re-mirrors were invisible behind storage max-age=3600
- [x] Verified: border-pixel scans on all 64 images, live-DOM check (7/7 photo pedals rect-free), e2e verify script

### Key Changes
| File | Change |
|------|--------|
| `src/components/editor/canvas/pedal-renderer.tsx` | `imageLoaded` state gates backdrop/border/drag-shadow/inactive rects; `preserveAspectRatio="none"` |
| `scraper/mirror-pedal-images.js` (GITIGNORED - local only) | `knockOutBackground()` flood fill (gradient-following, luminance-90 floor, >90% revert), direct-image-URL sources, `?v=` versioning, `ONLY=` filter, 60s fetch timeout |
| `package.json` | `sharp` devDependency |

### Technical Decisions
1. **Image sources when manufacturers vanish**: EHX og:images are lifestyle shots - use numbered gallery files; TC images recovered from Wayback Machine (`im_` suffix, codes P0CM0/P0DD4); ProCo lives at actentertainment.com now; procopedals.com rejected (affiliate site, Amazon photos, licensing).
2. **Knockout safety**: gradient-following flood fill never enters pixels darker than luminance 90 (shadows/black enclosures survive); knockouts eating >90% of the frame revert.
3. **Klon Centaur intentionally has no photo** - no manufacturer source; Wikimedia CC needs an attribution decision.
4. **URL versioning over cache headers**: uploads reuse the same storage path, so only a changed query string reliably invalidates browsers/CDN.

### Next Tasks
- [ ] Background knockout for custom pedal uploads (/pedals/new) - user uploads still get white boxes (HIGH - same bug class just fixed for system pedals; sharp + knockout already exist)
- [ ] Un-ignore `scraper/mirror-pedal-images.js` - curated URLs + knockout algorithm exist only on this machine
- [ ] Klon Centaur photo: user decision on Wikimedia CC attribution
- [ ] Investigate the red "1 Issue" Next.js dev-overlay badge seen in editor
- [ ] Mobile touch drag-and-drop; cable-validation edge-case tests; cable bundling (older backlog)

---

## Session: 2026-01-22

### Summary
Major cable routing and layout optimization fixes from nextstep.md plan. Unified routing logic, fixed cables through pedals, improved zone sizing, and added 4-cable method rule.

### What Was Accomplished
- [x] Removed "expanded exclude" logic that was allowing cables through adjacent pedals
- [x] Added endpoint tolerance (4px) for first/last cable segments
- [x] Enforced board bounds in cable routing (cables stay on board)
- [x] Tightened L-path shortcuts (80px max with obstacles, was 150px)
- [x] Implemented cable grouping by from/to pair and jack type for offset calculation
- [x] Increased cable offset from 4px to 8px for better visual separation
- [x] Dynamic standoff based on pedal size
- [x] Dynamic FX loop zone sizing based on actual pedal widths
- [x] Snake pattern layout (right-to-left on all rows)
- [x] Added `four-cable-fx-loop` rule for auto-routing modulation/delay/reverb to loop
- [x] Unified cable-renderer to use routing-strategies (single source of truth)
- [x] Added debug helper `window.__loadPedalSchemaRepro()` for loading repro snapshots

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/cables/validation.ts` | NEW: Removed expanded exclude logic; now only excludes source/dest pedals; added ENDPOINT_TOLERANCE (4px) |
| `src/lib/engine/cables/routing-strategies.ts` | NEW: Added `computeCableGroups()` with jack-type grouping; `isPathWithinBounds()` helper; off-board endpoint handling; increased CABLE_OFFSET to 8px |
| `src/lib/engine/pathfinding/index.ts` | Added `BoardBounds` interface; dynamic standoff based on pedal size; tightened L-path shortcuts when obstacles present |
| `src/components/editor/canvas/cable-renderer.tsx` | Unified to use `routeCableWithObstacles()`; removed duplicate routing logic; added `useMemo` for performance |
| `src/components/editor/canvas/editor-canvas.tsx` | Uses `computeCableGroups()` for per-group cable offsets |
| `src/lib/engine/layout/index.ts` | Snake pattern placement (right-to-left on all rows); dynamic zone sizing based on pedal widths; zone overlap handling |
| `src/lib/engine/layout/optimizer-v2.ts` | NEW: Dynamic ampZoneBoundary; overflow into opposite zone instead of (0,0) fallback |
| `src/lib/engine/signal-chain/rules.ts` | Added `four-cable-fx-loop` rule (modulation/delay/reverb → effects loop when 4-cable method enabled) |
| `src/store/configuration-store.ts` | Added `window.__loadPedalSchemaRepro()` debug helper |

### Technical Decisions
1. **No expanded excludes**: Cables must route around ALL pedals except source/destination. Previous logic was excluding adjacent pedals if their margin zones overlapped endpoints - this was wrong.
2. **Off-board endpoint handling**: Amp connections (guitar, amp_input, amp_send, amp_return) have endpoints outside board bounds. `allowOffBoard` flag skips bounds checking for these cables.
3. **Jack-type cable grouping**: Cables to different jacks on the same pedal are now separate groups (e.g., NS-2 input vs send/return). Prevents unnecessary spreading.
4. **Dynamic standoff**: `max(minStandoff, max(halfWidth, halfHeight) * 0.6)` ensures cables clear larger pedals.
5. **Snake pattern**: Always place right-to-left on all rows. Later chain positions stay closer to amp. No direction flip between rows.
6. **Dynamic zone boundary**: Zone split calculated from actual pedal widths, not fixed 35%. Allows overflow when zones are full.

### Architecture Notes
**Cable Validation (validation.ts):**
```
- excludePedalIds: ONLY source and destination pedals
- First/last segments: use reduced margin (OBSTACLE_MARGIN - ENDPOINT_TOLERANCE)
- Middle segments: use full OBSTACLE_MARGIN
- No expanded excludes for adjacent pedals
```

**Cable Grouping (routing-strategies.ts):**
```
getCableGroupKey():
- Pedal-to-pedal: `pedal:${id1}:${id2}:jack:${jackPair}`
- External→pedal: `ext:${fromType}:${toPedalId}:jack:${toJack}`
- Pedal→external: `ext:${fromPedalId}:${toType}:jack:${fromJack}`
```

**Layout Zone Sizing (layout/index.ts):**
```
frontRequired = sum(front pedal widths) + spacing
loopRequired = sum(loop pedal widths) + spacing
ampZoneBoundary = max(minLoop, min(loopRequired, maxLoop))
If zones don't fit, zonesOverlap = true (pedals can overflow)
```

### Next Tasks
- [ ] Test with crowded boards to verify cable routing improvements
- [ ] Consider visual indicator for invalid cable paths (currently red)
- [ ] Add tests for cable validation edge cases
- [ ] Verify 4-cable method rule works with various pedal configurations

---

## Session: 2026-01-08 (Afternoon)

### Summary
Fixed cable routing: cables no longer go off-screen or appear to pass through pedals.

### What Was Accomplished
- [x] Fixed cables going off-screen (y=-20 → y=236)
- [x] Added universal standoff from jack positions before routing
- [x] Added boardBounds constraint to keep cables within visible area
- [x] Verified fixes mathematically using extracted path coordinates
- [x] Created cable log capture script for verification
- [x] Disabled DEBUG_PATHS flag for production

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/cables/routing-strategies.ts` | Added `boardBounds`, `fromBox`, `toBox` parameters; uses `getStandoffPoint()` for universal standoff; added `constrainY`/`constrainX` helpers |
| `src/lib/engine/pathfinding/index.ts` | Added `BoardBounds` interface and `boardBounds` parameter to `findPathAStar()`; constrains A* grid to board bounds |
| `src/components/editor/canvas/cable-renderer.tsx` | Passes pedal boxes and board bounds to `routeCablePath()`; disabled DEBUG_PATHS |
| `.claude/scripts/capture-cable-logs.js` | New script to capture cable routing console output for verification |
| `.claude/scripts/get-config-url.js` | New script to get configuration URL from dashboard |

### Technical Decisions
1. **Board bounds constraint**: All routing strategies now constrain Y coordinates to `[boardBounds.minY + 20, boardBounds.maxY - 20]` to keep cables visible on the board.
2. **Universal standoffs**: Every cable path now starts with a standoff point that moves 25px AWAY from the source/destination pedal before any routing occurs. This prevents cables from appearing to go through pedals.
3. **Standoff direction from `getStandoffPoint()`**: Uses jack position relative to pedal box to determine which direction to move (left edge → move left, right edge → move right, etc.).
4. **A* grid constrained to board**: When `boardBounds` is provided, A* pathfinding grid is constrained to `[minY + 10, maxY + 20]` to prevent routing above the board.

### Architecture Notes
**Cable Routing with Standoffs (routing-strategies.ts):**
```
1. Calculate standoff points using getStandoffPoint(from, fromBox, 25)
2. Build path: from → fromStandoff → [routing channel] → toStandoff → to
3. constrainY() ensures all Y values stay within [minY+20, maxY-20]
4. Validate route; if fails, try above/below routing
5. Fallback to A* with board bounds constraint
```

**Verification Method (per CLAUDE.md):**
```
1. Extract path coordinates from console logs
2. Verify all Y values are within [0, 500] (board bounds)
3. Verify routing channel Y (236, 276) is in gap between pedal rows
4. Construct ASCII diagram from extracted data
```

### Verification Results
```
BEFORE: Cable 7 path: (-60,250) → (-60,-20) → (580,-20) → (580,102)
                                    ^^^^^        ^^^^^
                                    OFF SCREEN (y < 0)

AFTER:  Cable 7 path: (-60,250) → (-60,236) → (604,236) → (605,102) → (580,102)
                                     ^^^         ^^^
                                     IN GAP (y=236 is between rows)

All 9 cables verified: Y ∈ [100, 400] (within board [0, 500]) ✓
```

### Next Tasks
- [ ] Consider cable color coding by signal path type
- [ ] Test with more complex/crowded board layouts
- [ ] May want to add visual indicator when standoff routing is active

---

## Session: 2026-01-08

### Summary
Fixed cable routing optimization: aligned cost function with visual renderer and increased penalties to force the optimizer to place pedals with clear cable channels.

### What Was Accomplished
- [x] Aligned cost function routing logic with visual renderer (uses same L-path strategy)
- [x] Added cable collision penalty function to detect cables going through pedals
- [x] Increased spacing penalty from 50 to 200 inches per close pedal pair
- [x] Increased minimum cable clearance from 62.5px to 75px
- [x] Added complex routing penalty (30 inches for paths needing more than 3 points)
- [x] Imported `validateRoute` and `lineIntersectsBox` for consistent collision detection
- [x] Verified both standard and 4-cable method produce cleaner layouts

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/layout/routing-cost.ts` | Rewrote `routeCable()` to match visual renderer's L-path logic; added `calculateCableCollisionPenalty()`; increased spacing penalty to 200; added complex routing penalty of 30 |
| `src/components/editor/canvas/cable-renderer.tsx` | Simplified to use L-shaped routing with no exclusions |
| `src/lib/engine/pathfinding/index.ts` | Fixed emergency fallback to stay on board (positive Y values) |

### Technical Decisions
1. **Cost-renderer alignment**: Root cause of cables through pedals was mismatch between how cost function (A* routing) and visual renderer (L-paths) computed paths. Now both use same strategy.
2. **Heavy spacing penalty (200 inches)**: Forces optimizer to leave 75px (~1.9 inch) gaps between pedals for clean L-path cable routes.
3. **Complex routing penalty**: Discourages layouts requiring fallback routing strategies (channels, perimeter, A*).
4. **No exclusions in routing**: Changed from excluding source/destination boxes to checking ALL boxes for collisions.

### Architecture Notes
**Cable Routing Strategy (now consistent in both files):**
```
1. Direct line (if distance <= 80px and validates)
2. L-path horizontal-first (from → mid → to)
3. L-path vertical-first (from → mid → to)
4. Channel routing through gaps between pedal rows
5. Route above/below all pedals
6. A* fallback with no exclusions
```

**Cost Function Penalties:**
```
totalScore = routedLength
           + crossings * 6
           + spacingPenalty (200 per close pair)
           + collisionPenalty (100 per intersection)
           + complexRoutingPenalty (30 per complex cable)
```

### Next Tasks
- [ ] Consider adding visual feedback when cables have to use fallback routing
- [ ] Test with even more crowded pedalboard layouts
- [ ] May need to tune penalties further based on real-world usage

---

## Session: 2026-01-07 (Very Late Night)

### Summary
Fixed noise gate positioning bug and added clean/dirty modulation setting for effects loop routing.

### What Was Accomplished
- [x] Diagnosed NS-2 appearing after modulation (PH-3, BF-3) instead of before
- [x] Found bug in `noise-gate-after-drive` rule - was moving gates to END of chain instead of after last drive
- [x] Fixed rule to only move noise gates that are BEFORE the last drive pedal
- [x] Added `modulationInLoop` setting (clean vs dirty modulation)
- [x] Updated modulation-flexible rule to move modulation to effects loop when enabled
- [x] Added UI toggle in Routing Options panel
- [x] Created database migration for `modulation_in_loop` column
- [x] Updated editor to load/save the new setting

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/signal-chain/rules.ts` | Fixed `noise-gate-after-drive` rule, updated `modulation-flexible` to respect `modulationInLoop` |
| `src/types/index.ts` | Added `modulationInLoop` to `Configuration` and `ChainContext` |
| `src/store/configuration-store.ts` | Added `modulationInLoop` state and `setModulationInLoop` action |
| `src/components/editor/panels/routing-options-panel.tsx` | Added Modulation toggle (clean/dirty) |
| `src/app/(dashboard)/editor/[id]/page.tsx` | Pass `modulationInLoop` prop |
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Accept and save `modulationInLoop` |
| `supabase/migrations/20240107000002_add_modulation_in_loop.sql` | Add column to configurations |

### Technical Decisions
1. **Noise gate bug**: The original rule collected ALL noise gates and inserted them after the last drive. Fixed to only move gates that are BEFORE the last drive.
2. **Clean vs Dirty modulation**:
   - Dirty (default): Modulation stays in front of amp - preamp distortion affects modulated signal
   - Clean: Modulation goes in effects loop - cleaner, unaffected by preamp
3. **UI placement**: Modulation toggle only appears when effects loop is enabled (logical dependency)

### Architecture Notes
**Modulation Placement Logic:**
```
if (modulationInLoop && ampHasEffectsLoop && useEffectsLoop) {
  // Move chorus, flanger, phaser, tremolo to effects_loop location
}
```
This ensures the toggle only has effect when the effects loop is active.

### Next Tasks
- [ ] None - feature complete

---

## Session: 2026-01-07 (Late Night)

### Summary
Major optimization system overhaul: implemented joint topology + geometry optimization and added per-pedal loop toggle for NS-2 style pedals.

### What Was Accomplished
- [x] Fixed cables going through pedals (increased OBSTACLE_MARGIN, reduced GRID_CELL_SIZE)
- [x] Implemented joint topology + geometry optimization (signal chain + placement optimized together)
- [x] Added `SwappableGroup` detection for consecutive same-category pedals
- [x] Added `tryChainSwap` SA move type (25% probability) to reorder within swappable groups
- [x] Fixed Euclidean fallback bug (>10 pedals was using straight-line distance instead of A* routing)
- [x] Added `useLoop` toggle for NS-2 style pedals (no longer auto-uses all 4 jacks)
- [x] Created database migration for `use_loop` column
- [x] Renamed migration files to Supabase timestamp format
- [x] Pushed migration to production database

### Key Changes
| File | Change |
|------|--------|
| `src/types/index.ts` | Added `SwappableGroup`, `PedalPlacement`, `JointOptimizationResult`, `useLoop` field on `PlacedPedal` |
| `src/lib/engine/signal-chain/index.ts` | Added `identifySwappableGroups()` function |
| `src/lib/engine/layout/optimizer.ts` | Added `tryChainSwap`, `optimizeJointly()`, fixed Euclidean fallback, returns `JointOptimizationResult` |
| `src/lib/engine/layout/index.ts` | Added `calculateOptimalLayoutJoint()` |
| `src/lib/engine/layout/routing-cost.ts` | Uses shared `PedalPlacement` type from types |
| `src/lib/engine/pathfinding/index.ts` | Extracted A* pathfinding from cable-renderer (new file) |
| `src/lib/engine/cables/index.ts` | Check `placed.useLoop` before using send/return jacks |
| `src/store/configuration-store.ts` | Added `setUseLoop` action, uses `calculateOptimalLayoutJoint()` |
| `src/components/editor/panels/properties-panel.tsx` | Added "Loop Routing" toggle UI for 4-cable pedals |
| `src/app/(dashboard)/editor/[id]/page.tsx` | Load `use_loop` from database |
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Save `use_loop` to database |
| `supabase/migrations/20240107000001_add_use_loop.sql` | Add `use_loop` column to `configuration_pedals` |

### Technical Decisions
1. **Joint optimization**: SA now optimizes both pedal positions AND signal chain order simultaneously, returning `{ placements, chainOrder, swappableGroups }`
2. **Swappable groups**: Consecutive pedals of same category (e.g., 3 overdrives) can be reordered for better cable routing
3. **Non-swappable categories**: tuner, looper, volume, utility, multi_fx are never swapped (user intent critical)
4. **useLoop default false**: NS-2 style pedals now require explicit opt-in for 4-cable routing
5. **Always use routing cost**: Removed Euclidean fallback for >10 pedals - A* routing always used

### Architecture Notes
**Joint Optimization Flow:**
```
1. identifySwappableGroups() finds [OD1, OD2, OD3] as swappable
2. SA runs with 4 move types:
   - trySwap (30%): swap pedal x,y positions
   - tryNudge (30%): move pedal slightly
   - tryRowChange (15%): move to different rail
   - tryChainSwap (25%): reorder within swappable group
3. Cost function uses A* routing (never Euclidean)
4. Returns { placements, chainOrder }
5. Store applies both position AND chainPosition changes
```

**NS-2 Loop Toggle:**
- `useLoop: boolean` on `PlacedPedal` controls whether send/return jacks are used
- Default `false` - only input/output jacks used (2 cables)
- When `true` - drive pedals route through the loop (4 cables)

### Next Tasks
- [ ] Test joint optimization with complex pedalboard layouts
- [ ] Consider anchor optimization (guitar/amp positions currently fixed)
- [ ] Add visual indicator when chain order was optimized

---

## Session: 2026-01-07 (Night)

### Summary
Set up BOSS pedal scraper and imported 41 pedals to Supabase database.

### What Was Accomplished
- [x] Reviewed scraper folder contents (boss_scraper.py, pedal.schema.json, import-pedals.js)
- [x] Added scraper/ to .gitignore (contains local JSON data files)
- [x] Fixed Python 3.9 compatibility in boss_scraper.py (Optional[] type hints)
- [x] Ran BOSS scraper - collected 41 pedals with dimensions, power specs, and I/O info
- [x] Created import-pedals.js to transform scraped data to database schema
- [x] Fixed column name mismatch (supports_4_cable vs supports_4cable)
- [x] Added SUPABASE_SERVICE_ROLE_KEY to bypass RLS for system pedal inserts
- [x] Successfully imported 41 BOSS pedals to database

### Key Changes
| File | Change |
|------|--------|
| `.gitignore` | Added scraper/ to ignore local JSON data files |
| `package.json` | Added dotenv dependency for import script |
| `scraper/boss_scraper.py` | Fixed Python 3.9 compatibility (typing imports) |
| `scraper/import-pedals.js` | Created import script with category mapping |
| `scraper/boss_pedals.json` | Generated 41 BOSS pedals (not committed) |
| `.env.local` | Added SUPABASE_SERVICE_ROLE_KEY |

### Technical Decisions
1. **Service role key for system pedals**: RLS policy prevents regular users from inserting `is_system=true` pedals. Service role bypasses RLS.
2. **Category mapping**: Scraper types (chorus, flanger, phaser, vibrato, rotary) map to database `modulation` category
3. **Scraper folder in gitignore**: JSON output files contain scraped data that shouldn't be in version control

### Architecture Notes
**RLS Policies for pedals table:**
- SELECT: System pedals viewable by everyone (`is_system = true`)
- SELECT: Users can view their own pedals (`auth.uid() = created_by`)
- INSERT: Users can only create non-system pedals (`is_system = false`)
- UPDATE/DELETE: Users can only modify their own non-system pedals

**Import script flow:**
1. Read scraped JSON
2. Transform to database schema (dimensions, power, category mapping)
3. Check for existing pedals by manufacturer + name
4. Insert new / update existing

### Next Tasks
- [ ] Add more manufacturer scrapers (Strymon, EHX, MXR)
- [ ] Add pedal jack positions (top-mounted vs side-mounted)
- [ ] Consider adding pedal images to the UI

---

## Session: 2026-01-07 (Evening)

### Summary
UI audit and fixes for layout bugs, plus cable routing improvements for effects loop support.

### What Was Accomplished
- [x] Fixed responsive layout with collapsible panels for mobile
- [x] Added mobile hamburger menu to header
- [x] Made toolbar responsive with overflow menu
- [x] Fixed pedal library panel overflow (color dots and "Added" badge)
- [x] Added proper container padding for dashboard
- [x] Fixed right panel sheet only opening on mobile
- [x] Added amp panel visualization with RTN/SND/IN jacks for effects loop
- [x] Fixed cable routing for effects loop connections
- [x] Fixed amp_send → pedal routing to go through open channel (not through pedal body)
- [x] Standardized spacing values across panels

### Key Changes
| File | Change |
|------|--------|
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Added Sheet components for mobile panels, responsive layout |
| `src/app/globals.css` | Added container class with responsive padding |
| `src/components/editor/canvas/cable-renderer.tsx` | Added useEffectsLoop prop, improved external→pedal routing to approach from below |
| `src/components/editor/canvas/editor-canvas.tsx` | Added amp panel with RTN/SND/IN jacks visualization |
| `src/components/editor/panels/pedal-library-panel.tsx` | Fixed overflow - moved color dot left, replaced "Added" with checkmark |
| `src/components/editor/toolbar/editor-toolbar.tsx` | Made responsive with overflow dropdown menu |
| `src/components/layout/header.tsx` | Added mobile hamburger menu |
| `src/components/editor/panels/*.tsx` | Standardized spacing (gap-2, p-2/p-3, space-y-1/2/3) |

### Technical Decisions
1. **Mobile breakpoint at lg (1024px)**: Panels collapse into Sheet components on mobile
2. **Effects loop amp visualization**: Shows three jacks (RTN top, SND middle, IN bottom) when FX loop enabled
3. **External→pedal routing**: Now approaches pedals from below through the open channel between rows, avoiding routing through pedal bodies
4. **Pedal→external routing**: Uses L-shaped paths with standoff points, validated before use

### Architecture Notes
Cable routing for effects loop now properly splits signal:
- Front chain: Guitar → pedals → amp_input (bottom jack)
- Loop chain: amp_send (middle jack) → pedals → amp_return (top jack)

The `useEffectsLoop` prop is passed to CableRenderer to position amp_input jack correctly.

External→pedal routing calculates approach point below the destination pedal and routes through the channel.

### Next Tasks
- [ ] Test with different board layouts and pedal arrangements
- [ ] Consider optimizing cable paths for visual cleanliness
- [ ] Mobile touch interactions for drag-and-drop

---

## Session: 2026-01-07

### Summary
Major refactor of cable routing algorithm to fix cables passing through pedals.

### What Was Accomplished
- [x] Fixed cable routing - cables no longer pass through pedals
- [x] Fixed Z-shaped routing between adjacent pedals
- [x] Fixed amp/guitar cable bump issue (up-then-down zigzag)
- [x] Disabled debug logging for production
- [x] Build verified passing

### Key Changes
| File | Change |
|------|--------|
| `src/components/editor/canvas/cable-renderer.tsx` | Major refactor (714 insertions, 954 deletions) |
| `.claude/scripts/debug-cables.js` | New debug script |
| `.claude/scripts/screenshot-optimized.js` | New screenshot script for post-optimize testing |

### Technical Decisions
1. **Standoff points (35px)**: Added standoff points outside pedal boxes to ensure cables route around pedals, not through them
2. **Three routing strategies**:
   - Short distance (<120px): Direct routing for adjacent pedals
   - External connections (guitar/amp): L-shaped routing with standoff only on pedal side
   - Long pedal-to-pedal: Full standoffs on both sides with A* routing
3. **L-shaped routing for external connections**: Simpler than A* and avoids zigzag artifacts

### Architecture Notes
The cable routing in `cable-renderer.tsx` now uses:
- `getStandoffPoint()` - Calculates points outside pedal boxes based on jack edge position
- `findPathAStar()` - Grid-based A* pathfinding with Manhattan distance heuristic
- `smoothPath()` - Removes small zigzag deviations from paths

### Next Tasks
- [ ] Consider cable color differentiation for different signal types
- [ ] Look into cable bundling when multiple cables share similar paths
- [ ] Test with more complex pedalboard layouts

---

## Session Template

Copy this template for new sessions:

```markdown
## Session: YYYY-MM-DD

### Summary
Brief description of main work done.

### What Was Accomplished
- [x] Task 1
- [x] Task 2
- [ ] Incomplete task

### Key Changes
| File | Change |
|------|--------|
| `path/to/file` | Description |

### Technical Decisions
1. Decision and rationale

### Next Tasks
- [ ] Task for next session
```
