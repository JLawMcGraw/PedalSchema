# Phase B - the visual direction, written down

**Status: DECIDED 2026-08-19 by the owner.** This file exists because the
previous definition ("Tactical Telemetry") lived only in an uncommitted
plan-mode approval, was named in five session entries, and could not be
recovered when the time came to build it. That cost a whole session. Anything
in this file that changes gets changed *here*, in the repo.

The governing reference is `.agents/skills/redesign-existing-projects`.
**Re-open it at the start of every UI phase** - reading it once per project is
demonstrably not enough.

---

## The direction: instrument panel

The editor is a data dashboard for a physical object. It should read like the
front of a piece of measuring equipment: a dark substrate, one signal colour,
numbers in a monospace face, hairline rules instead of shadows, and no
decoration that is not carrying information.

    ┌ BOARD ─────────────────── ● LIVE ┐
    │ PEDALS      9    CABLE   142.0in │
    │ DRAW    1240mA   FIT      OK     │
    └──────────────────────────────────┘

### The three answered questions

| Question | Answer |
|---|---|
| Direction | **Instrument panel / HUD** |
| Theme scope | **Dark, committed** - follow the skill's rules for it |
| Icons | **Swap the set** - lucide is the skill's named "default AI choice" |

---

## Rules this direction imposes

1. **One accent, and it is a signal colour.** Signal green. It marks live
   values, the active nav item, the primary action, and nothing else. Today
   the app has *no* accent at all - every semantic token in `globals.css` is
   chroma `0` - so this is the addition, not a replacement.
2. **Committed dark.** The skill: *"Either commit to a full dark mode or keep
   a consistent background tone throughout."* We commit. There is no light
   path to maintain and no toggle to build.
3. **Never pure `#000`.** Off-black, and **tinted cool** - one grey family
   throughout, no warm/cool mixing.
4. **Numbers are monospace and tabular.** Geist Mono is already loaded and
   currently used for almost nothing. Every measured value - inches, mA,
   counts, percentages - is tabular so columns of them line up.
5. **Depth comes from lightness steps and 1px hairlines, not drop shadows.**
   An instrument face has no drop shadows. Where a shadow is unavoidable it is
   tinted to the background hue, never black.
6. **Grain, not gloss.** A fixed, `pointer-events-none` noise overlay at very
   low opacity, to keep large dark areas from reading as flat vector.
7. **Density stays.** The skill's *"double the spacing"* line is scoped in its
   own text to marketing pages: *"Dense layouts work for data dashboards, not
   for marketing pages."* The editor panels are a data dashboard. **A5 tuned
   that density deliberately - do not undo it.**

---

## Palette (dark only)

Cool-tinted neutrals, hue 250. Signal green at hue 152.

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(0.16 0.008 250)` | the substrate |
| `--card` | `oklch(0.205 0.009 250)` | panel face |
| `--popover` | `oklch(0.225 0.010 250)` | floats above panels |
| `--muted` / `--accent` | `oklch(0.27 0.010 250)` | inset / hover surface |
| `--foreground` | `oklch(0.96 0.004 250)` | primary text |
| `--muted-foreground` | `oklch(0.72 0.012 250)` | labels, secondary text |
| `--border` | `oklch(0.32 0.012 250)` | the hairline |
| `--primary` | `oklch(0.80 0.17 152)` | **signal green** |
| `--primary-foreground` | `oklch(0.19 0.04 152)` | ink on green |
| `--destructive` | `oklch(0.66 0.18 25)` | failures only |

Note `--accent` in shadcn is the *hover surface* token, not the brand colour.
The signal green goes on `--primary`. Do not repurpose `--accent`.

Contrast is verified numerically, not by eye - see the phase's session entry.

---

## Phase B work order

Follows the skill's own fix-priority list, skipping step 1 (the font is
already Geist, which is on the skill's recommended list - **do not churn it**).

| Step | What | Status |
|---|---|---|
| B1 | Switch dark on, install the palette | **done** 2026-08-19 - plus the category palette, 18 hues to 4 |
| B2 | Hover / active / focus / transition states | **done** 2026-08-19 |
| B3 | Typography: tabular numerals | **done** 2026-08-19 - set on `body`, inherited |
| B4 | Icon swap off lucide | **done** 2026-08-19 - Phosphor, 14 files, dep dropped |
| B5 | HUD surfaces: hairlines, grain overlay, tinted shadows | **done** 2026-08-19 |
| B6 | Loading / error states (empty states already existed) | **done** 2026-08-19 |

**Phase B is complete.**

Each step ends green on `npx tsc --noEmit`, `npm run build`, `npm test`, and
`.claude/scripts/verify-all.sh --all`. The gates added by Phase B are
`verify-palette`, `verify-nav-state`, `verify-readouts`, `verify-icons`,
`verify-surfaces` and `verify-states` - six, taking the suite from 23 to 29.

## Explicitly out of scope

- **A light theme or a theme toggle.** Decided against above.
- **Changing the font.** Geist stays.
- **Loosening editor panel density.** See rule 7.
- **Touching the canvas geometry.** Cable routing, placement and clearance are
  contract-tested; a restyle does not get to move a pedal by a pixel.

---

## The direction had a source all along (found 2026-08-20)

**`.agents/skills/industrial-brutalist-ui`.** Its title is "Industrial
Brutalism & Tactical Telemetry UI" and its §2.2 is "Tactical Telemetry & CRT
Terminal". That is where the name came from.

Session six searched `.claude/` and `src/`, found nothing, and concluded the
definition did not exist in the repository - which cost a phase and a re-pick.
**It never looked at the skills the project ships with.** If a direction name
turns up undefined again, search `.agents/skills/` first.

What the skill adds beyond what was already built:

| §  | Rule | Status |
|---|---|---|
| 2.2 | dark substrate, phosphor foreground, monospace dominance, dense tabular data | already true |
| 5 | **absolute rejection of border-radius, 90 degrees everywhere** | done 2026-08-20 |
| 3.2 | metadata / navigation / unit IDs in tracked uppercase monospace | done 2026-08-20 |
| 3.1 | macro-typography at `clamp()` scale for structural headers | not applied - see below |
| 6 | ASCII framing, registration marks, `REV` strings | not applied |
| 7 | CRT scanlines, halftone, 1-bit dithering | grain only |

**Deviation from §4, deliberately.** The skill mandates hazard red as the only
accent and permits terminal green for at most one element. This app keeps
signal green: red already means "will not fit" on a cable and "collision" on a
pedal, and promoting it to brand accent would destroy a signal the canvas
depends on. The skill is written for interfaces that carry no error semantics
of their own. The owner also chose green explicitly on 2026-08-19.

**§3.1 is deliberately unapplied in the panels.** Macro-typography at
`clamp(4rem, 10vw, 15rem)` needs a canvas to breathe in; a 287px panel has
none. The honest reading of "extreme scale contrast" at panel width is to push
the LABELS down into the micro register and let the data lead - which is what
the Power panel's 1586 does. If the landing page is ever built, that is where
§3.1 belongs.
