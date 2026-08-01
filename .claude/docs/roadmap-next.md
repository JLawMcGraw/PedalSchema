# What to do next (2026-08-01)

Written after the rotation rework, phases 5 and 6, and adding the owner's four
pedals. Ordered by what it costs to be wrong, not by what is fun to build.

Every item below is grounded in a measurement taken this session, quoted with
it, so none of this has to be re-derived to decide whether it is worth doing.

---

## P0 — Thirteen pedals are routed on invented jack data

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

## P1 — A board-level power budget

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

Worth building in one step: total draw, per-output assignment against a supply
model, and a warning when a single output is over its rating.

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
