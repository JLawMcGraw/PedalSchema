# Audio simulation — long-scope implementation plan

**Status:** Proposed, 2026-08-27.

**Goal:** Add a browser-based, high-quality pedalboard audition system to
PedalSchema. A user should be able to hear the configured signal chain from a
licensed dry guitar loop, a local DI recording, or a live audio interface;
operate pedal bypass and controls; hear front-of-amp, effects-loop, pedal-loop,
and four-cable routing; save the complete sonic configuration; and eventually
render or share a deterministic preview.

**Product position:** Call the first releases **tone audition**, not exact pedal
emulation. Every processor must identify its fidelity as a generic category
model, a pedal-family approximation, or a calibrated model/capture. Do not imply
that an approximation is official or indistinguishable from the named product.

**Architecture:** The existing signal topology remains the single source of
truth. Audio is a new consumer of `deriveSignalTopology`, alongside cable
calculation, routing cost, and placement. It must not infer chain order from the
SVG paths or create a second topology policy.

**Tech direction:** Next.js client UI, Zustand source state, native Web Audio for
graph management and standard nodes, AudioWorklet plus precompiled Faust/WASM
for custom DSP, Supabase for versioned model metadata and saved parameters, and
`OfflineAudioContext` or an equivalent processor path for deterministic exports
and automated DSP tests.

---

## 1. Desired end state

A user can:

- Play a licensed dry guitar or bass performance through the current board.
- Upload a local DI recording and process it without sending it to a server.
- Connect a high-impedance audio interface and monitor live input.
- Hear chain order, bypass, pedal controls, amp settings, effects-loop
  placement, and four-cable routing change the result in real time.
- A/B dry against processed audio, and compare two board revisions with the
  same source performance.
- Save pedal controls, amp controls, cabinet choice, model versions, and audio
  input preset with the board.
- Export a processed WAV and, where every asset permits it, publish a short
  stock-DI preview on a board's share page.
- See whether each sound is generic, family-level, or calibrated and read its
  provenance and limitations.

The system is not intended to become a DAW, host VST/AU plugins in the browser,
or promise a complete exact model of every catalogue pedal at launch.

---

## 2. Architectural contract

```text
Zustand board state
        |
        v
deriveSignalTopology()             versioned audio-model registry
        |                                      |
        v                                      v
audio topology compiler  <---------- asset/model loader
        |
        v
crossfaded Web Audio graph
        |
        +--> pedal DSP
        +--> amp preamp
        +--> amp effects loop
        +--> power stage / cabinet IR
        |
        v
limiter --> meter --> recorder and/or audio destination
```

### Fixed decisions

1. **Browser-first and client-side.** Live input, user uploads, and normal
   audition processing stay on the device.
2. **One topology.** `src/lib/engine/topology/index.ts` remains authoritative
   for standard, pedal-loop, and four-cable signal flow.
3. **Mono first.** Stereo waits until the jack model records channel and group
   semantics; the current repeated input/output rows do not provide enough
   information to construct a reliable stereo graph.
4. **Amp and cabinet are mandatory.** Raw drive processing into a browser
   speaker is not an honest preview of a guitar rig.
5. **Immutable model versions.** A saved board pins the processor version that
   made its sound. Upgrades are explicit.
6. **Named fallbacks.** A pedal with no dedicated model uses an openly labelled
   category processor, such as `Generic overdrive preview`.
7. **Safe output.** The engine starts muted, has a master limiter, smooths all
   gain changes, and gives the user an immediate mute control.
8. **No silent fidelity claims.** Model class, provenance, calibration, and
   limitations are data, not marketing copy assembled in the UI.

---

## 3. Delivery roadmap

| Milestone | Scope | Exit gate | Estimate |
|---|---|---|---|
| 0. DSP spike | One dry DI, drive, modulation, delay, amp, and cabinet | The existing clean/dirty modulation switch makes an audible, click-free difference | 2–3 weeks |
| 1. Audio runtime | Topology compiler, asset loader, graph lifecycle, parameter smoothing, meters, bypass | Standard and effects-loop audio graphs agree with the visual chain | 3–4 weeks |
| 2. Category MVP | Generic processors, licensed stock DI set, Audition drawer | A typical 6–10 pedal board plays reliably on baseline hardware | 4–6 weeks |
| 3. Persistence | Versioned schema, saved controls, atomic save, undo/redo | Reopening a board restores the same settings and model versions | 3–5 weeks |
| 4. Live input | Device selection, calibration, latency and safety controls | A guitar interface can be monitored without feedback, unwanted browser processing, or clipping | 3–4 weeks |
| 5. Fidelity programme | Pedal-family models, amp profiles, cabinet library, calibrated references | Priority catalogue entries pass engineering and player listening gates | 8–16 weeks initially, then ongoing |
| 6. Advanced routing | Four-cable gating, parallel loops, stereo, expression, tempo | Audio supports every routing mode the editor claims to support | 4–8 weeks |
| 7. Export and sharing | Offline rendering, WAV export, licensed share previews | A shared board can render a repeatable preview with complete provenance | 3–5 weeks |
| 8. Hardening and beta | Browser matrix, CPU fallbacks, accessibility, beta programme | Public-beta quality with documented compatibility and fidelity | 4–6 weeks |

With one frontend/audio engineer, one DSP engineer, and part-time audio-content
support, a useful public version is roughly a 6–9 month programme. Solo delivery
is more realistically 9–15 months. Dedicated named models remain an ongoing
catalogue programme after launch.

---

## 4. Milestone 0 — technical and product spike

Build one narrow vertical slice without changing the persisted board schema:

- One redistributable clean DI guitar loop.
- One generic mid-forward overdrive.
- One phaser or chorus.
- One feedback delay.
- Clean and driven amp profiles.
- One redistributable cabinet impulse response.
- Play, pause, dry/processed A/B, output meter, and master mute.
- Automatic rebuild from the current chain and modulation placement.

The spike must answer:

- Can precompiled Faust/WASM processors be loaded cleanly by the current
  Next.js client bundle?
- What are cold and cached time-to-first-sound?
- How many processors fit within the target CPU budget?
- Can an old graph be replaced with a new graph using a short crossfade with no
  pop, dropout, doubled delay tail, or leaked node?
- Can the same processors render offline for tests and exports?
- Does Safari require a separate processor or loading path?

### Spike exit gate

Use the existing dirty/clean modulation control as the proof. With the same DI,
controls, amp, and cabinet, moving modulation before the drive versus after the
preamp must create an obvious and stable audible difference. If this does not
sound credible, stop before database or catalogue work.

---

## 5. Milestone 1 — audio runtime foundation

Create a framework-independent client package:

```text
src/lib/audio/
  engine/
  topology-compiler/
  graph-manager/
  processors/
  sources/
  transport/
  metering/
  assets/
  offline/
  testing/
```

### Responsibilities

- Convert `SignalTopology` segments and anchors into audio nodes.
- Insert implicit amp internals between amp input, send, return, power stage,
  and cabinet.
- Maintain one `AudioContext` per mounted editor, created only after a user
  gesture.
- Lazy-load worklets, WASM modules, cabinet IRs, and stock audio.
- Build replacement graphs muted, warm them, crossfade, and dispose the old
  graph deterministically.
- Smooth parameter changes and use a short equal-power bypass crossfade.
- Suspend processors that are truly unused without incorrectly removing a
  bypassed physical pedal from power calculations or saved board state.
- Provide meters, clipping state, dropout state, graph diagnostics, and a
  master limiter/mute.
- Choose a documented fallback when an asset, processor, or browser feature is
  unavailable.

### Pure compiler boundary

The topology compiler must be pure and testable without an `AudioContext`. Its
output is a declarative audio plan: sources, processors, ports, implicit amp
blocks, connections, channel counts, pinned model versions, and parameter
values. The graph manager realizes that plan in Web Audio.

This boundary prevents browser lifecycle concerns from contaminating signal
semantics and gives the unit suite a direct way to prove that the audio chain
agrees with the cable topology.

---

## 6. Milestone 2 — category-level MVP

### Initial processor coverage

| Category | Initial behaviour |
|---|---|
| tuner | Pass-through or muted tuning mode; no pitch correction |
| utility | Pass-through with level or routing where defined |
| compressor | Threshold, ratio/amount, attack/release, level |
| filter | Wah/envelope-filter family with frequency or treadle position |
| boost | Clean or lightly coloured gain stage |
| overdrive | Oversampled soft clipping plus pre/post EQ |
| distortion | Harder nonlinear stage plus tone filter |
| fuzz | Distinct asymmetric and saturated family profiles |
| noise gate | Threshold, attack, hold, release |
| EQ | Parametric or graphic-band approximation |
| modulation | Chorus, flanger, or phaser family selected by model binding |
| tremolo | Rate, depth, waveform |
| delay | Time, feedback, tone, mix, optional tempo sync |
| reverb | Algorithmic room, plate, spring, and hall families |
| volume | Smoothed gain control |
| looper | Pass-through initially; playback behaviour deferred |
| pitch | Limited or unavailable until a credible low-latency processor exists |
| multi-fx | Explicit generic preset or pass-through, never an invented exact model |

The cabinet convolution follows the amp. A small, high-quality, redistributable
IR set is better than a large set with unclear rights or inconsistent levels.

### Audition UI

Add an `Audition` drawer alongside Cables, Routing, Power, and Properties:

- Play/pause and transport position.
- Input selector: several stock DI loops and later local/live sources.
- Dry/board A/B with loudness-aware comparison.
- Master output and clipping meter.
- Current amp and cabinet identity.
- Quality mode and CPU/dropout warning.
- Master mute and headphone guidance.

The selected pedal's Properties drawer gains:

- A footswitch backed by the existing `PlacedPedal.isActive` state.
- Model fidelity label.
- Model-defined controls rendered from a parameter schema.
- Reset-to-default and copy/paste settings.

The canvas pedal should reflect bypass, but audio remains independent of SVG
rendering.

---

## 7. Milestone 3 — persistent, versioned sound state

Do not place processor internals directly on physical pedal rows. Use reusable,
versioned records so multiple pedals can share an algorithm and saved boards
can pin immutable behaviour.

### Proposed catalogue schema

```text
audio_models
  id
  kind                    pedal | amp | cabinet | utility
  name
  fidelity_class          generic | family | calibrated | capture

audio_model_versions
  id
  audio_model_id
  version
  engine                  web_audio | faust_wasm | neural
  processor_asset_id
  parameter_schema
  default_parameters
  sample_rates
  channel_count
  input_calibration
  limitations
  released_at
  retired_at

audio_assets
  id
  kind                    wasm | ir | model | stock_di
  url
  content_hash
  byte_size
  source_url
  licence
  attribution
  acquired_at

pedal_audio_bindings
  pedal_id
  audio_model_id
  default_version_id
  parameter_mapping

amp_audio_bindings
  amp_id
  audio_model_id
  default_version_id
  parameter_mapping
```

### Proposed configuration state

```text
configuration_pedals
  audio_model_version_id
  audio_parameters JSONB

configurations
  amp_audio_model_version_id
  amp_audio_parameters JSONB
  cab_audio_model_version_id
  cab_audio_parameters JSONB
  audio_input_preset JSONB
```

The exact column/table split may change after the spike, but these invariants do
not:

- The version that produced a saved board's sound is recoverable.
- Parameter payloads validate against the pinned version's schema.
- Audio state participates in the revision-aware atomic save.
- Pedal controls, bypass, amp/cab selection, and audio routing participate in
  undo/redo and dirty-state reporting.
- Upgrading model versions is an explicit, reversible board edit.
- Missing or retired versions resolve to a visible fallback, never silently to
  a new version.

Custom pedals default to a category model. Users may choose another compatible
family model, but may not overwrite system catalogue bindings.

---

## 8. Milestone 4 — live and local input

Support input modes in this order:

1. Licensed built-in dry DI.
2. Local user file decoded and processed in memory.
3. Live audio interface through `getUserMedia`.

### Live-mode requirements

- Input device and channel selection.
- Input trim and calibration assistant.
- Prefer disabling echo cancellation, noise suppression, and automatic gain
  control where the browser and device permit it.
- Measured or clearly estimated input/output latency.
- Input clipping, output clipping, and dropout indicators.
- Feedback warning and headphones-first onboarding.
- Immediate mute that does not depend on React rendering.
- Clean shutdown of media tracks and device indicators.
- No recording, upload, or persistence of live input without an explicit user
  action.

Live input is desktop-first. Mobile remains stock/local audition until hardware,
latency, backgrounding, and route-change behaviour are measured on real devices.

---

## 9. Milestone 5 — fidelity and catalogue programme

### Fidelity classes

1. **Generic category model:** demonstrates category and signal-order effects.
2. **Pedal-family approximation:** models a recognizable circuit or algorithm
   family with meaningful controls.
3. **Calibrated model:** validated against owned hardware measurements across
   its useful control range.
4. **Capture:** a model trained from a documented reamp process, often limited
   to the captured operating point unless the format explicitly supports
   conditioning.

### Priority order

Build by actual board usage and product value, not alphabetically:

1. Mid-forward overdrive family.
2. Filtered hard-clipping distortion family.
3. Muff-style and pickup-sensitive fuzz families.
4. Common compressors, wah, EQ, and noise gates.
5. Analog, tape-style, and clean digital delay families.
6. Chorus, phaser, flanger, and tremolo families.
7. Clean American, British crunch, and modern high-gain amp families.
8. Cabinet and microphone combinations.
9. Spring, plate, room, hall, and ambient reverbs.
10. Complex pitch, stereo, and multi-effects models.

### Model card and acceptance evidence

Every family or calibrated model records:

- Intended behaviour and excluded claims.
- Engine, version, and content hash.
- Input/output calibration and reference sample rate.
- Supported controls and how UI values map to DSP parameters.
- Reference hardware, circuit source, or capture procedure.
- Licence, attribution, and redistribution rights for code and assets.
- Golden input/output measurements.
- Listening-test result and known audible mismatches.

Use owned or commissioned captures, original DSP, and appropriately licensed
assets. Apply the same provenance discipline already used for gear images.

---

## 10. Milestone 6 — advanced routing and physical realism

Implement only after mono standard chains and effects loops are stable:

- NS-2-style loop gating with a correct detector/control path.
- Full four-cable placement of the amp preamp inside the gate loop.
- Series, parallel, and switchable effects-loop semantics, including dry/wet
  mix for a parallel loop.
- Stereo channel and jack-group semantics in catalogue and configuration data.
- Stereo-capable topology compilation and graceful mono/stereo adaptation.
- Tempo synchronization and tap tempo.
- Expression-pedal automation.
- Delay/reverb spillover policy on bypass.
- Functional looper playback and overdub behaviour if product research proves
  it belongs in PedalSchema rather than a DAW.

### Cable-tone opportunity

PedalSchema already calculates cable lengths, so a later optional model can
make physical planning audible:

- Selectable generic cable capacitance per foot.
- Guitar pickup/source impedance preset.
- True-bypass versus buffered-bypass behaviour.
- Buffer input/output impedance.
- Frequency-response change from the accumulated cable run.

This would make cable length and buffer placement part of the audition, but it
must be calibrated and labelled as an estimate. Do not synthesize power-supply
hum or ground noise from planning metadata unless measured data can support the
result; educational warnings are more honest than invented noise.

---

## 11. Milestone 7 — offline rendering, export, and sharing

The offline path must use the same processor implementations and pinned model
versions as real-time playback.

Features:

- Render a stock DI through the current board.
- Export WAV with source, sample rate, and model-version metadata.
- Render two revisions from the same source for comparison.
- Generate a short share-page preview only when every source, processor asset,
  model, and IR permits redistribution.
- Keep local uploads and live recordings client-side unless the user explicitly
  chooses an upload/export workflow.
- Name fallbacks and missing assets in the exported report.

Stock DI is the default shared source so two boards can be compared with the
same performance and no user-owned audio needs to be published.

---

## 12. Verification strategy

### Unit and property tests

- Audio topology plan matches standard, effects-loop, pedal-loop, and
  four-cable fixtures already used by the routing engine.
- Every graph has a source-to-destination path and no unintended feedback
  cycle.
- Bypassed pedals remain in the physical topology but use the correct audio
  bypass path.
- Parameter values validate, clamp, serialize, and migrate.
- Processor output contains no NaN, infinity, runaway DC, or denormal storm.
- Silence in produces bounded silence/noise out according to the processor's
  declared contract.
- Gain, frequency response, delay timing, modulation rate, envelope, and tail
  length remain within model-specific tolerances.

### Offline golden renders

Use impulses, sine sweeps, multitone signals, noise, calibrated DI phrases, and
transient-heavy guitar samples. Prefer toleranced acoustic measurements over
byte snapshots where browser or floating-point implementations may differ.

Every model version receives immutable golden evidence. A deliberate change
creates a new model version instead of rewriting the old evidence.

### Browser gates

- Audio starts only after a user gesture.
- Cold/cached assets reach ready state within budget.
- Graph rebuilds and bypass changes are click-free.
- Device permissions, denial, device removal, and route changes fail safely.
- Meters, master mute, and cleanup agree with the real audio state.
- Current Chrome, Firefox, Safari, and Edge are covered; mobile is reported
  separately.

### Listening gates

- Internal engineering review for obvious instability, aliasing, gain mismatch,
  and incorrect control direction.
- Guitarist panel for usefulness and family recognition.
- Controlled A/B or MUSHRA-style tests for calibrated models where reference
  recordings permit them.
- Loudness-match comparisons so louder is not mistaken for more accurate.

---

## 13. Performance, safety, and accessibility budgets

Set exact numbers during the spike on named baseline hardware. The release
contract must cover:

- Cold and cached time-to-first-sound.
- Graph rebuild and parameter response time.
- DSP CPU for a representative 8-pedal board and a dense board.
- Worklet underruns/dropouts during canvas interaction and Optimize.
- Live round-trip latency, reported rather than hidden when the hardware or
  browser misses the target.
- Peak output and limiter behaviour.
- Memory after repeated graph rebuilds and board navigation.

Adaptive quality may reduce oversampling, reverb complexity, or neural-model
count, but it must display the active quality tier. It may never silently alter
saved parameter values.

All controls need keyboard access, programmatic labels, numeric values, reset
behaviour, and a non-audio explanation. Meters cannot communicate clipping or
quality by colour alone.

---

## 14. Principal risks and mitigations

| Risk | Mitigation |
|---|---|
| Fidelity scope expands without bound | Ship category and family models incrementally; publish fidelity labels |
| Browser latency disappoints live players | Make stock/local audition universal; report measured live latency |
| Dense boards overload CPU | Lazy loading, bypass suspension, quality tiers, processor budgets, graceful fallback |
| Graph changes pop or leak tails | Warm replacement graph, parameter smoothing, short crossfade, deterministic disposal |
| Feedback or dangerous peaks | Muted startup, limiter, immediate mute, meters, headphone onboarding |
| Model or IR rights are unclear | Immutable provenance and licence records; do not ship an asset without them |
| Model updates alter saved boards | Pin immutable versions and make upgrades explicit/reversible |
| Audio topology drifts from visual topology | Compile directly from `deriveSignalTopology`; fixture parity gates |
| Custom pedals imply false accuracy | Visible category fallback and user-selectable compatible family models |
| Stereo data is ambiguous | Stay mono until channel/group semantics exist in the domain model |
| Browser support differs | Compatibility matrix, capability detection, named fallback, desktop-first live mode |

---

## 15. Release sequence

1. **Internal prototype:** dirty versus clean modulation on one stock DI.
2. **Staff alpha:** generic category effects, stock DI, standard and effects-loop
   topology, no persistence promise.
3. **Closed guitarist beta:** persisted controls, amp/cab selection, local files,
   live desktop input, and model diagnostics.
4. **Public beta:** selected pedal-family models, compatibility reporting,
   versioned saves, and clear fidelity labels.
5. **Version 1:** share audition/export, advanced routing, calibrated priority
   catalogue, accessibility and performance contracts.

The first durable investment is the topology-driven audio runtime and immutable
model-version contract. Individual pedal, amp, and cabinet models can then be
added continuously without reworking the editor or invalidating saved boards.

---

## 16. Immediate next tasks

1. Write a short spike RFC that names the baseline browsers/hardware, target DI,
   chosen Faust/WASM loading approach, and redistributable cabinet IR.
2. Build the pure audio-topology-plan types and parity fixtures without creating
   an `AudioContext`.
3. Implement the client audio lifecycle with source, master mute, limiter,
   meter, and deterministic disposal.
4. Add the five spike processors and wire them to current board state using
   hard-coded defaults.
5. Demonstrate the dirty/clean modulation A/B and record CPU, load time,
   latency, graph-swap, and browser results.
6. Use those measurements to accept or revise the data model and milestone
   estimates before starting persistence work.
