# The routing-config toggles (2026-08-18)

> **STATUS: DONE, 2026-08-18.** All tasks closed - see the session entry in
> `sessions.md`. Two places this plan was WRONG, both corrected by measurement
> rather than argument:
>
> 1. **"`modulationInLoop` is inert."** Only the OFF direction was. The ON
>    direction worked all along; `test` cannot show it (both modulation pedals
>    already in the loop) and J$ Home half-hides it (one of the two is
>    `chainPositionLocked`, so rules skip it entirely).
> 2. **"The gap is exactly loop ON, mod flag OFF."** Too small. Dirty
>    modulation is an ORDER - modulation before the drives - not just a
>    location, per the owner mid-session. The category defaults put modulation
>    at 110, after overdrive 60 / distortion 70 / fuzz 80, so no pedal ever
>    moved. That is the "should move cables AND pedals" report.
>
> T5 found the effects-loop half is FINE in the app, as the engine measurement
> suggested. The reported bug was one of the two toggles.

> **For Claude:** work through this task by task. Every claim below is a
> file:line read this session or a measurement quoted from 8/10 — none of it
> needs re-deriving before starting.

**Goal:** the two toggles the owner reports as broken — the effects-loop button
and dirty/clean modulation — do what the panel says they do. 8/10 measured the
two halves offline and found they have **different answers**, so they get
different tasks: one is a real engine bug with a known line number, the other is
proven working in the engine and unmeasured in the app.

**Architecture:** no new subsystems. One rule becomes symmetric, one test that
currently pins the bug gets rewritten, and the app path gets measured rather
than assumed.

---

## What is already known, and from where

**`modulationInLoop` is inert, and 8/10 named both reasons.** Holding the other
flags fixed, mod=off vs mod=ON gives identical placements in all three pairings
and the in-loop count does not move (6 → 6, 0 → 0).

**The rule is one-directional.** `signal-chain/rules.ts:207-223`
(`modulation-flexible`, priority 50) moves modulation and tremolo to
`effects_loop` when the flag is ON and returns `pedals` untouched when it is
OFF. Its own comment claims "Default: keep modulation in front of amp" and no
code does that. A pedal that has ever been in the loop can never come back, so
"dirty modulation" is unreachable for it.

**The global OFF case is already handled, and it is why this went unnoticed.**
`signal-chain/index.ts:105-110` (step 3b) rewrites every `effects_loop` pedal to
`front_of_amp` when there is no loop at all. So `useEffectsLoop=false` does
return modulation to the front — via a different code path, for a different
reason. The gap is exactly: **loop ON, modulation flag OFF.**

**The panel already promises the behaviour that does not exist.**
`routing-options-panel.tsx:171-173` renders `'Dirty: modulation before preamp'`
for the OFF state. This is not a feature request; the UI is lying today.

**A test currently pins the bug.**
`signal-chain/__tests__/chain-ordering.test.ts:222` — "leaves it alone when
there really is a loop in use" — asserts a **modulation** pedal keeps
`location: 'effects_loop'` under `loopContext`, whose `modulationInLoop` is
`false`. That is the buggy behaviour, asserted. The test's real intent (a loop
exists → step 3b must not fire) is category-independent and survives if the
fixture switches to a delay. Expect this to go red; that is the fix landing, not
a regression.

**The effects loop WORKS at the engine level** (8/10, replaying `test` through
`normalizeChain` then `calculateOptimalLayoutJoint`):

    loop=off 4cm=off   score 531.15   0 pedals in loop
    loop=ON  4cm=off   score 848.09   6 in loop, placements and chain differ
    loop=ON  4cm=ON    score 719.21   6 in loop, placements and chain differ

So if it looks wrong in the app, the gap is store→canvas. Reading that path this
session, it **looks** correct — `setUseEffectsLoop` calls `normalizeChain`
(`configuration-store.ts:319-327`), `modulationInLoop` and `useEffectsLoop` are
both memo inputs to `deriveBoardState` (`derived.ts:98-100`), and `optimizeLayout`
forwards `{ ...routingConfig, useEffectsLoop, use4CableMethod }`
(`configuration-store.ts:655`). Looking correct is not a measurement. T5 measures it.

**Which board to test on.** On `test`, both modulation pedals (DC-2W, PH-3) are
already `effects_loop` in stored data, so the toggle is a no-op in both
directions there. **J$ Home is the board that can show the ON direction** — its
Chorus Ensemble Deluxe and BF-3 are both `front_of_amp`.

---

## T0 — DECIDED 2026-08-18: the modulation toggle wins over 4CM

`four-cable-fx-loop` (`rules.ts:28-54`, priority **104**) puts modulation,
tremolo, delay and reverb in the loop whenever 4CM is on. `modulation-flexible`
is priority **50**, so it runs **after** it. The owner's call: **modulation
follows the switch even under 4CM.** Delay and reverb stay in the loop, because
post-preamp is the whole point of the method for those; modulation placement is
taste, and the panel shows both switches at once
(`routing-options-panel.tsx:160,180`) so the modulation switch has to keep
meaning what it says.

**Consequence to expect in T4, not to be alarmed by:** `4cm=ON mod=OFF` becomes
a real placement change, so config-matrix rows that are byte-identical today
**will** move. That diff is the decision landing. A diff in any *other* pairing
is not.

---

## T1 — Measure before changing anything

Dump and replay both real boards across `4cm × mod`, recording per-pedal
`location`, in-loop count, score, and a placement hash:

    node .claude/scripts/dump-configs-offline.js /tmp/configs.json
    PEDAL_CONFIG_DUMP=/tmp/configs.json npx vitest run saved-board-fingerprint

The dump ran this session: **J$ Home 9 pedals / Classic Jr, test 22 / Classic
Pro, dadfad 0**. Keep the fingerprint as `fp-before.txt`; the point of T4 is the
diff, and 8/10 showed a harness that normalises what the product does not is
worthless — read diffs, not absolute numbers.

Expected before-state, from 8/10: mod ON and OFF produce **byte-identical**
placements. If they do not, this plan's premise is wrong and everything below
stops until that is explained.

## T2 — Make the rule symmetric

`rules.ts:207-223`. When a loop really exists (`ampHasEffectsLoop &&
useEffectsLoop`), modulation and tremolo go to `effects_loop` when the flag is
ON and back to `front_of_amp` when it is OFF. Two things must not be lost:

- `locationOverride` is respected in the ON direction (`rules.ts:212`) and needs
  the same guard going back. A pedal the owner placed by hand is not the
  toggle's to move — that is what the flag being one-directional accidentally
  guaranteed and a symmetric rule can easily break.
- Do not duplicate step 3b. When there is no loop, this rule should return
  `pedals` untouched and let `index.ts:105-110` do its job; two places writing
  the same location is how the jack-selection duplication started.

Per T0, the OFF branch applies **even when 4CM is on**, and only to
modulation/tremolo — delay and reverb keep whatever `four-cable-fx-loop` gave
them. Write the reason on the code, not just here: a later reader will otherwise
see a priority-50 rule undoing a priority-104 one and "fix" it back.

## T3 — Tests that would have caught it

In `chain-ordering.test.ts`:

- Rewrite the fixture at :222 to a delay so the "a loop exists → step 3b does
  not fire" invariant is tested category-independently.
- **Both directions**, as a round trip: ON puts a front-of-amp chorus in the
  loop; OFF returns a stored-in-loop chorus to the front; ON→OFF→ON lands where
  it started (the one-directional rule fails the second leg).
- `locationOverride` survives both directions.
- The T0 decision, asserted with its reason in the test name.

## T4 — Prove the blast radius

Re-run the fingerprint and `config-matrix`. The matrix already sweeps
`modulationInLoop` (`config-matrix.test.ts:64`) and its invariants have caught
real breakage before, so a change here is exactly what it is for.

Every diff must be **explained, not just observed**: J$ Home's two front-of-amp
modulation pedals should move only in the pairing whose flag says so, and `test`
should be untouched in the OFF→front direction it cannot exercise. An
unexplained diff is a second bug, not noise.

## T5 — Measure the effects-loop half in the live app

The engine is proven; the app is not. On J$ Home, with the dev server up: toggle
the effects loop, then Optimize, and read the twin
(`__getPedalSchemaSnapshot`, `derived.ts:198`) before and after — cables,
chain positions, placements. Compare against the offline replay for the same
flags. Either it matches, and the owner's report is about the modulation half
(likely — that toggle is genuinely dead), or the store→canvas gap 8/10 predicted
is real and gets its own task with a measurement attached.

Do not screenshot-and-squint: the twin is the verification, per CLAUDE.md.

## T6 — Record it

Session entry in `sessions.md` in house style — what moved, what was measured,
what was wrong. If T5 finds the app half is fine, say so plainly: "the reported
bug was one of the two toggles" is a result.

---

## Deliberately NOT in this plan

- **Putting `modulationInLoop` into `RoutingConfig`.** 8/10 recorded that
  nothing in `layout/` or `topology/` reads it and its only route to placement is
  the `location` normalizeChain writes. That is defensible and plumbing it
  through would be a second way to say the same thing.
- **Re-litigating the 4-cable rule's category list.** T0 makes modulation follow
  the toggle under 4CM without touching that rule. Reopen only if the matrix
  says otherwise.
