# PedalSchema

A visual pedalboard planning and layout tool for guitarists. Design your pedalboard layout, visualize signal chains, and optimize pedal placement.

## Features

- **Visual editor** - drag pedals onto a board; cables are routed between their real jack
  positions as you move them
- **Signal chain** - pedals are ordered by category rules, with warnings and suggestions
- **Optimize** - one button arranges the board and says what it traded off
  ("2 fewer cable crossings, 1in less cable length"). It leaves a legal board alone
  unless the alternative is at least an inch better, and never returns overlapping or
  off-board pedals
- **Cable shopping list** - each cable is listed at the shortest standard length that
  covers the route actually drawn; the CABLE readout is the total of those routes
- **Effects loop, clean or dirty modulation, 4-cable method** - including NS-2 style hub
  pedals with their own send/return loop
- **Power planning** - current draw by voltage, assignment to supply outputs, and
  unknown draws counted as unknown rather than zero
- **Real pedal photos** - rendered as background-free cut-outs (see Image Rights)
- **Undo/redo, conflict-safe saves, public read-only share links** at `/s/[slug]`

## How cables are routed

Routing lives in `src/lib/engine`; the canvas only draws finished paths. Every board is
routed by two routers and one picture is kept:

1. **Lane router** (`engine/lanes`) - a corridor model that seats parallel cables in
   separate lanes, each as close as it can to where its cable is going.
2. **Strategy cascade** (`engine/cables/routing-strategies.ts`) - tries fixed shapes
   cheapest first (facing jacks, straight, L, along a row gap, over, under), then an
   exact search for any legal path, then **around the outside of the board**, and
   finally an explicitly invalid path drawn red.

The kept picture is the better one on, in order: unroutable cables, crossings, cables
drawn too close together, then cable cost (length plus the optimizer's charge for each
detour). The optimizer scores exactly what is drawn. Every cable turns at right angles.

| On the canvas | Meaning |
|---|---|
| solid green | instrument cable - guitar to board, board to amp |
| solid grey | patch cable - pedal to pedal |
| **dashed** | no room between the rows; run this one under or around the board |
| **red** | no route exists at this spacing |

Clearances are shared constants in `engine/geometry`, asserted by test, so the placer,
the router and the optimizer cannot disagree about how much room a cable needs. The
2026-11 audit of this pipeline, with every measurement behind it, is in
`.claude/docs/audit-2026-11-16.md`.

## Getting Started

Prerequisites:

- Node.js 20.9 or newer (required by the installed Next.js version)
- A Supabase project

Create the database before starting the app. Apply every SQL file in
`supabase/migrations/` in filename order to a new Supabase project. The migrations
create the schema, RLS policies, seed catalogue, image bucket, power-supply tables, and
the revision-aware `save_configuration` function. This repository is not pre-linked to
a Supabase project, so use either the Supabase SQL editor or link it with the Supabase
CLI first.

```bash
# Install dependencies
npm install

# Configure the app
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

For email confirmations, allow `http://localhost:3000/auth/callback` in the Supabase
Authentication redirect URLs. `SUPABASE_SERVICE_ROLE_KEY`, `VERIFY_EMAIL`, and
`VERIFY_PASSWORD` are only needed by scraper and browser-verification tooling; the app
must never receive the service-role key.

Guest editing is off by default. To enable it, turn on anonymous sign-ins in Supabase
Authentication and set `NEXT_PUBLIC_ANONYMOUS_EDITOR=true`. Both settings are required;
otherwise the landing page directs visitors to sign up.

## Tech Stack

- **Next.js 16** - React framework with App Router
- **React 19** - UI runtime
- **TypeScript** - Type-safe development
- **Tailwind CSS v4** - Utility-first styling
- **Supabase** - Authentication and database
- **Zustand** - Lightweight state management
- **SVG Rendering** - SVG-based pedalboard, pedal, jack, and cable visualization

## Project Structure

```
.
├── src/
│   ├── app/                    # Next.js App Router pages
│   ├── components/
│   │   ├── editor/
│   │   │   ├── canvas/         # Pedalboard SVG components
│   │   │   │   ├── board-renderer.tsx
│   │   │   │   ├── pedal-renderer.tsx
│   │   │   │   ├── cable-renderer.tsx  # Draws finished polylines; does no routing
│   │   │   │   └── editor-canvas.tsx   # Main SVG with amp visualization
│   │   │   ├── panels/         # Side panels (library, properties, routing)
│   │   │   └── toolbar/        # Editor toolbar with responsive overflow
│   │   ├── layout/             # Header and navigation
│   │   └── ui/                 # Reusable UI components
│   ├── lib/
│   │   ├── engine/
│   │   │   ├── geometry/       # Shared clearance constants and intersection math
│   │   │   ├── topology/       # Signal topology (who connects to whom)
│   │   │   ├── signal-chain/   # Ordering rules, warnings, and suggestions
│   │   │   ├── cables/         # Cable list and lengths, routing strategies, validation
│   │   │   ├── lanes/          # Manhattan corridor router
│   │   │   ├── pathfinding/    # Exact orthogonal search; jack standoff points
│   │   │   ├── obstacles/      # Obstacle-set construction
│   │   │   ├── collision/      # Collision detection and rail snapping
│   │   │   ├── power/          # Current totals and supply-output planning
│   │   │   └── layout/         # Placement search and routing-aware cost function
│   │   └── images/             # Background knockout for pedal photos
│   ├── store/                  # Zustand source and derived state
│   └── types/                  # TypeScript domain types
├── supabase/migrations/        # Ordered schema, policies, seed data, and RPCs
├── scraper/                    # Catalogue import and image-mirroring tools
└── .claude/scripts/            # Playwright and regression verification gates
```

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Lint source and scripts
npm run lint

# Find unused files, exports, and dependencies
npm run check:dead-code

# Build for production
npm run build
```

The production build uses `next/font/google`, so its first run needs access to Google
Fonts unless the Geist font response is already cached.

### Browser verification

`.claude/scripts/` drives the real app with Playwright and reads the editor's
machine-readable state (`window.__getPedalSchemaSnapshot()`) rather than scraping the DOM.

```bash
npx playwright install chromium            # once
bash .claude/scripts/verify-all.sh         # every read-only gate; dev server must be running
bash .claude/scripts/verify-all.sh --all   # also gates that write temporary data and restore it
```

Authenticated gates sign in with `VERIFY_EMAIL` / `VERIFY_PASSWORD` from `.env.local`;
database-level gates also need `SUPABASE_SERVICE_ROLE_KEY`. These run against your real
Supabase project, so mind its request quota.

## Image Rights

Pedal, amp and board photographs are **mirrored from manufacturer sources** so the app
can show a recognisable product instead of a coloured rectangle. They identify the
product being planned; we claim no ownership of them, and the MIT licence covers this
project's **code, not these images**.

Every served image records its origin: the `pedals`, `amps` and `boards` tables carry
`image_source_url`, `image_license`, `image_attribution` and `image_fetched_at`, written
in the same statement as `image_url`. The mirror scripts (`scraper/mirror-*.js`) enforce
three rules:

- **Nothing is served without a recorded origin.**
- **Encumbered sources are referenced, not copied.** The Klon Centaur's only good photo
  is CC BY-SA 2.0, and our background knockout would make a derivative, so we store the
  link and no bytes.
- **Only the manufacturer's own photograph** - never a third party's render, and never a
  similar product's photo when none exists (the item renders as text instead).

**Rights holders:** if you own an image here and want it removed, open an issue or
contact the repository owner. Removal clears `image_url` on the row (the app already
renders a fallback) and drops the object from the `pedal-images` bucket, and the source
is excluded from future mirror runs.

## License

MIT — covers the code in this repository. See **Image Rights** above for pedal
photographs, which are not ours to license, and `scraper/README.md` for the
specification data.
