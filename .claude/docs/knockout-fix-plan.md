# Fixing the photo knockout (2026-08-02)

Five pedals render as category rectangles because the background knockout in
`scraper/mirror-pedal-images.js` cannot cut them out: Strymon Timeline, Strymon
BigSky, BOSS DM-2W, EHX Big Muff Pi, Klon Centaur.

Klon is a licence problem (CC BY-SA, mirroring makes a derivative) and is out of
scope here. Big Muff is a source problem — only angled shots are published. The
other three are **algorithm** problems, and this is the plan for them.

Ordered by what it costs to be wrong. Every claim is tied to a measurement or a
code trace taken 2026-08-02.

---

## What the knockout does today

`mirror-pedal-images.js:294-400`. Flood fill inward from every border pixel:

```js
const BG_TOL = 35;           // per-channel window around the border average
const BG_GRAD_TOL = 12;      // per-channel step allowed between chained pixels
const BG_GRAD_MIN_LUM = 90;  // gradient-following never enters darker than this
const MAX_CENTRE_KNOCK_SHARE = 0.02;
```

A pixel is absorbed if it is within `BG_TOL` of the border average (`isBg`), or
if it `chains()` — continues a smooth, LIGHT gradient from an already-absorbed
neighbour. Chaining exists because studio backdrops ramp 240→110, far wider than
`BG_TOL`. Two safety nets: images already carrying an alpha silhouette bail out
untouched (`already-cutout`, `:322`), and a fill reaching >2% of the centre-20%
box is rejected as having eaten the subject (`:391`).

---

## Failure 1 — the fill walks INTO bright pedal features *(DM-2W)*

**Measured.** Mirrored DM-2W, alpha coverage by band:

```
top 10%   27.4%        mid 45-55%   97.2%        bottom 10%   57.0%
```

The top of the plate is 70% gone. The owner's words: "its color all cut off on
the top."

**Mechanism.** `chains()` (`:341-347`) admits any neighbour with
`lum >= 90` whose channels are within 12 of the absorbed pixel. A BOSS compact
photographed on white has silver knobs and white legend text at the top, all
`lum > 200`. Where such a feature touches the pedal's edge, the chain steps off
the white backdrop onto the bright feature and keeps walking across the panel —
each step is a small delta, so no single step trips `BG_GRAD_TOL`.

**Why the guard missed it.** `MAX_CENTRE_KNOCK_SHARE` only inspects the centre
20% box. Damage at an EDGE is invisible to it by construction.

## Failure 2 — the fill stops partway and keeps the backdrop *(Timeline, BigSky)*

**Measured.** Mirrored output:

```
             opaque   clear
Timeline      95.3%    4.7%
BigSky        94.2%    5.8%
```

Near-total opacity. The grey backdrop survived as opaque pixels, which on the
board reads as a pedal sitting in a grey box. The owner's words: "gray ovals
under them."

**Mechanism.** `BG_GRAD_MIN_LUM = 90` stops gradient-following at the DARK end
of the ramp. Strymon's backdrop darkens toward the drop shadow beneath the
pedal, crossing below luminance 90 — so the chain halts exactly where the
shadow begins and everything from there inward stays opaque. That is why the
residue is *under* the pedal specifically.

The floor exists for a good reason, recorded at `:288-290`: without it the fill
creeps through a drop shadow into a black enclosure. It is guarding against
Failure 1 in the dark direction.

---

## The fix

### 1. Give the chain a colour test, not just a brightness test *(the core change)*

Both failures are the same missing distinction: **studio backdrops and shadows
are NEUTRAL; pedal features are COLOURED.** The DM-2W's red plate is heavily
saturated. A grey backdrop at luminance 70 is not.

Add a saturation guard to `chains()`:

```js
const sat = (i) => {
  const r = px[i*C], g = px[i*C+1], b = px[i*C+2];
  return Math.max(r,g,b) - Math.min(r,g,b);   // 0 = perfectly neutral
};
const BG_GRAD_MAX_SAT = 24;
```

Chaining then requires `sat(j) <= BG_GRAD_MAX_SAT`. This stops the walk into the
red plate outright — and once colour is doing the work of rejecting the subject,
`BG_GRAD_MIN_LUM` can drop (60, or removed) so the chain can follow a neutral
grey ramp down into the shadow that currently blocks it.

**One change addresses both failures**, and that is the reason to try it first
rather than tuning two constants in opposite directions.

**The risk is the inverse case:** a genuinely grey/silver pedal photographed on
grey. That is precisely the Timeline (silver enclosure) — so if this over-eats,
it will show there, and the guards below are what must catch it.

### 2. Extend the anti-erosion guard from the centre to the EDGES

`MAX_CENTRE_KNOCK_SHARE` cannot see damage at a border, which is where both real
failures landed. Add a per-band check on the FINAL alpha: compute opaque
coverage for the top/bottom/left/right 10% bands and the middle. Reject when any
band falls below ~40% of the middle's coverage.

Against today's numbers: DM-2W top is 27.4% against a middle of 97.2% — 28% of
it, comfortably rejected. Healthy pedals must be re-measured to set the
threshold rather than assuming 40%.

### 3. Add a "background survived" check

Neither guard fires when the fill does too LITTLE. After trimming, sample the
four corner pixels: a real cut-out of a photographed pedal has rounded or
perspective-tapered corners, so at least some corners should be clear. All four
opaque means the backdrop is still there.

Cross-check against the 62 pedals that currently look right before trusting it —
a genuinely rectangular top-down could legitimately fill its own bounding box.

---

## Verification

**The regression corpus already exists: the 62 pedals that currently work.** Any
change here must leave them alone, and that is the gate.

1. Record per-pedal alpha statistics for all 62 today — opaque/partial/clear
   shares and the five band coverages. This is the fingerprint.
2. Make the change. Re-mirror everything with `FORCE=1`.
3. Diff the statistics. Any pedal whose numbers move materially is a
   regression, whatever the three targets do.
4. Only then judge the three targets — and judge them **on the board**, not by
   opening the PNG.

**That last point is not a nicety.** On 2026-08-02 the mirrored Timeline and
DM-2W were called clean after being viewed as files, and both were wrong: a
viewer composites transparency against a light background and hides exactly a
retained grey backdrop and a softly-eroded edge. The owner looking at the actual
board caught both. Measure the alpha channel, then confirm in the app.

`node .claude/scripts/verify-pedal-images.js` is the existing app-level check.

---

## If the algorithm cannot be fixed

Fall back to sources that never need it. **A PNG that already ships an alpha
silhouette bypasses the knockout entirely** (`:322`) — that is why every TC
Electronic entry is clean. Roland publishes exactly such files:

```
static.roland.com/products/ds-1w/images/ds-1w_top.png   200 image/png 365KB
static.roland.com/products/hm-2w/images/hm-2w_top.png   200 image/png 326KB
static.roland.com/products/dm-2w/images/dm-2w_top.png   403   does not exist
```

There is none for the DM-2W and none from Strymon, so this is a fallback for
future pedals rather than a route for these three.

The best sources found for the three are already pinned in `PRODUCT_PAGES`:
Timeline's white-background full top-down and Roland's gallery TOP view of the
DM-2W. BigSky has no better source than the gradient one — a white-background
file exists but is a cropped hero, so its footprint would be wrong.
