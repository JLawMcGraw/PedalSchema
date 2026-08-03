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

### Edge magnitude was then tried, and is also blind

The idea was sound and the diagnosis it produced is worth keeping: the fill
does not **cross** the pedal's edge — `BG_GRAD_TOL` already forbids that — it
walks **along the shoulder** of the edge, which descends smoothly in the
direction parallel to it (185 → 165 → 127 → 93 going up the right side) and
steps off the bottom of that ridge onto the face. Per-pixel walks inward from
the frame edge:

```
backdrop, right side    255 -> 227 over 120px      ~0.5 /px
drop shadow, bottom     255 -> 131 over 110px      1.3-2.3 /px
pedal's right edge      227 -> 109 in ONE step     91  /px
pedal's bottom edge     162 -> 60                  34-54 /px
```

Gating chaining on steepness ≤ 25 closed that path. The fill entered somewhere
else: at x=632 the Timeline's own **silver top face (L216) meets the white
backdrop (L243) with no bevel**, and every pixel on the new entry path measures
steepness 2–9. Where the enclosure is bright silver there is no boundary in the
image data at all. The gate also cost BigSky (top band 96.1 → 89.0), so it was
reverted.

### All three local channels, measured and refused

| channel | measurement |
|---|---|
| COLOUR | 0.0% of the 1,243,441 absorbed pixels are saturated |
| BRIGHTNESS | pedal spans L[89,231], which **contains** the shadow's L[137,219]; sweeping the floor 90→190 either leaves the shadow or eats the top face (top band 16–73%) |
| GRADIENT | entry path is smooth, steepness 2–9 |

Cropping the residue instead of separating it was also tried. The
bright-neutral rows *are* contiguous from the edges (top 11, bottom 33, left
17, right 33), but cropping them leaves all four corners **still** backdrop
(lum 145–164) — the shadow is a gradient, so the boundary just moves — and it
would crop lines from **36 of the 62** pedals that are already right (Polytune
3 alone loses 77 top rows).

### A better source is the remaining route, and there is not one

- Strymon's only other top-down is `timeline_topdowncrop_1600.jpg`: 1600x714 on
  a **grey** backdrop, aspect 2.24 against a 1.275 footprint.
- The three Andertons gallery originals are all angled. The closest by aspect
  (1.033× footprint, 0/4 backdrop corners) has a visibly **diagonal**
  silhouette — a beauty shot whose proportions merely coincide.
- Reverb, Perfect Circuit and Sweetwater refuse automated fetches (HTTP 403),
  and a dealer photo would drop provenance to `unknown` besides.

So this needs real matting — a trimap or learned alpha — not another constant.
`src/lib/images/__tests__/knockout.test.ts` pins the limit with a fixture, so
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
