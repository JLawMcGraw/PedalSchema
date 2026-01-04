# PedalSchema

## Product Description

---

## Overview

PedalSchema is a visual pedalboard planning tool that helps guitarists and bassists design, arrange, and optimize their effects pedal setups. Users select their pedalboard, add their pedals from a database, and the software arranges them in optimal signal chain order while ensuring everything physically fits. The tool generates wiring diagrams, cable lists, and identifies potential issues.

---

## Problems It Solves

### 1. Signal Chain Order

Pedal order affects tone and noise. The rules are context-dependent:

- Wah before or after drive?
- Where does the noise gate go?
- Which pedals belong in the effects loop?
- How do you wire a 4-cable method noise gate?

This knowledge is scattered across forums, YouTube, and years of accumulated experience. PedalSchema encodes signal chain best practices into software and explains the reasoning behind each placement.

### 2. Physical Space Constraints

Pedals have inconsistent dimensions. A wah pedal is 10 inches deep. A board is 12.5 inches deep. Will it fit? Will it overlap with other pedals? Where do the jacks end up?

PedalSchema models actual physical dimensions with collision detection. It knows what fits before you start building.

### 3. Effects Loop Routing

Many guitarists don't understand effects loops or how to wire them. Advanced techniques like the 4-cable method require specific routing that's difficult to visualize.

PedalSchema understands effects loops and generates complete wiring diagrams showing front-of-amp connections and effects loop connections as an integrated system.

### 4. Cable Requirements

Without planning, builders end up with cables that are too short, too long, or the wrong quantity. PedalSchema calculates exact cable requirements based on pedal positions and jack locations.

### 5. Noise Issues

Noise comes from improper signal chain order, ground loops, and pedal interactions. PedalSchema identifies potential noise sources and suggests solutions like reordering, noise gates, or isolated power.

---

## Core Features

### Pedalboard Library

Pre-loaded dimensions for pedalboard manufacturers:

- Pedaltrain (all models)
- Temple Audio
- Blackbird
- Schmidt Array
- Creation Music Company
- Custom dimension input

Each board includes:
- Overall dimensions
- Rail positions and spacing
- Usable surface area
- Under-board clearance for power supplies

### Pedal Database

Database of effects pedals with:

- Width, depth, height
- Jack positions (input, output, power, expression, MIDI)
- Jack orientation (top, side)
- Footswitch positions
- Power requirements (voltage, current draw, polarity)
- Pedal category (drive, modulation, delay, etc.)
- Signal chain placement rules
- Known issues and interactions

Users can add custom pedals not in the database.

### Signal Chain Engine

Rules-based system that determines optimal pedal order:

**Standard Signal Chain:**
1. Tuner
2. Filters (wah, envelope filter)
3. Compressor
4. Pitch (octave, whammy)
5. Drive (overdrive, distortion, fuzz)
6. Noise gate
7. Modulation (chorus, flanger, phaser, tremolo)
8. Delay
9. Reverb
10. Volume pedal
11. Looper

**Effects Loop Logic:**
- Identifies which pedals benefit from post-preamp placement
- Handles series vs. parallel loop differences
- Routes noise gates using 4-cable method when appropriate

**Special Cases:**
- Fuzz pedals that need direct pickup signal
- Buffer placement for cable runs
- Stereo signal paths

The engine suggests optimal order but allows manual override with explanations of tradeoffs.

### Visual Layout Editor

Drag-and-drop interface showing:

- Board dimensions with rail positions to scale
- Pedals rendered at accurate dimensions
- Color-coded signal flow paths
- Collision detection warnings
- Cable routing visualization

### Wiring Diagram Generator

Produces diagrams showing:

- Connections between pedals
- Effects loop wiring with amp-specific jack labels
- Power supply connections
- Cable identification for build reference
- Step-by-step wiring sequence

### Cable List Generator

Outputs:

- Patch cables by length
- Power cables by type
- Instrument cables for amp connections
- Total quantities needed

### Optimization Suggestions

Recommendations based on the current configuration:

- Space utilization ("2 inches unused — these pedals would fit")
- Signal chain improvements ("buffer recommended here")
- Noise reduction ("this order may cause noise — consider reordering")
- Power capacity ("supply at 80% capacity")

---

## Data Model

### Board

```
board:
  name: "Pedaltrain Classic Jr"
  width: 18 inches
  depth: 12.5 inches
  rails:
    - position: 0 inches (back)
    - position: 3.1 inches
    - position: 6.2 inches
    - position: 9.3 inches (front)
  rail_width: 0.6 inches
  clearance_under: 3.5 inches
```

### Pedal

```
pedal:
  name: "BOSS NS-2"
  manufacturer: "BOSS"
  category: "noise_gate"
  dimensions:
    width: 2.9 inches
    depth: 5.1 inches
    height: 2.4 inches
  jacks:
    input: { side: "right", position: 50% }
    output: { side: "left", position: 50% }
    send: { side: "right", position: 25% }
    return: { side: "left", position: 25% }
    power: { side: "top", position: 50% }
  power:
    voltage: 9V
    current: 20mA
    polarity: "center_negative"
  chain_rules:
    position: "after_drive"
    supports_4_cable: true
    effects_loop_compatible: true
```

### Amp

```
amp:
  name: "Fender Blues Deluxe"
  has_effects_loop: true
  loop_type: "series"
  loop_level: "instrument"
  jacks:
    send: "PREAMP OUT"
    return: "POWER AMP IN"
```

### Configuration

```
configuration:
  board: "Pedaltrain Classic Jr"
  amp: "Fender Blues Deluxe"
  pedals:
    - pedal: "Cry Baby Wah"
      position: { x: 0, y: 6.2 }
      rotation: 0
      chain_position: 1
      location: "front_of_amp"
    - pedal: "BOSS NS-2"
      position: { x: 14, y: 0 }
      rotation: 0
      chain_position: 2
      location: "4_cable_hub"
  cables:
    - from: "guitar"
      to: "NS-2 input"
      length: 10ft
    - from: "NS-2 send"
      to: "Cry Baby input"
      length: 12in
```

---

## User Workflows

### Planning a New Board

1. User selects board model (or enters custom dimensions)
2. User adds pedals from database or creates custom entries
3. User selects amp (for effects loop configuration)
4. Software auto-arranges pedals by signal chain rules
5. Software checks physical fit and flags collisions
6. User adjusts positions manually if needed
7. Software generates wiring diagram
8. Software generates cable shopping list
9. User exports/prints build documents

### Adding a Pedal to Existing Setup

1. User loads saved configuration
2. User adds new pedal
3. Software determines optimal chain position
4. Software checks if it physically fits
5. Software shows updated layout and wiring
6. Software shows updated cable requirements

### Troubleshooting Noise

1. User inputs current pedal order
2. Software analyzes chain for noise issues
3. Software identifies likely sources (high-gain pedal placement, missing noise gate, etc.)
4. Software suggests specific fixes
5. User implements changes and updates configuration

---

## Technical Architecture

### Frontend

- SVG-based rendering for accurate scaling
- Coordinate system in real units (inches)
- Drag-and-drop with snap-to-rail
- Pan and zoom for detailed work
- Touch support for tablet use

### Backend

- Pedal database with version control
- User accounts for saved configurations
- Configuration sharing via URL
- Export to PDF/PNG for printing

### Signal Chain Engine

- Rule-based system with priority weights
- Category-based default ordering
- Pedal-specific overrides (fuzz before wah, etc.)
- Effects loop routing logic
- 4-cable method detection and wiring

### Collision Detection

- Bounding box collision for pedals
- Jack clearance checking
- Footswitch accessibility verification
- Rail alignment validation

---

## Goals

1. **Eliminate guesswork** — Users should know exactly what fits and how to wire it before building

2. **Encode expert knowledge** — Signal chain rules and effects loop routing should be built into the software, not researched separately

3. **Generate actionable output** — Wiring diagrams and cable lists should be directly usable during the build

4. **Handle complexity gracefully** — Simple setups should be simple; complex setups (4-cable method, stereo rigs) should be supported without overwhelming basic users

5. **Accurate physical modeling** — Dimensions must be real. Collision detection must work. The layout on screen must match reality.
