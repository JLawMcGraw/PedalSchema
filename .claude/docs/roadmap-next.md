# What to do next (2026-08-01)

Written after the rotation rework, phases 5 and 6, and adding the owner's four
pedals. Ordered by what it costs to be wrong, not by what is fun to build.

Every item below is grounded in a measurement taken this session, quoted with
it, so none of this has to be re-derived to decide whether it is worth doing.

---

## P0 — Thirteen pedals are routed on invented jack data — DONE 2026-08-01

**Resolved by deletion, not research, once the data explained itself.** All 26
signal rows were `input:right @50` / `output:left @50` - byte-for-byte what
`findJack()` synthesises for a pedal with NO jack data. They were the fallback
written into the database as fact, where it outranked the fallback it came
from. Proven routing-neutral (118 lines of placements and cable paths across
both boards and both loop settings, byte-identical) then deleted in migration
20260801000004. Contract violations 13 -> 0.

The canvas now shares the router's fallback via `jacksToRender()` and draws an
ASSUMED jack hollow, so a guess does not look like a fact there either - which
also fixed a pre-existing bug where a pedal with no jack data drew no jacks at
all while its cables attached happily to the edges.

Real layouts still arrive one at a time, by research or owner inspection.

`node .claude/scripts/verify-pedal-jacks.js` reports **13 contract
violations**: pedals carrying three jack rows each with no `jacks_source_url`.
They came from the original seed, and nobody wrote down where the layout came
from because it was assumed rather than read.

This is the highest-value fix in the app because it is SILENT. Every one of
those rows feeds `hasTopOrBottomSignalJack`, which decides rotation, and feeds
cable endpoint geometry, which decides routing. Invented data does not look
different from researched data at the point of use.

It already touches the real board: **Ibanez TS9 Tube Screamer, on J$ Home, is
routed on fabricated jack positions.**

The 13: Cry Baby GCB95, Fuzz Face, Big Muff Pi, Holy Grail, Small Clone, TS9
Tube Screamer, Klon Centaur, Carbon Copy, Dyna Comp, Phase 90, RAT 2, Ditto
Looper, Polytune 3.

Two ways to close it, and they are not exclusive:

1. **Ask the owner.** Several of these are on the board in the room. That is a
   better source than a manual, and it is how the four new pedals will get
   their layouts. Record the owner as the source explicitly - the point of the
   provenance column is that the claim is attributable, not that it is a URL.
2. **Delete what cannot be attributed.** A pedal with no jack rows falls back
   to the documented default assumption and is honest about it. A pedal with
   three invented rows claims knowledge it does not have. Deleting is
   strictly better than keeping a guess that outranks the fallback.

Do NOT leave them as they are on the grounds that "the defaults are probably
right". The whole reason the width veto survived so long is that a plausible
assumption went unchallenged.

**Verify:** `verify-pedal-jacks.js` reports 0 contract violations; re-run the
real-board fingerprint to see whether any routing actually changes.

---

## P0b — Place a loop hub's members beside it — DONE 2026-08-01

Members are now part of the primary run, laid out immediately after their hub -
the shape 4-cable mode already used, and what a person actually builds. On the
owner's board Optimize goes 413.88 -> 170.84 and produces
`TU-3 <- Chorus <- NS-2 <- Conspiracy <- TS9`, cable 53.2in against 77.9, one
crossing against sixteen.

**What took five attempts was the PADDING, not the ordering.** The hub carries
0.5in of extra corridor on each side because two cables pass each of its gaps.
That padding is exactly what pushed the group past the end of an 18in row - the
run needs 17.82in bare, 18.82in padded - so the packer wrapped THROUGH the
group and stranded a member on the next row. Every earlier attempt was a
different way of losing that fight: cluster-first took the hub's own row;
excluding that row scrambled the overflow to 621.74; inline alone split the
group; an atomic-group rule did not catch it.

The answer was to make the padding a RETRY: attempted, and given up only if it
splits the group. A stranded member costs two board-length cables; crowded
corridors cost some lane separation. The padding is the cheaper thing to lose.

The group's TAIL needed the same padding, for the same reason - the return and
the hub's output both cross the gap past it, and at minimum spacing that gap
leaves a 4px band for two runs needing 10px. That one change cleared 12 of 18
matrix failures.

An invariant was REWRITTEN, not relaxed: "every member within 8in of its hub"
was right for a bunched cluster and wrong now (the twelve-pedal board correctly
puts its third member 11.11in away, all on one row, in order). It now asserts
the group is not BROKEN - every member on the hub's row, nothing interleaved -
which still catches the real failure and catches it for the right reason.

**Residual:** one lane violation on the owner's board, because an 18in row has
no room for the padding that would fix it. Cosmetic overlap, not a wrong
layout. It is the P4 item below.

---

## P1 — A board-level power budget — DONE 2026-08-01 (first half)

There is no power total anywhere. `currentMa` is shown per pedal in the
properties panel (`9V / 300mA`) and nowhere else, so nothing tells you a
supply is over-committed until you plug it in.

The numbers say this matters now:

    J$ Home   7 pedals    301mA   (601mA once the Flint goes on it)
    test     20 pedals    986mA

986mA is past what a common 8x100mA brick delivers, and the Flint alone needs
300mA on one output. This is a real constraint the app is silent about.

**The trap, already recorded in memory and worth repeating here:** `currentMa`
is null for pedals whose draw was never recorded, and null is NOT zero. A
`?? 0` anywhere in the total turns "we do not know" into "free", and reports
an inadequate supply as adequate. The tri-state must survive to the UI: known
total, plus a count of unknowns, e.g. "986mA across 20 pedals (3 unknown)".
All 27 rows on the two real boards currently have a value, so the null path
will not show up in testing by accident - it needs its own test.

**Built:** `src/lib/engine/power`, derived into board state, shown in a Power
tab. Known total kept separate from the pedals it cannot account for, rendered
as `>= 301 mA`; pedals over a typical 100mA output flagged; split by voltage.
Bypassed pedals counted - isActive is a signal-path state, not a power one.

**Still open (the supply half):** modelling an actual supply - outputs, their
ratings, and which pedal is on which - so the app can say "output 3 is over"
rather than only "the board wants 986mA". That needs a supplies table and an
assignment UI, and is worth doing only if you want the app to plan wiring
rather than just report demand.

Note for whoever builds it: the catalogue has exactly ONE pedal with no
recorded draw (IR-200), and it is on nobody's board, so the null path cannot
be reached by clicking around. `PROBE_UNKNOWN=1 node
.claude/scripts/verify-power-panel.js` adds it to client state without saving.

---

## P1.5 — The cost model and the drawn routing use different routers

Found while verifying P0. On the 20-pedal board at its stored settings, the
COST model scored one cable as `fallback-invalid` (a 100-point
`routingFailures` penalty) while `deriveBoardState` - what the user actually
sees - routed every cable successfully. `calculateRoutingCost` calls
`routeCableWithObstacles` directly; the derived state goes through the lane
router, which succeeded where the direct one failed.

That means the optimizer scores layouts against a MORE PESSIMISTIC routing
model than the one that draws the board, so it can be steered away from
layouts that are actually fine, by a failure that never appears on screen.

Phase 6 happened to align them for this cable (the perimeter route removed the
penalty: routingFailures 100 -> 0, cableLength 107.68 -> 134.18). That is luck,
not a fix. Worth making the two agree deliberately - one router, or an explicit
reason why scoring should be stricter than drawing.

---

## P2 — Say WHY a board will not fit, not just that it will not

The message today is honest but not actionable:

> "Could not fit these pedals on this board - your layout was left alone. Try
> a larger board or removing a pedal."

Phase 6 established that the constraint is often not area but CORRIDORS: three
rows of ~5.1in pedals on a 16in board leave 0.2in between rows, and a patch
cable is about 0.24in thick. "Try a larger board" does not convey that the
board is 0.04in per corridor away from working, or that removing one deep
pedal would change the row sizing entirely.

Cheap version: report the arithmetic that failed - rows needed, depth
available, corridor left. The engine already computes all of it in
`deriveRows`; it just throws it away.

---

## P3 — Show a perimeter cable as what it is

`routeAroundBoard` (phase 6) draws the cable that cannot fit between rows
around the outside of the board. It is correct and it is what a player
actually does - run it underneath - but on screen it is just a cable taking a
strange path, with nothing saying why.

`RoutedCable.strategy` already carries `'perimeter'`, so the renderer has what
it needs. A dashed stroke and a tooltip ("no room between the rows - run this
one under the board") would close the loop. Small, and it makes a
deliberate decision legible instead of looking like a bug.

---

## P4 — Lane separation on dense boards

Found during phase 6, not chased. On the 20-pedal board with the amp loop on:

    v-runs 1px apart, 153px shared   (2 cables)
    v-runs 2px apart, 169px shared   (2 cables)
    v-runs 2px apart, 112px shared

Two cables running 1-2px apart for 150px read as one cable. Cosmetic - the
routes are legal and distinct - but it undermines the diagram's whole job.
`laneViolations` in the test invariants already detects it.

---

## P5 — `calculateGreedyPlacement` has a muddy contract

It returns overlapping positions when a board is genuinely too full, because
its last resort clamps a pedal on-board rather than dropping it. Harmless
today - `calculateOptimalLayoutJoint` scores any colliding candidate Infinity
and every caller goes through it - but "returns something invalid and expects
you to notice" is a contract that eventually catches someone.

Low priority precisely because it is currently guarded. Do not fix it by
returning null without checking what that does to the callers: making the
fallback return nothing was already tried once as a fix for the phase 5
overlap and would have turned a wrong answer into no answer.

---

## Deliberately NOT on this list

- **"231 of 1777 dense boards overlap."** Retracted. 214 of those were boards
  no packer could fit, and the rest were an artefact of the harness starting
  every pedal at (0,0). See the phase 6 session entry.
- **A better packing algorithm.** No evidence it is needed. The property sweep
  found 0 overlapping and 0 off-board results across 700 random boards that a
  reference packer proved were fittable. Optimise this when a real board fails,
  not before.
