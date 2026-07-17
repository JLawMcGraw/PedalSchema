# Routing & Placement Roadmap (2026-07-16)

Goal: routing AND placement that are provably correct and visually clean across
every configuration setting (effects loop, 4-cable method, modulation-in-loop,
NS-2 pedal loops, locked pedals, rotation, board/rail variety) — with the test
harness catching config regressions before the user does.

Phases are ordered by dependency: the harness (1) protects the topology
refactor (2), which is the foundation for the lane router (3) and the
placement search (4).

---

## Phase 1 — Configuration-matrix invariant harness ✅ DONE (2026-07-16)

66 scenarios green in CI. The harness immediately caught four real placement
bugs on its first run (all fixed): (1) the rails-too-close fallback measured
unclamped rail positions, so boards like Wide-22 ran with a 0.34" row gap;
(2) the 0.25" placement search grid leaked up to 0.25" per pedal, starving
the last pedal on full rows and triggering (3) a constant-coordinate last
resort that STACKED pedals (replaced with a progressive-spacing free-spot
scan); (4) three cables sharing the loop-cluster corridor couldn't fit at
0.4" clearance (now 0.7" = three lanes, plus a max-separation fine scan in
the lane fallback). 4CM and NS-2 pedal-loop combos run in a documented
LENIENT tier (placement is knowingly naive until Phase 2) - still asserting
no collisions, no silent through-pedal cables, and determinism.


**Problem**: every regression so far (FX-loop inversion, amp-column stacking,
SA zigzag) was found by the user in a config combination the tests didn't
cover. The settings space is combinatorial; the tests are anecdotal.

**Build**:
- `src/lib/engine/__tests__/support/` — shared fixture builders (boards:
   2-row 18", 4-rail 22", single-row mini; pedal sets: 3 / 7 / 12 pedals with
  mixed categories incl. NS-2 `supports4Cable`, delays/reverbs, modulation,
  tuner, looper, and pedals with REAL jack definitions incl. top-mounted) and
  a `simulateConfiguration()` util replicating the store pipeline as pure
  functions: normalize chain → optimize layout → calculate cables → route.
  Move `assertPathNeverEntersPedals` (1px sampling) here from the routing test.
- `config-matrix.test.ts` — sweep: boards × pedal sets ×
  {loop off/on} × {4CM off/on} × {modulationInLoop off/on} × {NS-2 useLoop
  off/on} × {0 or 2 locked pedals}, skipping invalid combos (4CM needs loop).
  ~100-150 scenarios, each asserting the invariants:
  1. no pedal collisions; everything in bounds
  2. every cable valid; independent sampling never inside a pedal body
  3. no two parallel runs from different cables closer than one lane
     (with >12px shared length)
  4. per-segment physical order: front chain monotonic right-to-left per row;
     loop cluster packed at the amp on the jack-nearest row
  5. determinism: identical output on repeat runs
  6. idempotence: optimizing an optimized layout is a no-op
- Failure output prints the config descriptor + offending coordinates.

**Done when**: matrix green in CI; runtime < ~15s.
**Estimate**: one session. No production code changes (except small exports).

---

## Phase 2 — Topology-driven placement ✅ DONE (2026-07-16)

Shipped: `src/lib/engine/topology/` (deriveSignalTopology + segment model).
calculateCables became a thin topology walk (1280→618 lines; characterized
90/90 identical before the swap, then deleted the legacy paths + duplicated
4CM lists). routing-cost walks the same topology (its private 4CM block and
location splits deleted; it now also scores NS-2 pedal loops, which it
previously couldn't see). The placer is segment-driven: amp clusters first
(row nearest their jacks, packed at the amp, corridor-inflated), then the
primary chain (hub INLINE with a fixed 0.5" pad on both sides - four jacks
of corridor demand), then hub-anchored clusters (right-aligned to the hub,
edge-padded). Clearances retry in tiers (0.7/0.35/0.15) when placement
degrades on packed boards. Lane separation gained relaxation sweeps
(re-visit all cables until stable). The matrix lenient tier is GONE -
all 66 scenarios strict, 91 tests total. Live 4CM verified on the user's
board (NS-2 hub, 10 cables, 0 overlaps, 0 invalid).


**Problem**: `calculateCables` knows the full topology (4-cable method's four
runs, NS-2 send/return loops), but the placer only knows two crude zones
(front/loop). 4CM layouts are placed as if they were a plain chain; NS-2 loop
members aren't clustered around the hub. The 4CM category lists are
duplicated in `cables/index.ts` and `routing-cost.ts` and absent from layout.

**Build**:
1. `src/lib/engine/topology/index.ts` —
   `deriveSignalTopology(placedPedals, pedalsById, context, routingConfig)`
   returns ordered **segments**, each `{ pedals[], fromAnchor, toAnchor }`
   where anchors are `guitar | amp_input | amp_send | amp_return |
   { pedalId, jack }`. All modes expressed uniformly:
   - standard: one segment guitar→amp_input
   - FX loop: two segments (…→amp_input, amp_send→…→amp_return)
   - NS-2 pedal loop: extra segment via the pedal's send/return anchors
   - 4CM: the four hub segments
2. **Characterization first**: temporary test asserting new topology-walk
   cable output === current `calculateCables` output across the whole matrix.
   Then rewrite `calculateCables` and `routing-cost` chains as thin walks over
   the topology; delete the duplicated 4CM category lists (single table in
   topology module).
3. Placement planner consumes segments: generalize the proven primitives —
   packed right-to-left placement, row preference by anchor Y (the SND/RTN
   logic generalized to any anchor), cluster clearance inflation — into
   per-segment regions: before-hub near guitar, hub as wiring center, hub-loop
   drives between hub and amp, amp-loop cluster at the amp-side corner.
4. Signal-flow penalty and enumeration operate per topology segment (replaces
   location-based splits).
5. Matrix gains topology assertions: hub-loop pedals sit between hub and amp;
   before-hub pedals right of the hub; loop cluster contains exactly the loop
   segment's pedals.

**Done when**: matrix green including new assertions; live 4CM screenshot of
the user's board (NS-2 as hub) shows clustered, short-cabled layout.
**Estimate**: two sessions (largest, riskiest — hence Phase 1 first).

---

## Phase 3 — Manhattan lane router ✅ DONE (2026-07-16)

Shipped: `src/lib/engine/lanes/` - corridor graph derived from placement
(horizontal row-gap bands + vertical pedal gaps + off-board amp/guitar
columns), Dijkstra with turn penalty, per-corridor lane assignment at
uniform spacing ordered by run midpoint (parallel flows stay parallel;
squeeze to 9px min before falling back). Integrated in routeAllCables with
the strategy router as per-cable fallback; fallback cables lane-relax
around the fixed corridor lanes. Renderer gained rounded corners (6px
quadratic bends). Acceptance test: axis-aligned segments, crossings do not
regress vs the strategy router, corridor adoption > 30%. 103 tests. Live
verified on the saved 4CM board - square looms, rounded bends, 0 overlaps.


**Problem**: routing is valid but shows its origins — occasional A* grid jogs,
non-square corners where constrained, first-come lane assignment.

**Build**:
- Channel model derived from placement: horizontal corridors (row gaps,
  above/below rows), vertical corridors (pedal gaps, zone seams, amp/guitar
  approach columns) → corridor graph (nodes at corridor intersections).
- Route = stub → shortest corridor-graph path (Dijkstra, weighted by length +
  turn count) → stub. Per-corridor lane assignment via classic channel
  routing (order by entry/exit to minimize crossings), lanes centered in the
  corridor at LANE_SPACING.
- Keep the current strategy pipeline as fallback when the corridor graph
  can't reach an endpoint; flag-gated rollout, matrix comparing validity and
  crossing counts old-vs-new before removing the flag.
- Rendering: small arc radius on corners (all runs orthogonal + uniform lanes
  make this trivial).

**Done when**: matrix green; aesthetic assertions (all segments axis-aligned,
uniform lane spacing, crossings ≤ old router); before/after screenshots.
**Estimate**: one-two sessions.

---

## Phase 4 — Jack- and rotation-aware placement search ✅ DONE (2026-07-16)

Shipped: two-stage deterministic search in calculateOptimalLayoutJoint -
chain orders (stage 1) then rotation coordinate descent {0,90,180,270} for
pedals whose input/output sit on top/bottom edges (stage 2), capped at 200
evaluations, strictly-better acceptance (idempotent). HARD collision guard:
overlapping/out-of-bounds candidates score Infinity (the routing cost has
no overlap term - shorter-but-colliding layouts would otherwise win).
Same-side-jack corridor pad (0.35") when input+output share a LEFT/RIGHT
edge after rotation. Rotations returned in JointOptimizationResult and
applied by the store. Evidence: EQ-200 in the twelve fixture rotates 180
(jacks into the row channel), total routed length 53.5in -> 44.2in (-17%).
105 tests incl. rotation acceptance + idempotence.


**Problem**: the placer assumes input-right/output-left; real jack data
(incl. top-mounted) and 90° rotation are ignored as placement variables.

**Build**:
- Candidate generation in the deterministic enumerator: per-pedal rotation
  {0, 90} only where rotation changes jack facing or enables a fit; jack-side
  aware gap widths (facing jacks get corridor clearance, like the loop
  cluster rule).
- Bound the search with a beam (keep top ~16 partial candidates, scored by
  the existing routing cost — which already routes real jacks, so scoring is
  free).
- Matrix gains pedal sets with top-jack and side-jack mixes.

**Done when**: a fixture with an EQ-200-style top-jack pedal gets a
measurably shorter routed total than the orientation-blind baseline;
matrix green; enumeration stays < ~200 evaluations.
**Estimate**: one session.

---

## Phase 5 — Quality-of-life batch (slot in alongside any phase)

1. **Multi-row zone capacity**: required zone width = packing across the
   zone's available rows, not a single-row sum; delete the `zonesOverlap`
   full-width fallback.
2. **Live rerouting during drag**: feed the drag preview position into the
   derived pipeline (throttled ~80ms) so cables follow the pedal instead of
   freezing until drop.
3. **Undo/redo**: snapshot `{placedPedals, flags}` per mutation (ring buffer
   ~20 or zundo), toolbar buttons + Cmd+Z/Shift+Cmd+Z. Cheap since the
   derived-state refactor.
4. **`routing_type` decision**: keep the columns; loop switchers/AB boxes
   become representable as topology segments after Phase 2 — file as the
   feature that validates the topology model. No code until then.
5. **CI**: bump actions/checkout + setup-node to v5 (Node 20 deprecation
   notice).

---

## Sequence summary

| Order | Phase | Size | Risk | Gate |
|-------|-------|------|------|------|
| 1 | Config-matrix harness | S | none | matrix green in CI |
| 2 | Topology-driven placement | L | highest (calculateCables rewrite; characterization tests first) | matrix + live 4CM screenshot |
| 3 | Manhattan lane router | M | medium (flag-gated, old router as fallback) | aesthetics assertions + screenshots |
| 4 | Jack/rotation search | M | low | beam bounded, matrix green |
| 5 | QoL batch | S each | low | per-item |

Verification standard throughout: matrix in CI + live extraction
(`extract-live-state.js`) with screenshot evidence on the user's real board,
per CLAUDE.md.
