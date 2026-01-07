# PedalSchema

A visual pedalboard planning and layout tool for guitarists. Design your pedalboard layout, visualize signal chains, and optimize pedal placement.

## Features

- **Visual Pedalboard Editor** - Drag and drop pedals onto a virtual pedalboard
- **Signal Chain Visualization** - See cable routing between pedals with smart pathfinding
- **Layout Optimization** - Automatically arrange pedals for minimal cable length
- **Effects Loop Support** - Configure and visualize amp effects loop routing with dedicated send/return jacks
- **Collision Detection** - Prevents pedal overlap and ensures valid layouts
- **Multiple Board Sizes** - Support for various pedalboard dimensions
- **Responsive Design** - Works on desktop and mobile with collapsible panels

## Cable Routing

The cable routing system uses intelligent A* pathfinding to create clean, realistic cable paths:

- **Collision Avoidance** - Cables route around pedals using grid-based pathfinding
- **Channel Routing** - Cables utilize the open channel between pedal rows
- **Standoff Points** - Cables exit pedals cleanly before routing to avoid visual overlap
- **Jack-Aware Routing** - Cables connect to actual input/output jack positions
- **Effects Loop Routing** - Amp send/return connections route through the channel, approaching pedals from below

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
│   └── engine/
│       ├── cables/         # Cable generation
│       ├── collision/      # Collision detection & rail snapping
│       └── layout/         # Layout optimization algorithm
├── store/                  # Zustand state management
└── types/                  # TypeScript type definitions
```

## Development

```bash
# Type check
npx tsc --noEmit

# Build for production
npm run build

# Take verification screenshot
node .claude/scripts/screenshot.js http://localhost:3000/editor/new --auth
```

## License

MIT
