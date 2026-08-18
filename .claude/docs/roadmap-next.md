# Settled: what is closed, and what we are deliberately not doing

**This is no longer a roadmap.** It was one, and it was confidently wrong in
writing three times - always in the same way, about work that was already
finished or about a cause that had never been measured:

| Wrong how | Cost |
|---|---|
| P1.5 listed as "the oldest real defect left" | It had been closed on 2026-08-02. Announced as open on 2026-08-18. |
| P5 described as a trap waiting to catch someone | The function it names has no production callers. |
| R2 blamed on "pinned pedals leave the packer no room to end a row" | The packer had room. The cause was a boolean pad worth 2.0in of row being spent to recover 0.35in. Two sessions read it as actionable. |

The per-session task lists in `sessions.md` stayed accurate over the same
period, because they are dated and written by whoever just did the work.
**So the newest session entry's "Next Tasks" is the roadmap now.**

What survives here is the half that does not rot: decisions already made. A
closed item and a deliberate no are both facts about the past, and the whole
failure mode above was this file speculating about the future.

---

## Closed

Kept as a list rather than deleted, because "is this done?" is exactly the
question that wasted a session.

| Item | Closed | Evidence to re-check with |
|---|---|---|
| P0 jack data invented for 13 pedals | 2026-08-01 | `verify-pedal-jacks.js` reports 0 contract violations |
| P0b loop hub members placed beside their hub | 2026-08-01 | `config-matrix` ns2loop scenarios |
| P1 power budget, both halves | 2026-08-02 | `power_supplies` migration, `SupplyPlan` in `derived.ts`, per-output loads in `power-panel.tsx` |
| P1.5 cost model vs drawn routing | 2026-08-02 | `routing-cost.ts` calls `routeCablePaths`; `router-parity.test.ts` gates it |
| P2 say WHY a board will not fit | — | `explainFit` in `routing-cost.ts`, `fit-explanation.test.ts`, surfaced by `optimization-summary.tsx` |
| P3 show a perimeter cable as what it is | 2026-08-10 | dashed stroke + "Around the board" legend row in `explain.ts` |
| P5 `calculateGreedyPlacement`'s muddy contract | 2026-08-18 | it has NO production callers; guard asserted in `placement-degraded.test.ts` |
| R1 row-corridor clearance contradiction | 2026-08-18 | `OBSTACLE_MARGIN` 8 -> 6, `clearance-contract.test.ts` asserts the whole set |
| R2 lane separation on dense boards | 2026-08-18 | graduated hub padding (`hubPadMode`), `hub-pad-graduated.test.ts`. `LANE_VIOLATION_BUDGET` is an EMPTY table |

---

## Deliberately NOT on this list

The point of keeping these: each was investigated, and each would look
plausible to someone arriving fresh.

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

- **Loosening a clearance to clear the last red cables on `test`.** The
  clearances have a contract test (`clearance-contract.test.ts`) precisely so
  the next loosening is a deliberate act with the arithmetic redone. The
  remaining failures are physical - a pedal with both jacks on its top edge
  needs a corridor the board does not have.

- **Scoring with a cheaper router than the one that draws.** This is the P1.5
  defect by another name. If Optimize is ever worth speeding up, the second
  pass only matters where the two routers disagree, and `laneOutcome` already
  records which cables the corridor served. Measured 2026-08-18: 1923ms on the
  22-pedal board through the worker, which is not slow.

---

## If you are about to add something here

Add it only if it is CLOSED or DECIDED. Anything you are planning belongs in
the newest session entry's "Next Tasks" in `sessions.md`, with the measurement
that supports it written beside it - a claim without one is a claim nobody
should act on, and this file is what that looks like after a few weeks.
