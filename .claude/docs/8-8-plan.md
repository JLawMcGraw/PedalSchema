# What to do next (2026-08-08)

> **STATUS: A1, A2, B, C executed the same day; D closed five of ten.** Only E
> remains, and it is blocked on a human saving two photographs. See § Outcome at
> the foot of the file.
>
> Two things in this document were WRONG when written and are corrected in
> place: section B's blast radius (a failed query printed as a measured zero),
> and the roadmap's assumption that the `assignLanes` cliff was worth chasing
> (it never fires).

Successor to `8-2-next.md`, written after the knockout work closed. Same
convention as its predecessors: ordered by what it costs to be wrong, and every
claim tied to a measurement taken **while writing this file**, not to the
session log. Two of the items below changed shape once measured, and one item
the session log recorded as blocked turns out to have no blast radius at all.

Baseline, taken first so nothing below is compared against a memory:

```
vitest run          28 files, 293 pass, 1 skipped   2.69s   (Node 24.18.1)
git                 clean at c0d60fd, branch main
verify-pedal-jacks  67 catalogue / 53 confirmed / 4 unknown / 10 unresearched
                    0 contract violations
saved boards        J$ Home  9 pedals on Classic Jr 18x12.5
                    test    22 pedals on Classic Pro 32x16
```

---

## The finding that reorders the list

`complexRouting` is charged to the cables that routed **best**.

`routing-cost.ts:52` declares the penalty as *"cable needs complex routing
(channel/perimeter/A\*) instead of simple L-path"*. `routing-cost.ts:241`
implements it as `path.length > 3`. Those were the same statement before P1.5.
They are not the same statement now.

Cross-tabulating every drawn cable on both saved boards — strategy against
whether the penalty fires:

```
strategy         complexRouting verdict     count
-----------------------------------------------------
lane-router      CHARGED (>3pts)              15
lane-router      free    (<=3pts)             12
l-horizontal     CHARGED (>3pts)               4
l-vertical       CHARGED (>3pts)               1
fallback-invalid CHARGED (>3pts)               1
                                     total    33
```

**21 of 33 cables are charged, and 15 of those 21 are `lane-router`** — the
corridor loom P1.5 exists to produce. `lanes/index.ts:14-16` describes its own
output as *"tidy looms with square corners by construction"*; a corridor entry,
a run and an exit is four points before anything goes wrong.

Worse for the stated intent: **`l-horizontal` and `l-vertical` are charged
too**, five times. Those are literally the simple L-path the comment says the
penalty is *not* about. A manhattanized L with a standoff at each end is 4-5
points. Not one of the three strategies the comment names —
channel / perimeter / A\* — appears anywhere in the corpus.

So `path.length > 3` does not identify complex routing. It identifies "has more
than three points", which after P1.5 is nearly everything.

### What it is worth

Full cost decomposition of both saved boards, base against optimized:

```
J$ Home                 base        optimized
  cableLength          71.37    ->      51.52
  crossings               40    ->         16   (5 -> 2)
  spacing                  0    ->          0
  complexRouting         100    ->        100   (10 -> 10)
  routingFailures          0    ->          0
  signalFlow             168    ->          0
  rowAlignment             0    ->          0
  totalScore          379.37    ->     167.52

test                    base        optimized
  cableLength         119.19    ->     119.18
  crossings                8    ->          8   (1 -> 1)
  spacing                237    ->     235.69
  complexRouting         110    ->        110   (11 -> 11)
  routingFailures        100    ->        100   (1 -> 1)
  signalFlow               0    ->          0
  rowAlignment          49.2    ->       49.2
  totalScore          623.39    ->     622.07
```

**On J$ Home `complexRouting` is 100 of a 167.52 total — 59.7% of the score,
larger than the cable length the optimizer exists to minimise.**

And note the count column: `10 -> 10` and `11 -> 11`. **It is constant across
the optimization on both boards.** That is the reassuring half and the damning
half at once:

- *Reassuring:* a term that does not vary between candidates cannot have
  steered either of these two layouts wrong. This is not a live regression.
- *Damning:* a 10-inch-per-cable term firing on ~64% of cables, which never
  discriminates on the only two boards we can check, is not measuring anything
  we have evidence it should measure. On a board where it *does* vary, it will
  vary for reasons unrelated to routing complexity — and every score rationale
  shown to a user already attributes 60% of J$ Home's score to a dimension
  labelled "cables needing complex routing" that is counting square corners.

`COST_DIMENSIONS` (`routing-cost.ts:73-81`) is deliberately the single source of
both the score and its explanation, so that *"a rationale shown to the user
cannot describe a ranking different from the one that actually chose the
layout"*. That contract holds mechanically and is defeated semantically: the
label and the arithmetic disagree about what is being counted.

---

## A1 — DONE 2026-08-08. Charge `complexRouting` on strategy, not point count

**The prediction held exactly.** `complexRouting` 100 -> 0 on J$ Home and
110 -> 0 on `test`, and **zero non-score lines changed in the fingerprint** -
every placement and every cable path byte-identical. Each total fell by
precisely the removed penalty:

```
J$ Home   167.52 - 100 = 67.52    observed 67.52
test      622.11 - 110 = 512.11   observed 512.11
```

Nothing moved because the term was **inert** - constant at 10->10 and 11->11,
as measured before the change. It now discriminates: J$ Home reads `10 -> 0`,
one genuinely complex cable in the saved layout and none after optimizing.
A dimension that never varied between candidates now varies with layout quality,
which is what a cost term is for.

`isComplexRoute` lives in `cables/routing-strategies.ts`, next to the cascade it
partitions, and is written as the small SIMPLE set rather than its complement so
a future rung defaults to CHARGED - new rungs get added at the desperate end.
`fallback-invalid` is deliberately excluded: `routingFailures` already charges
it twice `CABLE_COLLISION_PENALTY_INCHES`, and one defect should not appear as
two dimensions in a score that is meant to add up.

Gates: 306 tests (+13), tsc clean, config-matrix 66/66 by trial ID,
`verify-optimize.js` PASSES in the browser (mandatory - all three changed files
are in the worker's import graph).

### Original analysis

`rp.strategy` is already in scope one line below the penalty
(`routing-cost.ts:252` pushes it into `cableDetails`). The router reports what
it actually did; the cost function ignores that and counts vertices.

**Shape of the fix.** Replace `path.length > 3` with a predicate over
`RoutingStrategy`. `lane-router` and the two L strategies are the healthy
outcomes and should be free. `channel`, `perimeter` and the A\* rungs are the
genuinely complex ones. `fallback-invalid` is already charged far more heavily
by `routingFailures` (50 × 2 inches) and should not be double-counted here.

**Do NOT simply raise or lower `COMPLEX_ROUTING_PENALTY_INCHES`.** The constant
is not the defect; the predicate is. Retuning a weight to compensate for a
mis-specified term is precisely the mistake `8-2-next.md` recorded twice (the
crossing-penalty sweep that changed nothing, and the cliff hypothesis that
recovered 1.10in of 18.65in).

**Expected effect, stated before the change so it can be falsified:** both
saved boards' `complexRouting` should fall to **0** — no cable on either board
uses channel, perimeter or A\*. `8-2-next.md` independently recorded the same
thing from the other side: across every config-matrix fixture the tally is
`lane-router 68, l-horizontal 3, channel 3`. So expect config-matrix to retain
a small non-zero count (the 3 channel cables) where the saved boards go to
zero. If the saved boards do *not* go to zero, the strategy predicate is wrong
and the change should not land.

**Verification.**
1. Fingerprint before/after. `cableLength`, `crossings`, `spacing`,
   `signalFlow`, `rowAlignment` must be **byte-identical**; only
   `complexRouting` and `totalScore` may move.
2. If any *placement* moves, that is the interesting case and must be
   explained, not accepted — it means the term was discriminating after all and
   we have found the board where it mattered.
3. `config-matrix` compared **by trial ID**, not by count. The straddler lesson
   (165 fixed / 146 broken reading as a net improvement) is the standing reason.
4. `router-parity.test.ts` must stay green.
5. Browser gate: `routing-cost.ts` is inside the worker's import graph, so
   `node .claude/scripts/verify-optimize.js` is mandatory per the P0 standing
   instruction in `8-2-next.md`.
6. A unit test pinning the new predicate per strategy, mutation-checked — flip
   one strategy's verdict and confirm a test fails.

---

## A2 — DONE 2026-08-08. And the cliff turns out never to fire

`LaneRouteResult` now carries per-cable `outcomes` and per-corridor `pressure`;
`RoutedPath` carries `laneOutcome`, so the reason travels with the cable to the
renderer and the fingerprint. Fingerprint geometry byte-identical - purely
additive, as predicted.

**First measurement, and it answers the question the session log had been
asking since 8/2:**

| board | lane-routed | shortcut | unattached | **evicted** |
|---|---|---|---|---|
| J$ Home | 8 | 2 | 0 | **0** |
| test | 4 | 13 | 6 | **0** |

**The `assignLanes` cliff fires zero times on both saved boards.** Every
fallback on `test` is `unattached` - endpoints whose standoff attaches to no
corridor - not capacity. So the 8/2 per-corridor fix is holding, and any future
work on fallbacks should target corridor ATTACHMENT rather than lane capacity.
That is the opposite of where the roadmap was pointing.

The tally reconciles exactly with the independent strategy counts, which is what
proves the instrument rather than just running it:

```
lane-routed 12 + shortcut 15 = 27 = the 'lane-router' strategy count
unattached 6 = l-horizontal 4 + l-vertical 1 + fallback-invalid 1
```

That reconciliation is now a permanent assertion. `lane-router.test.ts` had a
self-described *"conservative proxy"* - count the cables whose path differs from
the no-lane run - because nothing recorded which router served a cable. It
counts exactly now and asserts strategy and outcome agree, so if they ever
disagree one of them is lying and every count built on either is wrong.

### Original analysis

The session log carries this as *"the `assignLanes` cliff is fixed but never
instrumented"*. Reading the code, it is worse than un-counted: three distinct
failures are indistinguishable downstream.

`routeCablesWithLanes` returns `LaneRouteResult = { paths }` and nothing else
(`lanes/index.ts:82-85`, `:568`). A `null` in that array means one of:

| cause | where | meaning |
|---|---|---|
| never planned | corridor sequence not found | endpoints unreachable through the graph |
| **evicted** | `assignLanes` returns it (`:489`) | corridor genuinely over capacity — the cliff |
| validation failure | `isPathClear` fails (`:563-565`) | a lane was seated but the geometry hits a pedal |

`assignLanes` **already computes the eviction set** — the per-corridor
degradation from 8/2 returns `Set<number>` and its docstring says
*"@returns cable indices that could not be seated and must fall back"*. Line
489 receives it, uses it to skip realization, and then discards it. Nothing
above that line can ever count an eviction.

Downstream, all three collapse further: `route-cables.ts:318-346` sees only
`lanePath === null` and records whichever fallback rung succeeded. So the
strategy tally *can* tell you a cable fell back — that is how the table at the
top of this file was built — but it cannot tell you **why**, and "the cliff
fired" is exactly the why that matters.

**Shape of the fix.** Widen `LaneRouteResult` with a diagnostic alongside
`paths` — per-cable reason, plus a per-corridor over-capacity tally. Purely
additive; existing callers destructure `{ paths }` and keep working.

**Do this before A1, not after.** It is the instrument A1's verification wants:
"complexRouting went to zero" is a much weaker claim than "complexRouting went
to zero and the reason tally shows no cable fell back at all". Build the gauge,
then turn the dial.

**Verification.** Fingerprint must be byte-identical — this adds a return field
and changes no geometry. Emit the reason tally into the fingerprint alongside
the existing `DRAWN CABLES` block. On the current corpus, expect **1** cable
with a fallback reason (the single `fallback-invalid` on `test`) and 0
evictions; if evictions are non-zero on a board that renders fine, that is a
finding worth its own entry.

---

## B — Strymon dimensions: DONE 2026-08-08, and it did move a board

Owner's call taken 2026-08-08: **correct to the published spec.** Applied.

**Read the measurement failure below before trusting any query in this file.**

I first reported the blast radius as zero:

```
configuration_pedals rows referencing Timeline or BigSky:  0
```

**That number was wrong, and it was wrong in the most embarrassing way
available in this codebase.** The query selected
`position_x, position_y, rotation` — columns that do not exist; they are
`x_inches, y_inches, rotation_degrees`. PostgREST returned an *error*, the
script destructured `{ data: rows }` without checking `error`, and printed
`rows?.length ?? 0`.

So a **failed query rendered as a measured zero**. That is exactly the tri-state
trap this project already has written down twice — `currentMa` null is not 0,
and *"a `?? 0` anywhere in the total turns 'we do not know' into 'free'"*. The
rule was known, recorded, and applied to the product code; I then built the same
bug into the instrument I was using to check the product code.

The truth, from the same query with correct column names:

```
configuration_pedals rows referencing Timeline or BigSky:  2
  both on "test" (22 pedals, Classic Pro 32x16)
J$ Home:  no Strymon - genuinely unaffected
```

**What caught it was the fingerprint gate, not a better query.** The plan said
byte-identical was expected and that any movement "must be explained, not
accepted". It moved 44 lines, and chasing that is the only reason the bad
measurement surfaced at all. A gate whose prediction you are willing to have
falsified is worth more than the confidence you had going in.

### What the correction actually cost

All movement is on `test`; every displaced pedal moved by exactly **0.25in**,
the width delta propagating through the packed run.

```
                    SAVED layout (BASE)        after Optimize
  totalScore        623.39 -> 758.88           622.07 -> 622.11
  spacing              237 -> 274.13           235.69 -> 235.69
  routingFailures      100 -> 200              100 -> 100
                     (1 -> 2 cables)           (1 cable, unchanged)
  cableLength       119.19 -> 117.56           119.18 -> 119.22
```

Two pedals genuinely got 0.25in wider, so the **saved** `test` layout is now
more crowded and has one more cable that cannot route cleanly. **Re-running
Optimize fully recovers it** — 622.11 against 622.07, a difference of 0.04.

So the cost is real but bounded and self-healing: the `test` board will look
slightly worse until someone hits Optimize on it, at which point it is as good
as it ever was. That is the trade the owner accepted when they chose the
published spec over the stored one.

**The session log also understated the error.** Fetched from strymon.net today,
both products carry identical wording:

> "6.75" wide (17.15 cm) x 5.1" deep (12.95 cm) x 2.7" tall (6.86 cm)"

against the catalogue's `6.5 x 5.1 x 1.6`. So depth is right, width is 0.25in
short — and **height is 1.1in short, an error two-thirds larger than the one
that was noticed.** Height is display-only in the engine (`properties-panel`,
`pedal-card`), so it changes no layout, but it is wrong on screen today.

Current draw (300mA) and voltage (9V) both already match the page.

**Work.**
1. Set both rows to `width_inches 6.75`, `height_inches 2.7`.
2. Write the source into `notes`, matching the Flint's existing pattern — the
   table has provenance columns for images and jacks but **none for
   measurements**, and `notes` is where that gap is currently papered over.
   Both Strymon rows have `notes: null` today, which is why this drifted
   unnoticed.
3. **Update the stale comment.** `rotation-eligibility.ts:69` documents the
   catalogue's width bands as `... 4.8, 5.5, 5.79, 6.5, 6.69, 10.04`, and
   justifies `MAX_ROTATABLE_WIDTH_INCHES = 4.5` by those bands being empty
   around the threshold. Moving 6.5 to 6.75 makes that list wrong. The
   *conclusion* is unaffected — 6.75 > 4.5, so both stay locked by default,
   which is the intended behaviour for a 6.75in reverb — but a comment that
   says "these are placed in the EMPTY BANDS of the real catalogue" and then
   lists a value the catalogue no longer has is how a justification rots.

**Verification — done, results above.** Rows re-read and asserted against the
published spec rather than merely "changed"; `isLargePedal` confirmed still
true for both, so rotation stays locked by default as intended; fingerprint
diffed, movement isolated to `test` and explained as the 0.25in width delta.
J$ Home is byte-identical.

**Still open from this item:** the `test` board should be re-Optimized so its
saved layout stops carrying the extra unroutable cable. That is a click in the
app, not a code change, and it is the owner's to make — Optimize overwrites a
hand-arranged board.

---

## C — DONE 2026-08-08. Deleted `mode:'outline'`

The branch, `OUTLINE_CORNER_MARGIN`, and the option wiring are gone; the prose
explaining *why* it failed stays, because that is the part with value.
`detectOutlineRect` stays too - `rect` uses it, and it is what fixed Timeline.

Verified with `knockout-regression.js`, which re-runs the pipeline over every
pedal's origin image and writes nothing: **64 pedals, none moved**, before and
after. Exactly as predicted for a path nothing was using.

### Original analysis

Confirmed dead, not assumed dead. `PEDAL_OVERRIDES`
(`scraper/mirror-pedal-images.js:168`) contains exactly three entries:

```
'Electro-Harmonix Big Muff Pi'   { mode: 'skip' }
'Electro-Harmonix Small Clone'   { mode: 'skip' }
'Strymon Timeline'               { mode: 'rect' }
```

Nothing selects `'outline'`. The implementation survives at `:885-899` and
`:1124`, and the reason it failed is already written up in prose at `:189` —
*"`close` is the right tool and `mode:'outline'` was NOT. Outline restores
[everything inside the outline]"*, which squared off the DD-7's tapering sides
and turned x=22..60 solid white.

**The prose is the part worth keeping; the code is not.** Delete the branch and
the `outline:` option, leave the failure narrative in place.

**Verification.** Re-run the mirror pipeline and diff the alpha fingerprint —
all 64 pedals must be byte-identical, because nothing was using the path.
`knockout-regression.js` exists for exactly this and writes nothing.

---

## D — Jack layouts: DONE for five of ten, 2026-08-08

Outstanding **10 -> 5**, confirmed 53 -> 58, contract violations still 0.

The manuals remain a dead end and this re-confirmed it rather than assuming it:
the M101 PDF names INPUT and OUTPUT and never says which side, exactly as
recorded on 2026-07-31. This environment also has no PDF renderer, so a
diagram-only manual cannot even be looked at.

**What worked was inverting the source hierarchy.** A manufacturer's TOP-DOWN
product photograph is *better* evidence than a manual's rear-panel drawing, for
the reason the file's own readme gives: the drawing is seen from behind the
pedal, so its left and right are flipped. A top-down photograph cannot be
flipped, and these enclosures are silkscreened or moulded with the jack names
beside the barrels. 8/1 recorded "a product photo is jack research" as a
by-product; this applied it deliberately.

```
MXR Phase 90 / Dyna Comp / Carbon Copy   OUTPUT left, INPUT right
Dunlop Cry Baby GCB95                    AMPLIFIER left, INSTRUMENT right
Dunlop Fuzz Face                         IN and OUT both on the REAR edge
```

**The Fuzz Face is why this was worth doing.** It contradicts the default
assumption twice: both jacks on the rear edge rather than the sides, and the
lateral order reversed - IN left of centre, OUT right - where every compact in
the catalogue has input right and output left. The fallback would have been
wrong about the edge and then wrong about the side. It is now the 12th rotation
candidate, though at 5.5in wide it arrives rotation-locked by default.

**The Cry Baby needed two sources and would have been a guess with one.** Its
side walls are moulded AMPLIFIER and INSTRUMENT, but telling a treadle's toe
from its heel in a top-down photo is exactly the spatial call that gets made
backwards - and backwards here means a mirrored entry, the failure the whole
file is built to avoid. Dunlop's GCB95 documentation independently places
output left and input right, fixing the orientation without relying on that
judgement.

DC jacks are omitted throughout rather than guessed: they sit on rear edges a
top-down photograph does not show. A missing row is a smaller lie than an
invented edge.

Fingerprint byte-identical - **verified, not assumed**, after section B's
lesson. None of the five is on either saved board.

### The five still outstanding, and why each is stuck

| pedal | blocker |
|---|---|
| Big Muff Pi | no photograph at all (also item E) |
| Small Clone | no photograph at all (also item E) |
| Klon Centaur | no photograph; licence-blocked besides |
| Pro Co RAT 2 | has a top-down photo, but **it shows no jacks and no labels** |
| Holy Grail | its adopted photo is a **HOLY GRAIL NEO** - see below |

### A data problem found while doing this: the Holy Grail row

The head-on photograph adopted on 8/3 is captioned **HOLY GRAIL NEO**, which is
a different product from the catalogue's "Holy Grail". So its jack layout is not
this row's to borrow, and the entry was left unresearched rather than filled
from the wrong pedal.

The dimensions look wrong too. Published figures put the original at ~2.75 x
4.75in and the Neo at ~2.76 x 4.53in; **the catalogue says 3.5 x 4.7**, matching
neither - and the width is off by three quarters of an inch, three times the
Strymon error corrected in section B.

Not acted on, deliberately: unlike the Strymons, where strymon.net publishes an
unambiguous figure on the product page, these numbers come from secondary
sources. It needs an ehx.com specification and a decision about which product
the row is meant to be. **Recorded here rather than fixed** - and note this is
the second dimension error found in two days by looking at something else,
which is an argument for the measurement-provenance column the pedals table
does not have.

## D (original scope) — Ten jack layouts (research, unblocked, parallelizable)

```
catalogue            67
confirmed            53
researched, unknown   4   (BOSS multi-FX - genuinely undetermined, leave them)
NOT researched       10
contract violations   0
```

Outstanding: Cry Baby GCB95, Fuzz Face, Big Muff Pi, Holy Grail, Small Clone,
Klon Centaur, Carbon Copy, Dyna Comp, Phase 90, RAT 2.

Down from 13 — TS9, Ditto Looper and Polytune 3 were closed since that list was
written. **All ten now carry no jack rows at all**, so none is claiming
knowledge it lacks; each falls back to the documented default and draws its
jacks hollow. That is the honest state, so this is an enhancement rather than a
correctness item.

Workflow unchanged: edit `scraper/pedal_jacks.json`, `DRY_RUN=1 node
scraper/import-pedal-jacks.js` before the real run, a source URL per jack.
Never invent a layout — leaving a pedal unresearched is strictly better, and is
the whole reason migration `20260801000004` had to delete 13 pedals' worth of
fabricated rows.

Two angles from `8-2-next.md` still untried: the Klon and Fuzz Face are heavily
photographed by collectors, and Cry Baby / RAT 2 / Phase 90 are current
production whose printed manuals may carry mechanical drawings even where the
text does not.

**A product photo is jack research** — four pedals' worth of layout came out of
images fetched for a different purpose on 8/1. Item E may close part of D for
free.

---

## E — Photos for Big Muff Pi and Small Clone (blocked on a human)

Both are `mode: 'skip'`, and both need a **head-on** source neither vendor
publishes: EHX shoot the range at three-quarters, and Andertons' Small Clone
shows the side face. Holy Grail was solved this way on 8/3 (Andertons, pinned)
— so the route works, there is just no qualifying image.

**Sweetwater cannot be scraped**: 403 to a plain fetch, and a human-verification
interstitial to a real Chromium. This is not worth another attempt.

**No automated gate can judge head-on vs side-on**, and this was tested rather
than assumed: the footprint gate passed the side-on Small Clone at 0.99x, and a
fill/edge-straightness heuristic scored the angled Big Muff at fill 93%,
topSlope 1.4%. Both would ship a wrong photo. This one needs an eye.

**Handoff — the only thing that unblocks it:** save one head-on top-down image
per pedal by hand and put it through `/pedals/new`. Record where it came from;
the licence matters, because the knockout creates a derivative (CC BY or PD
fine, **avoid CC BY-SA** — the recorded Klon trap).

Until then both stay `skip`, which is the correct state: a rect is honest, a
knocked-out three-quarter photo is not.

---

## F — Deliberately not doing

- **Holy Grail 1.6% stray, RV-200 2.1%.** Real, measured, minor. Below the
  threshold where a per-photo escape hatch earns its complexity. The hatches
  already number six (`skip`, `rect`, `outline`→deleted, `close`, `strict`,
  `bgTol`, `edgeTrim`) and each one is a maintenance cost.
- **Klon stays a rect.** Licence, not technique.
- **Marshall JCM2000 DSL photo.** Commons is exhausted and the licence was never
  the problem — the photos were.
- **A general fix for neutral-pedal-on-neutral-backdrop.** Established on 8/3
  that all three local channels (colour, brightness, gradient) are blind on it
  and that there is no principled general answer short of real matting (trimap
  or learned alpha). Per-photo settings are the right answer at this scale.

---

## Suggested order

1. **A2** — build the eviction/reason instrument. Additive, fingerprint-neutral,
   and it is the gauge A1's verification needs.
2. **A1** — fix the `complexRouting` predicate, with A2 watching. Browser-verify:
   it is in the worker's import graph.
3. **B** — Strymon correction. Independent of everything, zero blast radius,
   already decided.
4. **C** — delete `mode:'outline'`. Independent, scraper-only, no engine risk.
5. **D** — jack research. Parallelizable against all of the above; needs no
   vitest and touches no engine code.
6. **E** — blocked on the handoff above. Nothing to do until an image exists.

A1+A2 are one coherent piece of work and should land together. B and C are
independent and can go in any order around them.

---

## What this list assumes

Everything above rests on **two saved boards**, which proves "did not change the
real boards" and never "is better in general". For the general claim use
`config-matrix`, which sweeps boards × pedal sets × configuration combinations
and already asserts `laneViolations` empty, determinism and idempotence.

The two-board corpus is thin enough that A1's central measurement — that
`complexRouting` is *constant* across optimization — may simply not generalise.
That is an argument for A2 first, not for skipping A1.

Reproducing the baseline:

```
node .claude/scripts/dump-configs-offline.js <out>
PEDAL_CONFIG_DUMP=<out> PEDAL_FINGERPRINT_OUT=<fp> npx vitest run saved-board-fingerprint
```

And the one that runs nothing in Node — needs `npm run dev` up:

```
node .claude/scripts/verify-optimize.js
```

---

## Outcome — 2026-08-08

A1, A2, B and C landed; D closed five of ten. Suite **306 green** (from 293),
tsc clean, config-matrix 66/66 by trial ID, browser gate passing, knockout
regression 64/64 unmoved.

### The two things this document got wrong

**1. Section B's blast radius.** Reported as zero affected rows; it was two, and
both Strymons are on the `test` board. The query selected columns that do not
exist, `error` went unchecked, and `rows?.length ?? 0` printed a failed query as
a measured zero — the same null-is-not-zero trap the power budget documents for
`currentMa`, built into the instrument instead of the product. **The fingerprint
gate caught it by predicting byte-identical and being allowed to be wrong.**

**2. The cliff was the wrong thing to be worried about.** The roadmap had
carried "instrument the `assignLanes` cliff" since 8/2 on the premise that
uncounted evictions were a latent risk. Instrumented, the count is **zero on
both saved boards**, and every fallback on `test` is `unattached` — an endpoint
that reaches no corridor at all. The 8/2 per-corridor fix is holding. Future
work on fallbacks belongs at corridor ATTACHMENT, not lane capacity.

### The pattern across both

Both were resolved by building the measurement *before* trusting the belief, and
in both cases the measurement contradicted a plausible story that had been
sitting unchallenged for a week. Note also that A1's whole finding —
`complexRouting` charging the corridor loom — existed only because P1.5 changed
what "more than three points" means, and nothing re-derived the proxy afterwards.
**A proxy is a claim about the world at the moment it is written.**

### Cheapest available follow-ups

- **The Holy Grail row** carries a photo of a different product (Neo) and a width
  that matches neither variant. Needs an ehx.com specification and a decision
  about which product the row is. See § D.
- **The `test` board wants re-Optimizing** so its saved layout drops the extra
  unroutable cable the Strymon correction introduced. A click, and the owner's
  to make.
- **A measurement-provenance column.** Two dimension errors surfaced in two days,
  both while looking at something else, both in rows whose `notes` were null.
  The table has provenance for images and for jacks and none for measurements.
