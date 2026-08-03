# Fixing the photo knockout — plan (2026-08-02) and outcome (2026-08-03)

**Status: built. Two of three targets fixed; one proved unfixable by this
approach, and two of the plan's three proposals were refuted by measurement.**

| pedal | before | after |
|---|---|---|
| BOSS DM-2W | top band 27.8% vs 100% mid — plate 70% eaten | **top 88.7%**, matches every other BOSS compact (83–90) |
| Strymon BigSky | 94.2% opaque, grey box retained, trim 877x703 | **99.3% opaque**, trim 833x599 — 104 rows of backdrop gone |
| Strymon Timeline | 95.3% opaque, grey oval under it | **unchanged — still skipped.** See "What could not be fixed" |

Klon (licence) and Big Muff (no head-on source) were out of scope and remain so.

---

## What shipped

`BG_GRAD_MAX_SAT`, in both `src/lib/images/knockout.ts` and
`scraper/mirror-pedal-images.js`. Gradient-chaining now additionally requires
that a pixel be no more than 48 saturation points more colourful than the
image's own border average.

The premise held: **studio backdrops and shadows are NEUTRAL; the features
that were being eaten are COLOURED.** Traced on the real photos, the fill's
path from the border to the damage:

```
DM-2W   backdrop sat 5,  path climbs 20,26,41,45,49,51,61,76,78 -> plate 99
BigSky  backdrop sat 0,  path steps  0 -> 70 -> 115 -> 127 -> body 224
```

Relative to the border average rather than absolute, because a backdrop is not
always neutral — a pedal photographed on a wooden floor sits on saturation ~80,
and an absolute gate would refuse to chain along the floor at all.

### Why 48 and not the 24 the plan proposed

Both targets are fixed anywhere in 16..120, so **the targets do not choose the
constant — the 62-pedal corpus does.** Swept with `knockout-regression.js`,
the count of corpus pedals that move is *not monotonic*:

```
16..32   7-11 move.  DD-7 loses 11.7pp off its bottom band; both MXR
                     silhouettes change size by up to 5%
40..64   4-6 move,   each a single band by <=5pp, no silhouette resizes  <- 48
72..80   BF-3 COLLAPSES (top 88.2 -> 73.0, left 55.5 -> 21.6)
96+      quiet again, but BigSky decays (top 96.4 -> 87.5)
```

48 sits mid-plateau, 24 clear of the BF-3 cliff, and leaves the DM-2W's plate
(sat 96–102) a margin of 43 and BigSky's body (70 at entry) a margin of 22.

### The 6 corpus pedals that moved are improvements, not regressions

Measured by asking what changed hands — every pixel newly cleared or newly
kept, and its colour:

```
BF-3, PH-3     subject-eaten -> knocked-out; newly cleared 60,052 / 12,071 px
               at mean saturation 2, luminance 251 — white backdrop they had
               been silently keeping. 0.0% coloured.
TR-2, XS-100,  newly KEPT 193-318 px each, 88.6-100% coloured (mean sat
Phase 90,      57-104) — pedal features the fill had been eating.
Conspiracy Th.
```

Zero pedal pixels newly removed. Zero backdrop pixels newly kept.

---

## What could not be fixed: Timeline

**The colour test cannot reach it, and this is measured, not assumed.** Tracing
the fill's path from the border into the centre of the pedal:

```
saturation along the path: 0,0,4,5,4,5,3,3,3,3,3,3,3,3
of the 1,243,441 pixels absorbed, 621 (0.0%) had saturation above 24
```

A silver enclosure lit by a neutral studio ramp **is** the same colour as its
own backdrop. There is no threshold to pick. The plan flagged this as "the
risk"; it is not a risk, it is the case.

The failure then proceeds differently from what the plan described. The plan
said `BG_GRAD_MIN_LUM = 90` halts the chain at the dark end of the ramp. It
does not: the gradient pass **runs away into the pedal**, is rejected by the
centre guard as `subject-eaten`, and the pipeline falls back to the strict
pass — which cannot span a 255→137 ramp, so everything below luminance 220
survives. Measured on the output edge: 218, 216, 209, 199, 179, 177, 137, all
neutral. That is the grey oval, and it is *under* the pedal because that is
where the drop shadow is.

Separating it needs a different KIND of signal — edge magnitude, or a real
matting algorithm — not another constant.
`src/lib/images/__tests__/knockout.test.ts` pins this limit with a fixture, so
if it ever becomes separable that test fails and says so.

---

## The plan's other two proposals were refuted — do not rebuild them

### 2. Band-vs-middle anti-erosion guard: REFUTED

Proposed: reject when any 10% edge band falls below ~40% of the middle's
coverage. The plan said to re-measure healthy pedals rather than assume 40%.
Measured across all 62 (`.claude/docs/knockout-fingerprint.json`):

```
healthy pedals, lowest band:  Holy Grail right 15%    Ditto left 22%, right 23%
                              Polytune 33/33          Cry Baby right 33%
damaged DM-2W, top band:      27.4%
```

**Healthy pedals go as low as 15% while the damaged one sits at 27%.** The
distributions overlap, so no single threshold separates them. A guard at 40%
would have rejected Holy Grail, Ditto, Polytune and Cry Baby — four pedals
that look right today.

### 3. Four-opaque-corners "background survived" check: REFUTED

Proposed: all four corners opaque means the backdrop is still there. Both
failing pedals measured `corners 0,0,0,0` — the trim crops to the alpha
bounding box, which removes the corners before anything can look at them.
Meanwhile two healthy pedals (XS-100, Conspiracy Theory) genuinely *do* have
an opaque corner, because a rectangular top-down legitimately fills its box.
The check misses the failures and flags the healthy.

**What does work** is the same neutral-vs-coloured insight: a surviving studio
backdrop is BRIGHT and NEUTRAL. Timeline's residue measures luminance 176–197
at saturation 0–5; no pedal colour and no part of the dark board looks like
that. That is the check `verify-knockout-on-board.js` actually runs, and it
was proven to fire before being trusted — it flags Timeline 4/4 corners and
pre-fix BigSky 1/4, and goes clean on post-fix BigSky.

---

## The tooling this left behind

| script | what it is for |
|---|---|
| `fingerprint-pedal-alpha.js` | records the alpha shape of all 62 mirrored images — **the baseline any future change is judged against** |
| `knockout-regression.js` | re-runs the pipeline over the 62 origin photos and diffs against that baseline. Writes nothing |
| `knockout-targets.js` | the three hard photos, measured through the real pipeline |
| `verify-knockout-on-board.js` | reads pixels back off the live canvas |

`.claude/docs/knockout-fingerprint.json` is the baseline. It was taken BEFORE
the change; leave it that way until the catalogue is re-mirrored, or the gate
loses its reference point.

**Validate the harness before trusting a clean result.** `knockout-regression`
was first run against the *old* algorithm, where it reproduced all 62
fingerprints exactly — that is what makes "no pedal moved" mean something
rather than meaning the script is inert. The same was done for the board
detector.

**And still do not judge a knocked-out photo by opening the PNG.** A viewer
composites transparency against a light background and hides precisely a
retained grey backdrop and a softly-eroded edge.
