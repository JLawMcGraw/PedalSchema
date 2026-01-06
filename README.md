# PedalSchema

A visual pedalboard planning and layout tool for guitarists. Design your pedalboard layout, visualize signal chains, and optimize pedal placement.

## Features

- **Visual Pedalboard Editor** - Drag and drop pedals onto a virtual pedalboard
- **Signal Chain Visualization** - See cable routing between pedals with smart pathfinding
- **Layout Optimization** - Automatically arrange pedals for minimal cable length
- **Effects Loop Support** - Configure and visualize amp effects loop routing
- **Collision Detection** - Prevents pedal overlap and ensures valid layouts
- **Multiple Board Sizes** - Support for various pedalboard dimensions

## Cable Routing

The cable routing system uses intelligent pathfinding to create clean, realistic cable paths:

- **Collision Avoidance** - Cables route around pedals, never through them
- **Same-Row Routing** - Pedals in the same row connect via the center gap between rows
- **Minimal Path Length** - Routes stay close to the board instead of going to the perimeter
- **Jack-Aware Routing** - Cables connect to actual input/output jack positions

## Getting Started

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Supabase** - Authentication and database
- **SVG Rendering** - Canvas-based pedalboard visualization

## Project Structure

```
src/
├── app/                    # Next.js app router pages
├── components/
│   └── editor/
│       └── canvas/         # Pedalboard canvas components
│           ├── board-renderer.tsx
│           ├── pedal-renderer.tsx
│           ├── cable-renderer.tsx  # Smart cable routing
│           └── editor-canvas.tsx
├── lib/
│   └── engine/
│       ├── cables/         # Cable path calculation
│       ├── collision/      # Collision detection
│       └── layout/         # Layout optimization
├── store/                  # Zustand state management
└── types/                  # TypeScript type definitions
```

## Development

```bash
# Type check
npx tsc --noEmit

# Build for production
npm run build

# Run tests
npm test
```

## License

MIT
