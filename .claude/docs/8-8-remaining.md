# What is left (2026-08-08, after executing 8-8-plan.md)

Successor to `8-8-plan.md`, which closed A1, A2, B, C and five of D's ten. Same
convention: ordered by what it costs to be wrong, every claim tied to a
measurement taken **while writing this file**.

The list is shorter and its centre of gravity has moved. `8-8-plan.md` was about
a cost function that was lying; what remains is one **visible defect on a real
board**, two **data rows that are wrong**, and three items that are genuinely
blocked on a person rather than on work.

Baseline:

```
vitest              306 pass, 1 skipped        tsc clean, eslint src 0 errors
config-matrix       66/66 by trial ID          knockout-regression 64/64 unmoved
verify-optimize     PASS in the browser
jacks               58 confirmed, 5 unresearched, 0 contract violations
saved boards        J$ Home 9 on Classic Jr    test 22 on Classic Pro
```

---

## R1 — One cable is drawn red on the `test` board

**The only user-visible defect left, and the only correctness item on this
list.** Everything else is data or is blocked.

```
fallback-invalid  valid=false  4pts  (744,269) (734,269) (1220,-10) (1220,0)
```

That is a **diagonal across the whole board**, drawn red, passing through
whatever lies between. `routingFailures` charges it 100 - and on `test` that is
the entire routingFailures term.

### What is established

**Both endpoints are identified.**

| end | pixel | what it is |
|---|---|---|
| from | (744,269), standoff (734,269) | chain 12, at x=18.61in y=5.62in - an OUTPUT on its **left** edge |
| to | (1220,0), standoff (1220,-10) | **EQ-200** input @62% of its **rear** edge, pedal flush at y=0 |

The `to` end arithmetic is exact: EQ-200 sits at x=28.02in and is 3.98in wide,
so 62% along its top edge is `(28.02 + 0.62 x 3.98) x 40 = 1219.5px`, against
the 1220 in the path.

**Optimize cannot fix it.** `routingFailures` goes `200 -> 100` (2 cables -> 1)
and EQ-200 stays at y=0 in the optimized layout. The search halves the problem
and then cannot remove it. So this is structural, not a search failure - which
distinguishes it from the 8/2 cable-length regression, where scoring the old
layout with the new function exposed a search defect in five minutes.

**It predates today's work.** Before the Strymon correction the optimized
`routingFailures` on `test` was already `100 -> 100`, one cable. The Strymon
change made the *saved* layout worse (2 cables) and left the optimized count
unchanged. Not a regression from anything in `8-8-plan.md`.

### What is NOT established, and the false trail worth recording

The obvious hypothesis was: **EQ-200 sits flush at y=0 with all four signal
jacks on its rear edge, so its standoffs project to y=-10, outside the board,
where there is no corridor.** Eight signal jacks across Timeline and EQ-200 do
exactly that.

**It is wrong, and reading `attachCorridor` is what killed it.** The corridor
model deliberately extends past the board:

```
lanes/index.ts:167-168   spanLo = minX - OVERHANG,  spanHi = maxX + OVERHANG
lanes/index.ts:181       first horizontal corridor: lo = minY - 40,  hi = bands[0].top - OBSTACLE_MARGIN
```

With `bands[0].top = 0`, that corridor is `y in [-40, -8]`, and the standoff at
`y=-10` sits inside it; `x=1220` is inside the span. Both `inPerp` and `inSpan`
hold, so the EQ-200 end **attaches**. The same reading says the `from` end
should attach too: the gap between the pedal at x=11.25in and the one at
x=18.61in leaves a usable vertical corridor about 8px wide, and the standoff at
x=734 falls in it.

So on a first reading **both ends should attach and the cable should route** -
and it does not. That is the gap between what the code appears to say and what
it does, which is where the actual bug is.

**Do not fix this by guessing.** Two prior sessions record what that costs: the
cable-length regression was blamed on the assignLanes cliff and then on
CROSSING_PENALTY_INCHES, and both were wrong. Instrument first - which is R2.

### Shape of the work

1. **R2 first** (below) so the failing endpoint names itself.
2. Then follow whichever end fails. Two candidate mechanisms, both testable:
   - *Attachment*: `attachCorridor` returns -1 for a stub that should qualify -
     an off-by-one in `inPerp`/`inSpan`, or `bands[0].top` not being 0 because a
     band absorbed a neighbouring row (`:156` merges any box that overlaps a
     band, so one deep pedal can swallow two rows).
   - *Realization*: it attaches, gets a lane, and then fails `isPathClear` at
     `:563` - which would report `validation-failed`, not `unattached`. R2
     distinguishes these without any further argument.
3. Only then decide between a routing fix and a placement fix.

### The placement question underneath it, worth separating

Even once routed, **a pedal with rear-edge jacks flush against the back rail has
nowhere for a plug to go** - physically, not just in the model. A straight jack
plug needs roughly an inch behind the pedal. The placer does not know this:
`deriveRowBands` reasons about pedal depth and corridors, not about what a jack
on the rear edge demands behind it.

That affects EQ-200, Timeline, BigSky and the Fuzz Face (newly confirmed with
rear-edge jacks in D). **This is a separate item from R1 and should not be
smuggled into it** - R1 is "the router draws a red diagonal", this is "the
layout is physically unbuildable". Fixing the second might mask the first
without anyone learning what the first was.

**Verification for R1.** Fingerprint before/after; `routingFailures` on `test`
must reach 0 with `cableLength` not blowing out to compensate. `config-matrix`
66/66 by trial ID. Browser gate - `lanes/` is in the worker's import graph. And
a fixture pinning this exact geometry, so it cannot silently come back.

---

## R2 — Say WHICH endpoint failed to attach

Cheap, additive, and it is the instrument R1 needs. Roughly ten lines on top of
what `8-8-plan.md` already built.

`LaneOutcome` currently reports `unattached` for the cable. It does not say
whether the `from` stub, the `to` stub, or both failed - and
`routeCablesWithLanes:452-457` throws that away immediately:

```ts
const startC = attachCorridor(corridors, fromStub);
const goalC  = attachCorridor(corridors, toStub);
if (startC < 0 || goalC < 0) { planned.push(null); outcomes[index] = 'unattached'; return; }
```

**Why it matters now rather than in general.** On `test` there are 6
`unattached` cables, and at least three have both endpoints comfortably inside
the board - so "the standoff is off-board" cannot be the whole story, and
without knowing which end failed there is nothing to look at but the whole
corridor builder.

**Shape.** Carry the failing side on the outcome (`unattached-from`,
`unattached-to`, `unattached-both`, or a detail field alongside). Emit it in the
fingerprint's `LANE OUTCOMES` block, which already exists.

**Verification.** Fingerprint geometry byte-identical - this changes no
routing. The reconciliation assertion in `lane-router.test.ts` must stay green:
strategy `lane-router` iff the outcome is a corridor success, whatever new
spellings the failure cases acquire.

---

## R3 — The Holy Grail row is wrong twice

Found while doing D. Not acted on then, because unlike the Strymons - where
strymon.net publishes an unambiguous figure on the product page - these numbers
came from secondary sources.

**Its adopted photograph is a different product.** The head-on image taken on
8/3 is captioned **HOLY GRAIL NEO**. That is why D left this pedal's jacks
unresearched rather than reading them off the photo: borrowing the Neo's layout
for a row that is not a Neo is the revision mismatch the jacks readme rejects
manuals for.

**Its width matches neither variant.**

```
catalogue          3.5  x 4.7 in
original           ~2.75 x 4.75   (secondary sources)
Holy Grail Neo     ~2.76 x 4.53   (70 x 115 mm)
```

0.75in too wide - **three times the Strymon error**, and width is the dimension
that packs a row.

**Work, in order.** Decide which product the row is meant to be; get an ehx.com
specification for it; correct the dimensions the way B did, with the source in
`notes` and a fingerprint diff. Then re-adopt a photograph of the right product,
and only then read its jacks off that photograph.

**Check the blast radius properly this time** - `configuration_pedals` with the
correct column names (`x_inches`, `y_inches`, `rotation_degrees`), and check
`error`, not just `data`. See § B of `8-8-plan.md` for what that mistake looked
like.

---

## R4 — The pedals table has no provenance for measurements

**Two dimension errors surfaced in two days, both while looking at something
else, both in rows whose `notes` were null.** That is the finding; the column is
just the response to it.

```
image_source_url / image_license / image_fetched_at    provenance for photos
jacks_source_url / jacks_verified_at / jacks_confidence provenance for jacks
(nothing)                                               provenance for size
```

Dimensions decide packing, row derivation and rotation eligibility, and they are
the one attribute with no way to ask "who said so?". The Flint papers over it by
putting its source in free-text `notes`, which B then copied for the Strymons
because it was the only pattern available.

**Shape.** `dimensions_source_url` and `dimensions_verified_at`, mirroring the
jacks contract, plus a verifier in the style of `verify-pedal-jacks.js` that
reports how much of the catalogue can be attributed. Backfill only what a real
source supports - the lesson of migration `20260801000004` is that an
unattributable value written as fact outranks the fallback it came from.

**Do not backfill from `notes` by parsing it.** Three rows have a URL in there;
the rest would be invented.

---

## R5 — Photographs for Big Muff Pi and Small Clone *(blocked on a person)*

Unchanged, and the only true blocker on the list. Both are `mode: 'skip'` and
both need a **head-on** source that neither vendor publishes: EHX shoot the
range at three-quarters, Andertons' Small Clone shows the side face.

- **Sweetwater cannot be scraped.** 403 to a plain fetch, human-verification
  interstitial to a real Chromium. Not worth another attempt.
- **No automated gate can judge head-on vs side-on**, and this was tested, not
  assumed: the footprint gate passed the side-on Small Clone at 0.99x, and a
  fill/edge-straightness heuristic scored the angled Big Muff at fill 93%,
  topSlope 1.4%.

**The handoff:** save one head-on top-down image per pedal by hand and put it
through `/pedals/new`. Record where it came from - the knockout creates a
derivative, so CC BY or PD is fine and **CC BY-SA is not** (the recorded Klon
trap).

Closing this also closes two of R6's five, since both pedals need a photograph
before their jacks can be read.

---

## R6 — Five jack layouts, and why each is stuck

| pedal | blocker | route if any |
|---|---|---|
| Big Muff Pi | no photograph | R5 |
| Small Clone | no photograph | R5 |
| Holy Grail | photograph is of a Neo | R3 |
| Pro Co RAT 2 | has a top-down photo; **it shows no jacks and no labels** | another photo, or owner inspection |
| Klon Centaur | no photograph; licence-blocked besides | owner inspection only |

All five carry **no jack rows at all**, so none claims knowledge it lacks - each
falls back to the documented assumption and draws its jacks hollow. This is an
enhancement, not a correctness item, and it should stay that way: leaving a
pedal unresearched is strictly better than guessing, which is what migration
`20260801000004` had to undo for thirteen pedals.

**The route that has actually been working is owner inspection** - it closed
four pedals on 8/1 and is better evidence than a manual, since it cannot be a
different revision and cannot be mirrored. If any of these five is in the room,
that is one message rather than an afternoon of searching.

---

## R7 — Re-Optimize the `test` board *(owner's click)*

The Strymon correction left its **saved** layout carrying an extra unroutable
cable: `623.39 -> 758.88`, `routingFailures` 100 -> 200. Optimize recovers it to
`622.11` against a pre-correction `622.07`.

Not done here because **Optimize overwrites a hand-arranged board**, which is
the owner's call and not a gate's.

**Note what it does and does not fix:** it takes `routingFailures` from 2 cables
to 1. **The R1 red cable survives it.** Re-optimizing is worth doing and is not
a fix for R1.

---

## Deliberately not on this list

- **Holy Grail 1.6% stray, RV-200 2.1%.** Real, measured, minor. Below the
  threshold where another per-photo escape hatch earns its complexity - and
  after C deleted `outline` the hatches are back to five, which is the right
  direction.
- **Klon stays a rect.** Licence, not technique.
- **Marshall JCM2000 DSL photo.** Commons is exhausted; the licence was never
  the problem, the photographs were.
- **A general fix for neutral-pedal-on-neutral-backdrop.** Established 8/3 that
  all three local channels are blind and the answer is real matting, not another
  constant.
- **Chasing lane capacity.** `8-8-plan.md`'s A2 measured the `assignLanes` cliff
  at **zero evictions on both saved boards**. The roadmap pointed here for six
  days; the measurement says fallback work belongs at corridor ATTACHMENT, which
  is R1/R2.

---

## Suggested order

1. **R2** — ten lines, additive, fingerprint-neutral. Build it first; R1 is
   guesswork without it.
2. **R1** — the only visible defect. Follow the instrument, do not theorise.
   Keep the placement question separate.
3. **R3** — needs one manufacturer page and one decision, then it is B again.
4. **R4** — the schema response to R3 and B both being findable only by accident.
5. **R5** — whenever the two photographs exist. Unblocks two of R6.
6. **R6** — opportunistic; ask the owner before searching.
7. **R7** — a click, anytime.

R1+R2 are one piece of work. R3+R4 are another. Everything else is independent.

---

## What this list assumes

Still two saved boards, which proves "did not change the real boards" and never
"is better in general" - use `config-matrix` for the general claim.

R1 in particular rests on a **single cable on a single board**, and that is now
checked rather than left as a caveat: `lane-router.test.ts:66` asserts
`withLanes.every(rc => rc.valid)` across all 8 board x pedal-set x flag
combinations, **and it passes**. So no synthetic fixture reproduces this - it is
`test`'s geometry specifically.

Two consequences, and they pull in opposite directions:

- **It is not urgent in general.** One cable, one board, no fixture, and the
  board is a test board rather than the owner's own. R3 and R4 arguably matter
  more to anyone but this board's owner.
- **It has no regression test and cannot get one from the existing corpus.**
  Whatever fixture R1 builds will be the only thing standing between this and a
  silent return, so build it from the real geometry - dump `test`'s placements
  and pin them - rather than from a synthetic board that does not reproduce it.

That also means the honest first question for R1 is not "how do we fix it" but
**"is this board arrangement legal at all?"** - three rows of ~5.1in pedals on a
16in board is the phase-6 full-board case, where the answer was that the router
was right to refuse and the fix was to route around the outside. `perimeter`
sits last in the cascade and is not being reached here; finding out why may
close R1 without touching corridor attachment at all.
