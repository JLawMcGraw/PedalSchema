# PedalSchema

A visual pedalboard planning and layout tool for guitarists. Design your pedalboard layout, visualize signal chains, and optimize pedal placement.

## Features

- **Visual Pedalboard Editor** - Drag and drop pedals onto a virtual pedalboard
- **Signal Chain Visualization** - See cable routing between pedals with smart pathfinding
- **Layout Optimization** - Automatically arrange pedals, and say what the arrangement
  traded off ("fewer signal-flow reversals, 91in less cable length")
- **Real Pedal Photos** - Pedals render as background-free silhouettes; custom uploads get
  the same treatment client-side before upload
- **Effects Loop Support** - Configure and visualize amp effects loop routing with dedicated send/return jacks
- **Collision Detection** - Prevents pedal overlap and ensures valid layouts
- **Undo/Redo** - Board edits are reversible, including optimization
- **Multiple Board Sizes** - Support for various pedalboard dimensions
- **Responsive Design** - Works on desktop and mobile with collapsible panels

## Cable Routing

Routing runs in `src/lib/engine`, not in the renderer — the canvas is handed finished
polylines. Two routers, in order:

1. **Lane router** (`engine/lanes`) — a Manhattan corridor model that assigns cables to
   lanes with coordinated spacing, so parallel runs stay individually traceable.
2. **Strategy cascade** (`engine/cables/routing-strategies`) for anything the corridor
   model can't serve — seven rungs, cheapest sufficient first: direct → L-path → channel
   between rows → above → below → safe lane → **A\* as the last resort**, then an
   explicitly invalid path the renderer draws red.

Every cable records which rung produced it, so an unexpected shape is diagnosable without
re-tracing the cascade by hand.

- **Collision Avoidance** - Cables route around every pedal except their own endpoints
- **Standoff Points** - Cables exit a jack perpendicular to the pedal edge before turning
- **Jack-Aware Routing** - Cables connect to actual input/output jack positions
- **Effects Loop Routing** - Amp send/return connections approach pedals through the channel
- **Shared Geometry** - Clearances live in `engine/geometry` as documented contracts, so
  routing, validation and the optimizer cannot disagree about them

## Effects Loop

When an amp with effects loop is selected, the signal chain splits:
- **Front Chain**: Guitar → pedals → Amp Input (bottom jack)
- **Loop Chain**: Amp Send (middle jack) → time/modulation pedals → Amp Return (top jack)

The amp panel visualization shows three jacks (RTN, SND, IN) when effects loop is enabled.

## Getting Started

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Tech Stack

- **Next.js 16** - React framework with App Router
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS v4** - Utility-first styling
- **Supabase** - Authentication and database
- **Zustand** - Lightweight state management
- **SVG Rendering** - Canvas-based pedalboard visualization

## Project Structure

```
src/
├── app/                    # Next.js app router pages
├── components/
│   ├── editor/
│   │   ├── canvas/         # Pedalboard canvas components
│   │   │   ├── board-renderer.tsx
│   │   │   ├── pedal-renderer.tsx
│   │   │   ├── cable-renderer.tsx  # A* pathfinding cable routing
│   │   │   └── editor-canvas.tsx   # Main canvas with amp visualization
│   │   ├── panels/         # Side panels (library, properties, routing)
│   │   └── toolbar/        # Editor toolbar with responsive overflow
│   ├── layout/             # Header, navigation
│   └── ui/                 # Reusable UI components
├── lib/
│   ├── engine/
│   │   ├── geometry/       # Shared clearance constants + intersection math
│   │   ├── topology/       # Signal topology (who connects to whom)
│   │   ├── signal-chain/   # Ordering rules, warnings, suggestions
│   │   ├── cables/         # Cable generation, routing strategies, validation
│   │   ├── lanes/          # Manhattan corridor router
│   │   ├── pathfinding/    # A* grid search (routing's last resort)
│   │   ├── obstacles/      # Obstacle set construction
│   │   ├── collision/      # Collision detection & rail snapping
│   │   └── layout/         # Placement search + routing-aware cost function
│   └── images/             # Background knockout for pedal photos
├── store/                  # Zustand state management (source state + derived)
└── types/                  # TypeScript type definitions
```

## Development

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Build for production
npm run build

# Take verification screenshot
node .claude/scripts/screenshot.js http://localhost:3000/editor/new --auth
```

### Verification scripts

`.claude/scripts/` drives the real app with Playwright. They read the editor's
machine-readable state (`window.__getPedalSchemaSnapshot()`) rather than scraping the DOM,
via the shared helpers in `.claude/scripts/lib/twin.js`.

```bash
node .claude/scripts/verify-twin-parity.js     # twin agrees with what the canvas drew
node .claude/scripts/verify-photo-knockout.js  # photo pipeline, in real Chromium
node .claude/scripts/extract-positions.js      # positions + optimizer rationale
```

## Image Rights

Pedal photographs shown on the board are **mirrored from manufacturer sources** so the
app can render a pedal as a recognisable cut-out instead of a coloured rectangle. They
are used to identify the product being planned. We claim no ownership of them, and the
MIT licence below covers this project's **code, not these images**.

Every image we serve records where it came from. The `pedals` table carries
`image_source_url`, `image_license`, `image_attribution` and `image_fetched_at`
alongside `image_url`, written in the same statement — so there is no row whose origin
we cannot name, and a request about any single photo can be answered directly from the
database.

Two rules follow from that, and the tooling enforces both:

- **Nothing is served without a recorded origin.** `scraper/mirror-pedal-images.js`
  writes provenance with the image and clears it with the image.
- **Encumbered sources are referenced, not copied.** Where a licence would reach our
  output, we store the pointer and no bytes, and the board falls back to a category
  rectangle. The Klon Centaur is the current example: its only good source is CC BY-SA
  2.0, and our pipeline knocks out the background — which would make our copy a
  derivative and pull share-alike onto it. So we link the source and mirror nothing.

**Rights holders:** if you own an image here and want it removed, open an issue or
contact the repository owner. Removal is a single `UPDATE` clearing `image_url` (the
app already renders the fallback for any pedal without a photo), plus dropping the
object from the `pedal-images` bucket. We will also add the source to the mirror
script's exclusion path so it is not re-fetched on the next run.

## License

MIT — covers the code in this repository. See **Image Rights** above for pedal
photographs, which are not ours to license, and `scraper/README.md` for the
specification data.
