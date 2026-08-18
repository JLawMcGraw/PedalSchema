# What to do next (2026-08-18)

Rewritten from the 2026-08-01 version, which had gone stale in the worst way:
**four of its items were already done and it was still being read as current.**
It cost this session two wrong claims - P1.5 was announced as "the oldest real
defect left" when the 8/02 work had closed it, and P5 was described as a trap
waiting to catch someone when the function it names has no production callers.
Reading a roadmap instead of the code is how both happened.

So: every item below was checked against the code on 2026-08-18, and every
claim is quoted with the measurement that supports it. Ordered by what it costs
to be wrong, not by what is fun to build.

**If you are about to act on an item here, check it first.** This file is a
starting point, not a source of truth.

---

## Closed since the last version

Kept as a list rather than deleted, because "is this done?" is exactly the
question that wasted time this session.

| Item | Closed | Evidence to re-check with |
|---|---|---|
| P0 jack data invented for 13 pedals | 2026-08-01 | `verify-pedal-jacks.js` reports 0 contract violations |
| P0b loop hub members placed beside their hub | 2026-08-01 | `config-matrix` ns2loop scenarios |
| P1 power budget, both halves | 2026-08-02 | `power_supplies` migration, `SupplyPlan` in `derived.ts`, per-output loads in `power-panel.tsx` |
| P1.5 cost model vs drawn routing | 2026-08-02 | `routing-cost.ts:238` calls `routeCablePaths`; `router-parity.test.ts` gates it |
| P2 say WHY a board will not fit | — | `explainFit` in `routing-cost.ts`, `fit-explanation.test.ts`, surfaced by `optimization-summary.tsx` |
| P3 show a perimeter cable as what it is | 2026-08-10 | dashed stroke + "Around the board" legend row in `explain.ts` |
| P5 `calculateGreedyPlacement`'s muddy contract | 2026-08-18 | it has NO production callers; guard asserted in `placement-degraded.test.ts` |

---

## R1 — Two red cables on `test` need the owner, not the engine

Diagnosed 2026-08-18 and **there is nothing to fix in code**, which is why it
sits at the top: the next person to look will otherwise re-diagnose it.

BigSky carries both jacks on its TOP edge, so both its cables want the one
corridor between rows 1 and 2:

    row 1 bottom          203.2
    BigSky top            218.0
    raw corridor           14.8px
    usable after margins    2.8px
    LANE_SPACING            12px

One run fits. Three other cables already use it, so BigSky's two are `evicted`
and drawn red. Three rows take 611px of a 640px board, so no placement helps.

The app's own message is already exactly right ("The channel it needs is
already carrying as many cables as it can hold at 0.15in clearance"). The
remedies are the owner's: a shallower pedal in row 1, one fewer row, or running
one of the two underneath.

**Do not "fix" this by loosening a clearance.** The clearances now have a
contract test (`clearance-contract.test.ts`) precisely so that the next
loosening is a deliberate act with the arithmetic redone.

---

## R2 — Lane separation on dense boards

The last measured residue, down from four cases to one:

    jr/seven: loop+ns2loop+locked    3 lane violations

Pinned in `LANE_VIOLATION_BUDGET` with the count, so it fails if it gets worse
AND if it gets better. Cosmetic - the routes are legal and distinct, they just
read as one cable where they share a corridor.

**The evidence for the cause is that the UNPINNED version of the same board is
clean.** Two pedals pinned mid-chain leave the packer no room to end a row
where it would like to. The wrap-before-group retry added on 2026-08-18
(`layout/index.ts`) is the shape of the answer; it needs to understand pinned
pedals as well as loop groups.

Note what is NOT here any more: the crossing allowances in
`lane-router.test.ts` are an EMPTY table. "The lane router never draws a worse
board than the cascade" is now enforced by routing both ways and keeping the
better picture, so it is a guarantee rather than a tolerance.

---

## R3 — The optimizer pays 1.23x for that guarantee

Measured on both saved boards: `calculateOptimalLayoutJoint` went 1.64s -> 2.02s
when the never-worse guard landed, because scoring routes every candidate
twice. On the synthetic routing suites, where routing is nearly all the work,
it is 1.6x.

That is a real price for a real property and it was paid deliberately - a guard
that ran only when DRAWING would rebuild P1.5. But it is the obvious thing to
optimise if Optimize ever feels slow, and the cheap win is available: the
second pass only matters when the two routers disagree, and `laneOutcome`
already records which cables the corridor served.

**Do not "fix" it by scoring with a different router than the one that draws.**
That is the defect P1.5 existed to end.

---

## R4 — `roadmap-next.md` should probably not exist

This file has now been wrong twice in the way that costs the most: confidently,
in writing, about work that was already finished. The per-session task lists in
`sessions.md` have stayed accurate over the same period, because they are
written by whoever just did the work and are dated.

Worth considering: delete this and let the newest session entry's "Next Tasks"
be the roadmap. If it survives, it needs the same discipline as the code - a
claim without a measurement beside it is a claim nobody should act on.

---

## Deliberately NOT on this list

- **"231 of 1777 dense boards overlap."** Retracted on 2026-08-01. 214 were
  boards no packer could fit; the rest were an artefact of the harness starting
  every pedal at (0,0).
- **A better packing algorithm.** No evidence it is needed. The property sweep
  found 0 overlapping and 0 off-board results across 700 random boards a
  reference packer proved were fittable. Optimise this when a real board fails.
- **Widening `sameSideJackPad` to top/bottom shared sides.** The exclusion is
  correct: the pad is horizontal and buys room in a SIDE gap, while a top-jack
  pedal needs corridor HEIGHT that comes out of the row bands. Its comment used
  to give a wrong reason ("the wide row channels have room" - they are 14.8px)
  and was corrected on 2026-08-18; the wrong reason is what would have made
  this look worth doing.
