# PedalSchema Optimization System Rebuild Plan

## Executive Summary

The current optimization system attempts to solve pedal placement and cable routing simultaneously, creating an interdependent problem where the cost function changes based on the solution. This document outlines a ground-up rebuild using a phased approach: solve simpler problems first, then compose them into the full solution.

---

## Part 1: Problem Identification

### 1.1 The Core Problem

**What we're trying to do:**
Given N pedals with a defined signal chain order, find physical positions on a pedalboard that minimize total cable length while avoiding collisions.

**Why it's hard:**
The cable length between pedal A and pedal B depends on where pedals C, D, E are placed (they're obstacles). But where C, D, E should go depends on cable lengths to their neighbors. This circular dependency breaks naive optimization.

### 1.2 Current System Failures

| Issue | Symptom | Root Cause |
|-------|---------|------------|
| Messy cables | Cables cross unnecessarily, take long paths | A* runs after placement is finalized; no feedback loop |
| Collision bugs | Pedals overlap or cables clip through pedals | Coordinate system inconsistencies; boundary conditions |
| Suboptimal placement | Pedals not arranged for shortest cables | Optimizer doesn't account for actual routed distance |
| Effects loop chaos | 4-cable method routing looks wrong | Amp position and loop topology not integrated into optimization |
| Performance | Slow with many pedals | A* recalculated for every cable; no caching |

### 1.3 Architectural Problems

1. **Monolithic optimization**: Tries to solve everything at once
2. **Wrong cost function**: Uses Euclidean distance or simplified heuristic instead of actual routed path length
3. **No iterative refinement**: Places pedals once, never improves
4. **Coordinate confusion**: Screen pixels vs. grid cells vs. board inches mixed
5. **Cable routing disconnected from placement**: Two separate systems that don't talk

---

## Part 2: Signal Chain Topology

### 2.1 Supported Topologies (Phased)

**Phase 1: Linear Chain**
```
Guitar → [P1] → [P2] → [P3] → ... → [Pn] → Amp
```
- Single path, no branching
- Every pedal: 1 input, 1 output
- Optimization is placement only

**Phase 2: Effects Loop (4-Cable Method)**
```
Guitar → [Front Chain] → Amp INPUT
                              │
                         Amp SEND → [Loop Chain] → Amp RETURN
```
- Two sub-chains with fixed relationship
- Amp is a multi-port node (IN, SEND, RETURN)
- Optimization must consider amp position

**Phase 3+ (Future): Stereo, Parallel, Switchers**
- Out of scope for rebuild
- Architecture should not preclude these

### 2.2 Signal Chain Data Model

```typescript
// Effect categories with placement intelligence
type EffectCategory = 
  | 'tuner' | 'filter' | 'compressor' | 'pitch'
  | 'drive' | 'eq' | 'gate' | 'modulation'
  | 'delay' | 'reverb' | 'looper' | 'volume' | 'utility';

type DriveLevel = 'boost' | 'low' | 'medium' | 'high' | 'fuzz';

interface PlacementRule {
  defaultSegment: 'front' | 'loop' | 'either';
  defaultOrder: number;                    // 0-100 sort priority
  impedanceSensitive?: boolean;            // must be first (fuzz)
  orderWithinCategory?: number;            // for stacking drives
}

// Canonical placement rules (defaults, not enforced)
const PLACEMENT_RULES: Record<EffectCategory, PlacementRule> = {
  tuner:       { defaultSegment: 'front', defaultOrder: 5 },
  filter:      { defaultSegment: 'front', defaultOrder: 10 },
  pitch:       { defaultSegment: 'front', defaultOrder: 15 },
  compressor:  { defaultSegment: 'front', defaultOrder: 20 },
  drive:       { defaultSegment: 'front', defaultOrder: 30 },
  eq:          { defaultSegment: 'either', defaultOrder: 40 },
  gate:        { defaultSegment: 'front', defaultOrder: 45 },
  modulation:  { defaultSegment: 'loop', defaultOrder: 60 },
  delay:       { defaultSegment: 'loop', defaultOrder: 70 },
  reverb:      { defaultSegment: 'loop', defaultOrder: 80 },
  looper:      { defaultSegment: 'either', defaultOrder: 85 },
  volume:      { defaultSegment: 'either', defaultOrder: 50 },
  utility:     { defaultSegment: 'either', defaultOrder: 0 },
};
```

### 2.3 Pedal Model

```typescript
interface Pedal {
  id: string;
  name: string;
  
  // Physical
  width: number;          // in grid units (not pixels)
  height: number;
  inputJack: JackPosition;   // relative to pedal origin
  outputJack: JackPosition;
  
  // Signal chain
  category: EffectCategory;
  driveLevel?: DriveLevel;
  
  // User overrides
  segmentOverride?: 'front' | 'loop';  // user forced placement
  orderOverride?: number;               // user forced order
  impedanceSensitive: boolean;
}

interface JackPosition {
  side: 'top' | 'right' | 'bottom' | 'left';
  offset: number;  // distance from corner along that side
}
```

### 2.4 Signal Chain Model

```typescript
interface SignalChain {
  topology: 'linear' | 'effects-loop';
  
  // For linear: just one segment
  // For effects-loop: front + loop segments
  segments: ChainSegment[];
  
  // Amp config (null for linear to amp input only)
  ampConfig?: {
    hasEffectsLoop: boolean;
    position: 'right' | 'external';  // on board or off-board
  };
}

interface ChainSegment {
  id: 'front' | 'loop' | 'main';
  pedalIds: string[];  // ordered by signal flow
  startNode: 'guitar' | 'amp-send';
  endNode: 'amp-input' | 'amp-return' | 'amp';
}
```

---

## Part 3: Coordinate System

### 3.1 The Problem

Current code mixes:
- Screen pixels (mouse events, rendering)
- Grid cells (collision, pathfinding)
- Physical units (pedal specs in mm/inches)

This causes off-by-one errors, misaligned collision boxes, and cables that don't connect to jacks.

### 3.2 The Solution: Single Source of Truth

**Grid Units** are the canonical coordinate system.

```typescript
// Configuration
const GRID = {
  cellSize: 10,           // pixels per grid cell (for rendering)
  boardWidth: 60,         // grid cells (e.g., 600px / 10)
  boardHeight: 30,        // grid cells
};

// All positions stored in grid units
interface GridPosition {
  x: number;  // grid cells from left
  y: number;  // grid cells from top
}

// Conversion utilities (used only at boundaries)
const toPixels = (grid: GridPosition): PixelPosition => ({
  x: grid.x * GRID.cellSize,
  y: grid.y * GRID.cellSize,
});

const toGrid = (pixels: PixelPosition): GridPosition => ({
  x: Math.floor(pixels.x / GRID.cellSize),
  y: Math.floor(pixels.y / GRID.cellSize),
});
```

### 3.3 Coordinate Rules

1. **Storage**: Always grid units
2. **Pathfinding**: Grid units
3. **Collision**: Grid units
4. **Rendering**: Convert to pixels at render time only
5. **Mouse input**: Convert from pixels immediately on input
6. **Pedal dimensions**: Defined in grid units

---

## Part 4: Collision System

### 4.1 Requirements

- Pedals cannot overlap
- Pedals must stay within board bounds
- Rails/rows constrain Y positions (optional snap)
- Fast lookup for "what occupies cell X,Y?"

### 4.2 Implementation: Spatial Grid

```typescript
class CollisionGrid {
  private grid: Map<string, string>;  // "x,y" → pedalId
  private pedalCells: Map<string, Set<string>>;  // pedalId → Set of "x,y"
  
  constructor(
    private width: number,
    private height: number
  ) {}
  
  // Register pedal's footprint
  placePedal(id: string, x: number, y: number, w: number, h: number): boolean {
    // Check all cells are free
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const key = `${x + dx},${y + dy}`;
        if (this.grid.has(key)) return false;  // collision
        if (x + dx >= this.width || y + dy >= this.height) return false;  // bounds
      }
    }
    
    // Claim cells
    const cells = new Set<string>();
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const key = `${x + dx},${y + dy}`;
        this.grid.set(key, id);
        cells.add(key);
      }
    }
    this.pedalCells.set(id, cells);
    return true;
  }
  
  removePedal(id: string): void {
    const cells = this.pedalCells.get(id);
    if (cells) {
      cells.forEach(key => this.grid.delete(key));
      this.pedalCells.delete(id);
    }
  }
  
  isOccupied(x: number, y: number): boolean {
    return this.grid.has(`${x},${y}`);
  }
  
  getOccupant(x: number, y: number): string | null {
    return this.grid.get(`${x},${y}`) ?? null;
  }
  
  // For A* pathfinding: get walkable grid
  getObstacleGrid(): boolean[][] {
    const obstacles: boolean[][] = [];
    for (let y = 0; y < this.height; y++) {
      obstacles[y] = [];
      for (let x = 0; x < this.width; x++) {
        obstacles[y][x] = this.grid.has(`${x},${y}`);
      }
    }
    return obstacles;
  }
}
```

### 4.3 Rail Snapping

```typescript
interface RailConfig {
  rows: number[];  // Y positions of rail centers
  snapTolerance: number;  // how close to snap
}

function snapToRail(y: number, config: RailConfig): number {
  let closest = y;
  let minDist = config.snapTolerance + 1;
  
  for (const rail of config.rows) {
    const dist = Math.abs(y - rail);
    if (dist < minDist) {
      minDist = dist;
      closest = rail;
    }
  }
  
  return minDist <= config.snapTolerance ? closest : y;
}
```

---

## Part 5: Cable Routing (A* Pathfinding)

### 5.1 Requirements

- Route from output jack to input jack
- Avoid all pedals (obstacles)
- Prefer horizontal/vertical movement
- Prefer using the channel between rows
- Support cable standoffs (exit pedal before routing)
- Cache paths when obstacles don't change

### 5.2 A* Implementation

```typescript
interface PathNode {
  x: number;
  y: number;
  g: number;  // cost from start
  h: number;  // heuristic to end
  f: number;  // g + h
  parent: PathNode | null;
}

class CableRouter {
  constructor(
    private obstacles: boolean[][],
    private width: number,
    private height: number
  ) {}
  
  findPath(start: GridPosition, end: GridPosition): GridPosition[] | null {
    const openSet = new PriorityQueue<PathNode>();
    const closedSet = new Set<string>();
    
    const startNode: PathNode = {
      x: start.x,
      y: start.y,
      g: 0,
      h: this.heuristic(start, end),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;
    openSet.push(startNode, startNode.f);
    
    while (!openSet.isEmpty()) {
      const current = openSet.pop()!;
      const key = `${current.x},${current.y}`;
      
      if (current.x === end.x && current.y === end.y) {
        return this.reconstructPath(current);
      }
      
      if (closedSet.has(key)) continue;
      closedSet.add(key);
      
      for (const neighbor of this.getNeighbors(current)) {
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;
        if (this.isBlocked(neighbor.x, neighbor.y)) continue;
        
        const g = current.g + this.moveCost(current, neighbor);
        const h = this.heuristic(neighbor, end);
        const f = g + h;
        
        openSet.push({
          x: neighbor.x,
          y: neighbor.y,
          g,
          h,
          f,
          parent: current,
        }, f);
      }
    }
    
    return null;  // no path found
  }
  
  private heuristic(a: GridPosition, b: GridPosition): number {
    // Manhattan distance
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  
  private moveCost(from: PathNode, to: { x: number; y: number }): number {
    // Base cost
    let cost = 1;
    
    // Penalty for diagonal (if allowed)
    if (from.x !== to.x && from.y !== to.y) {
      cost = 1.414;
    }
    
    // Bonus for staying in channel (middle row area)
    // This encourages cables to route through open space
    if (this.isInChannel(to.y)) {
      cost *= 0.8;
    }
    
    return cost;
  }
  
  private isInChannel(y: number): boolean {
    // Define channel as middle third of board
    const third = this.height / 3;
    return y > third && y < third * 2;
  }
  
  private getNeighbors(node: PathNode): { x: number; y: number }[] {
    // 4-directional movement (no diagonals for cleaner cables)
    return [
      { x: node.x - 1, y: node.y },
      { x: node.x + 1, y: node.y },
      { x: node.x, y: node.y - 1 },
      { x: node.x, y: node.y + 1 },
    ].filter(n => 
      n.x >= 0 && n.x < this.width && 
      n.y >= 0 && n.y < this.height
    );
  }
  
  private isBlocked(x: number, y: number): boolean {
    return this.obstacles[y]?.[x] ?? true;
  }
  
  private reconstructPath(node: PathNode): GridPosition[] {
    const path: GridPosition[] = [];
    let current: PathNode | null = node;
    
    while (current) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }
    
    return path;
  }
}
```

### 5.3 Jack Position to Grid Coordinate

```typescript
function getJackGridPosition(
  pedal: PlacedPedal,
  jack: 'input' | 'output'
): GridPosition {
  const jackConfig = jack === 'input' ? pedal.inputJack : pedal.outputJack;
  
  switch (jackConfig.side) {
    case 'top':
      return { x: pedal.x + jackConfig.offset, y: pedal.y - 1 };
    case 'bottom':
      return { x: pedal.x + jackConfig.offset, y: pedal.y + pedal.height };
    case 'left':
      return { x: pedal.x - 1, y: pedal.y + jackConfig.offset };
    case 'right':
      return { x: pedal.x + pedal.width, y: pedal.y + jackConfig.offset };
  }
}
```

### 5.4 Cable Standoffs

Cables should exit perpendicular to the jack for a few cells before routing freely. This prevents visual overlap with the pedal.

```typescript
function getStandoffPoint(
  jackPos: GridPosition,
  jackSide: 'top' | 'bottom' | 'left' | 'right',
  standoffDistance: number = 2
): GridPosition {
  switch (jackSide) {
    case 'top':    return { x: jackPos.x, y: jackPos.y - standoffDistance };
    case 'bottom': return { x: jackPos.x, y: jackPos.y + standoffDistance };
    case 'left':   return { x: jackPos.x - standoffDistance, y: jackPos.y };
    case 'right':  return { x: jackPos.x + standoffDistance, y: jackPos.y };
  }
}
```

---

## Part 6: Layout Optimization

### 6.1 Strategy: Two-Phase Optimization

**Phase A: Initial Placement (Greedy)**
Place pedals in signal chain order, left-to-right, using simple heuristics. This gives a valid starting point.

**Phase B: Iterative Refinement (Local Search)**
Repeatedly try small changes (swaps, nudges) and keep improvements. This handles the interdependency problem by evaluating actual routed cable cost.

### 6.2 Cost Function

```typescript
interface LayoutCost {
  totalCableLength: number;    // sum of all A* path lengths
  longestCable: number;        // worst single cable
  crossings: number;           // cable intersection count (future)
  compactness: number;         // how tight the layout is
}

function evaluateLayout(
  pedals: PlacedPedal[],
  chain: SignalChain,
  router: CableRouter
): LayoutCost {
  let totalLength = 0;
  let longestCable = 0;
  
  // Calculate all cable paths
  for (const segment of chain.segments) {
    let prevJack: GridPosition | null = null;
    
    for (const pedalId of segment.pedalIds) {
      const pedal = pedals.find(p => p.id === pedalId)!;
      const inputJack = getJackGridPosition(pedal, 'input');
      
      if (prevJack) {
        const path = router.findPath(prevJack, inputJack);
        if (path) {
          const length = path.length;
          totalLength += length;
          longestCable = Math.max(longestCable, length);
        } else {
          // No valid path - heavily penalize
          totalLength += 1000;
        }
      }
      
      prevJack = getJackGridPosition(pedal, 'output');
    }
  }
  
  return {
    totalCableLength: totalLength,
    longestCable,
    crossings: 0,  // TODO: implement
    compactness: calculateCompactness(pedals),
  };
}
```

### 6.3 Phase A: Greedy Initial Placement

```typescript
function greedyPlacement(
  pedals: Pedal[],
  chain: SignalChain,
  board: BoardConfig
): PlacedPedal[] {
  const placed: PlacedPedal[] = [];
  const collision = new CollisionGrid(board.width, board.height);
  
  // Sort pedals by signal chain order
  const orderedPedals = getOrderedPedals(pedals, chain);
  
  // Place left to right, alternating rows
  let currentX = 1;  // start with margin
  let currentRow = 0;
  const rowYPositions = [board.height - 8, board.height - 20];  // two rows
  
  for (const pedal of orderedPedals) {
    const y = rowYPositions[currentRow % rowYPositions.length];
    
    // Find first valid X position
    let x = currentX;
    while (!collision.placePedal(pedal.id, x, y, pedal.width, pedal.height)) {
      x++;
      if (x + pedal.width > board.width) {
        // Move to next row
        currentRow++;
        x = 1;
        const newY = rowYPositions[currentRow % rowYPositions.length];
        // Reset and try again
        if (collision.placePedal(pedal.id, x, newY, pedal.width, pedal.height)) {
          placed.push({ ...pedal, x, y: newY });
          currentX = x + pedal.width + 1;
          break;
        }
      }
    }
    
    if (placed.length < orderedPedals.indexOf(pedal) + 1) {
      placed.push({ ...pedal, x, y });
      currentX = x + pedal.width + 1;
    }
  }
  
  return placed;
}
```

### 6.4 Phase B: Local Search Refinement

```typescript
function optimizeLayout(
  initialLayout: PlacedPedal[],
  chain: SignalChain,
  board: BoardConfig,
  maxIterations: number = 100
): PlacedPedal[] {
  let current = [...initialLayout];
  let currentCost = evaluateLayout(current, chain, new CableRouter(/* ... */));
  
  for (let i = 0; i < maxIterations; i++) {
    // Try a random modification
    const candidate = generateNeighbor(current, board);
    
    if (!isValidLayout(candidate, board)) continue;
    
    const candidateCost = evaluateLayout(
      candidate, 
      chain, 
      new CableRouter(buildObstacleGrid(candidate, board))
    );
    
    // Accept if better (greedy hill climbing)
    // Could use simulated annealing for escaping local minima
    if (candidateCost.totalCableLength < currentCost.totalCableLength) {
      current = candidate;
      currentCost = candidateCost;
    }
  }
  
  return current;
}

function generateNeighbor(layout: PlacedPedal[], board: BoardConfig): PlacedPedal[] {
  const candidate = layout.map(p => ({ ...p }));
  
  // Random modification type
  const moveType = Math.random();
  
  if (moveType < 0.4) {
    // Nudge: move one pedal by 1-2 cells
    const idx = Math.floor(Math.random() * candidate.length);
    const dx = Math.floor(Math.random() * 5) - 2;
    const dy = Math.floor(Math.random() * 3) - 1;
    candidate[idx].x = Math.max(0, Math.min(board.width - candidate[idx].width, candidate[idx].x + dx));
    candidate[idx].y = Math.max(0, Math.min(board.height - candidate[idx].height, candidate[idx].y + dy));
  } 
  else if (moveType < 0.7) {
    // Swap: exchange positions of two adjacent pedals in chain
    const idx = Math.floor(Math.random() * (candidate.length - 1));
    const tempX = candidate[idx].x;
    const tempY = candidate[idx].y;
    candidate[idx].x = candidate[idx + 1].x;
    candidate[idx].y = candidate[idx + 1].y;
    candidate[idx + 1].x = tempX;
    candidate[idx + 1].y = tempY;
  }
  else {
    // Row flip: move pedal to other row
    const idx = Math.floor(Math.random() * candidate.length);
    const rows = [board.height - 8, board.height - 20];
    const currentRowIdx = rows.findIndex(r => Math.abs(r - candidate[idx].y) < 5);
    const newRowIdx = (currentRowIdx + 1) % rows.length;
    candidate[idx].y = rows[newRowIdx];
  }
  
  return candidate;
}
```

---

## Part 7: Routing Modes & Topology Toggles

### 7.1 The Concept

When a user toggles a routing mode, two things happen:
1. **Re-categorization**: Pedals get reassigned to different chain segments
2. **Re-optimization**: Physical positions update to minimize cable length for new topology

This isn't just a wiring change—it's a layout change.

### 7.2 Supported Routing Modes

```typescript
type RoutingMode = 
  | 'direct'           // Guitar → all pedals → Amp (no loop)
  | 'effects-loop'     // 4-cable method: front chain + loop chain
  | 'wet-dry'          // Future: parallel paths
  ;

type ModulationPlacement = 
  | 'clean'            // Modulation in effects loop (after preamp)
  | 'dirty'            // Modulation before amp (hits preamp dirt)
  ;

type DelayPlacement =
  | 'loop'             // Delay in effects loop (clean repeats)
  | 'front'            // Delay before amp (dirty/ambient repeats)
  ;

interface RoutingConfig {
  mode: RoutingMode;
  modulationPlacement: ModulationPlacement;
  delayPlacement: DelayPlacement;
  
  // Future options
  reverbPreDelay?: boolean;     // Reverb before delay (unusual but valid)
  fuzzFirst?: boolean;          // Override: fuzz before buffer/tuner
  volumePedalPosition?: 'front' | 'loop' | 'post-drive';
}
```

### 7.3 Segment Assignment Logic

When routing config changes, pedals get reassigned:

```typescript
function assignPedalsToSegments(
  pedals: Pedal[],
  config: RoutingConfig
): { front: Pedal[]; loop: Pedal[] } {
  
  if (config.mode === 'direct') {
    // Everything in front, no loop
    return { 
      front: sortBySignalChainOrder(pedals, config), 
      loop: [] 
    };
  }
  
  // Effects loop mode - categorize by type + config
  const front: Pedal[] = [];
  const loop: Pedal[] = [];
  
  for (const pedal of pedals) {
    const segment = getSegmentForPedal(pedal, config);
    if (segment === 'front') {
      front.push(pedal);
    } else {
      loop.push(pedal);
    }
  }
  
  return {
    front: sortBySignalChainOrder(front, config),
    loop: sortBySignalChainOrder(loop, config),
  };
}

function getSegmentForPedal(pedal: Pedal, config: RoutingConfig): 'front' | 'loop' {
  // User override takes precedence
  if (pedal.segmentOverride) {
    return pedal.segmentOverride;
  }
  
  // Category-based defaults with config overrides
  switch (pedal.category) {
    // Always front
    case 'tuner':
    case 'filter':      // wah
    case 'compressor':
    case 'pitch':
    case 'drive':
    case 'gate':
      return 'front';
    
    // Configurable
    case 'modulation':
      return config.modulationPlacement === 'dirty' ? 'front' : 'loop';
    
    case 'delay':
      return config.delayPlacement === 'front' ? 'front' : 'loop';
    
    // Usually loop
    case 'reverb':
      return 'loop';
    
    // Context-dependent
    case 'eq':
      return pedal.eqPlacement ?? 'front';  // EQ often has its own setting
    
    case 'volume':
      switch (config.volumePedalPosition) {
        case 'front': return 'front';
        case 'post-drive': return 'front';  // still front, just ordered after drives
        case 'loop': return 'loop';
        default: return 'loop';
      }
    
    case 'looper':
      return pedal.looperPlacement ?? 'loop';  // end of chain by default
    
    default:
      return 'front';
  }
}
```

### 7.4 Sorting Within Segments

```typescript
function sortBySignalChainOrder(pedals: Pedal[], config: RoutingConfig): Pedal[] {
  return [...pedals].sort((a, b) => {
    // User order override takes precedence
    if (a.orderOverride !== undefined && b.orderOverride !== undefined) {
      return a.orderOverride - b.orderOverride;
    }
    if (a.orderOverride !== undefined) return -1;
    if (b.orderOverride !== undefined) return 1;
    
    // Fuzz-first rule
    if (a.impedanceSensitive && !b.impedanceSensitive) return -1;
    if (b.impedanceSensitive && !a.impedanceSensitive) return 1;
    
    // Category order
    const orderA = getCategoryOrder(a, config);
    const orderB = getCategoryOrder(b, config);
    if (orderA !== orderB) return orderA - orderB;
    
    // Sub-sort drives by gain level
    if (a.category === 'drive' && b.category === 'drive') {
      return (GAIN_ORDER[a.driveLevel ?? 'medium']) - (GAIN_ORDER[b.driveLevel ?? 'medium']);
    }
    
    return 0;
  });
}

const GAIN_ORDER: Record<DriveLevel, number> = {
  boost: 1,
  low: 2,
  medium: 3,
  high: 4,
  fuzz: 0,  // fuzz is weird, usually first if not impedance-sensitive
};

function getCategoryOrder(pedal: Pedal, config: RoutingConfig): number {
  // Base order from defaults
  let order = PLACEMENT_RULES[pedal.category].defaultOrder;
  
  // Adjust for config
  if (pedal.category === 'volume' && config.volumePedalPosition === 'post-drive') {
    order = 35;  // after drives (30) but before modulation
  }
  
  return order;
}
```

### 7.5 Optimization Trigger Flow

```typescript
// In store or controller
function onRoutingConfigChange(newConfig: RoutingConfig): void {
  // Step 1: Reassign pedals to segments
  const { front, loop } = assignPedalsToSegments(state.pedals, newConfig);
  
  // Step 2: Build new signal chain
  const chain = buildSignalChain(front, loop, newConfig);
  
  // Step 3: Re-optimize layout for new topology
  const optimizedLayout = optimizeLayout(
    [...front, ...loop],
    chain,
    state.board,
    newConfig.mode === 'effects-loop' ? state.amp : undefined
  );
  
  // Step 4: Update state
  setState({
    routingConfig: newConfig,
    signalChain: chain,
    placedPedals: optimizedLayout,
  });
  
  // Step 5: Regenerate cables
  regenerateCables();
}
```

### 7.6 UI Toggle → Optimization Mapping

| Toggle | What Changes | Optimization Impact |
|--------|--------------|---------------------|
| **4-Cable Method ON** | Creates loop segment, adds amp send/return routing | Pedals split between rows, amp connections added |
| **4-Cable Method OFF** | Single chain, no loop | All pedals in one flow, simpler routing |
| **Clean Modulation** | Mod pedals move to loop | Mod pedals relocate to loop row |
| **Dirty Modulation** | Mod pedals move to front | Mod pedals relocate to front row (before amp) |
| **Delay in Front** | Delay before amp input | Delay joins front chain, dirty repeats |
| **Delay in Loop** | Delay after preamp | Delay joins loop chain, clean repeats |
| **Volume Post-Drive** | Volume pedal reorders | Volume moves after OD/distortion in chain |
| **Fuzz First** | Fuzz jumps to position 1 | Fuzz moves to start, may bump tuner |

### 7.7 Visual Feedback

When topology changes, the UI should:

1. **Animate pedal movement** (not just snap) so user sees what changed
2. **Highlight affected pedals** briefly
3. **Show chain segment labels** ("Front Chain" / "Effects Loop")
4. **Color-code cables** by segment (e.g., front = blue, loop = orange)

```typescript
interface Cable {
  id: string;
  fromPedalId: string | 'guitar' | 'amp-send';
  toPedalId: string | 'amp-input' | 'amp-return';
  segment: 'front' | 'loop';
  path: GridPosition[];
  color: string;  // derived from segment
}

const SEGMENT_COLORS = {
  front: '#3B82F6',  // blue
  loop: '#F97316',   // orange
  guitar: '#22C55E', // green (guitar cable)
};
```

### 7.8 Common Routing Presets

Quick-apply configurations for common setups:

```typescript
const ROUTING_PRESETS: Record<string, RoutingConfig> = {
  'simple': {
    mode: 'direct',
    modulationPlacement: 'clean',
    delayPlacement: 'loop',
  },
  
  'classic-4cm': {
    mode: 'effects-loop',
    modulationPlacement: 'clean',    // mod in loop
    delayPlacement: 'loop',          // delay in loop
  },
  
  'edge-style': {
    // The Edge / U2 style: modulation and delay hit the preamp
    mode: 'effects-loop',
    modulationPlacement: 'dirty',
    delayPlacement: 'front',
  },
  
  'metal': {
    mode: 'effects-loop',
    modulationPlacement: 'clean',
    delayPlacement: 'loop',
    // Typically: gate after high-gain in front
  },
  
  'ambient': {
    mode: 'effects-loop',
    modulationPlacement: 'clean',
    delayPlacement: 'loop',
    reverbPreDelay: false,  // delay → reverb (standard)
  },
  
  'shoegaze': {
    mode: 'direct',  // often no loop, everything stacked
    modulationPlacement: 'dirty',
    delayPlacement: 'front',
    // Reverb before drive is common here too
  },
};
```

### 7.9 Edge Cases & Conflicts

| Scenario | Resolution |
|----------|------------|
| User drags mod pedal to front row while in "clean mod" mode | Prompt: "Move pedal or switch to dirty modulation?" |
| Fuzz + buffered tuner both set to position 1 | Fuzz wins if `impedanceSensitive: true`, tuner moves to 2 |
| Looper set to "first" but user has tuner | Looper goes after tuner (tuner is special case) |
| Volume pedal in 3 different positions requested | Use explicit `volumePedalPosition` config |
| Empty loop segment (no mod/delay/reverb) | Valid—just guitar → front → amp, send/return unused |
| All pedals manually positioned | Skip optimization, respect user layout |

```typescript
function hasConflict(pedal: Pedal, targetSegment: 'front' | 'loop', config: RoutingConfig): Conflict | null {
  const expectedSegment = getSegmentForPedal(pedal, config);
  
  if (targetSegment !== expectedSegment) {
    return {
      type: 'segment-mismatch',
      pedal,
      expected: expectedSegment,
      actual: targetSegment,
      message: `${pedal.name} is configured for ${expectedSegment} chain. Move anyway?`,
      resolutions: [
        { label: 'Move pedal', action: 'override-segment' },
        { label: `Switch to ${targetSegment === 'front' ? 'dirty' : 'clean'} modulation`, action: 'change-config' },
        { label: 'Cancel', action: 'cancel' },
      ],
    };
  }
  
  return null;
}
```

---

## Part 8: Effects Loop Integration

### 7.1 Amp as a Node

```typescript
interface AmpNode {
  position: GridPosition;
  width: number;
  height: number;
  jacks: {
    input: GridPosition;    // relative to amp position
    send: GridPosition;
    return: GridPosition;
  };
}

function getAmpJackAbsolute(amp: AmpNode, jack: 'input' | 'send' | 'return'): GridPosition {
  return {
    x: amp.position.x + amp.jacks[jack].x,
    y: amp.position.y + amp.jacks[jack].y,
  };
}
```

### 7.2 Chain Segment Routing

```typescript
function routeEffectsLoopChain(
  frontPedals: PlacedPedal[],
  loopPedals: PlacedPedal[],
  amp: AmpNode,
  router: CableRouter
): Cable[] {
  const cables: Cable[] = [];
  
  // Guitar → first front pedal (external, just show connection point)
  // ... front pedal chain ...
  // Last front pedal → Amp Input
  
  if (frontPedals.length > 0) {
    const lastFront = frontPedals[frontPedals.length - 1];
    cables.push({
      from: getJackGridPosition(lastFront, 'output'),
      to: getAmpJackAbsolute(amp, 'input'),
      path: router.findPath(
        getJackGridPosition(lastFront, 'output'),
        getAmpJackAbsolute(amp, 'input')
      ),
    });
  }
  
  // Amp Send → first loop pedal
  if (loopPedals.length > 0) {
    const firstLoop = loopPedals[0];
    cables.push({
      from: getAmpJackAbsolute(amp, 'send'),
      to: getJackGridPosition(firstLoop, 'input'),
      path: router.findPath(
        getAmpJackAbsolute(amp, 'send'),
        getJackGridPosition(firstLoop, 'input')
      ),
    });
    
    // ... loop pedal chain ...
    
    // Last loop pedal → Amp Return
    const lastLoop = loopPedals[loopPedals.length - 1];
    cables.push({
      from: getJackGridPosition(lastLoop, 'output'),
      to: getAmpJackAbsolute(amp, 'return'),
      path: router.findPath(
        getJackGridPosition(lastLoop, 'output'),
        getAmpJackAbsolute(amp, 'return')
      ),
    });
  }
  
  return cables;
}
```

### 7.3 Optimization with Effects Loop

When effects loop is enabled, the optimizer should:

1. Place front chain pedals on one row (closer to amp input)
2. Place loop chain pedals on the other row (near send/return)
3. Evaluate cable cost including amp connections
4. Consider amp position as part of the optimization (or fixed if off-board)

```typescript
function optimizeWithEffectsLoop(
  pedals: Pedal[],
  chain: SignalChain,
  board: BoardConfig,
  amp: AmpNode
): PlacedPedal[] {
  // Separate pedals by segment
  const frontPedals = pedals.filter(p => chain.segments[0].pedalIds.includes(p.id));
  const loopPedals = pedals.filter(p => chain.segments[1].pedalIds.includes(p.id));
  
  // Assign rows
  const frontRow = board.height - 8;   // bottom row, near amp input
  const loopRow = board.height - 20;   // top row, near send/return
  
  // Place each segment
  const placedFront = placeSegmentOnRow(frontPedals, frontRow, board);
  const placedLoop = placeSegmentOnRow(loopPedals, loopRow, board);
  
  // Combine and optimize
  const combined = [...placedFront, ...placedLoop];
  return optimizeLayout(combined, chain, board);
}
```

---

## Part 8: Implementation Steps

### Step 1: Core Infrastructure (Week 1)

1. **Define coordinate system**
   - Create `GridPosition` type
   - Implement conversion utilities
   - Update all existing code to use grid units

2. **Build CollisionGrid class**
   - Implement `placePedal`, `removePedal`, `isOccupied`
   - Add bounds checking
   - Write unit tests

3. **Build CableRouter class**
   - Implement A* pathfinding
   - Add channel preference weighting
   - Write unit tests with known obstacle layouts

### Step 2: Data Model (Week 1)

1. **Define pedal types**
   - `Pedal`, `PlacedPedal`, `JackPosition`
   - Effect categories and placement rules
   
2. **Define signal chain types**
   - `SignalChain`, `ChainSegment`
   - Topology enum

3. **Update store**
   - Migrate existing state to new types
   - Ensure persistence works

### Step 3: Linear Chain Optimization (Week 2)

1. **Implement greedy placement**
   - Left-to-right, signal chain order
   - Two-row layout
   - Test with various pedal counts

2. **Implement cost function**
   - Total cable length via A*
   - Handle no-path-found case

3. **Implement local search**
   - Nudge, swap, row-flip moves
   - Greedy acceptance
   - Test convergence

### Step 4: Routing Modes (Week 3)

1. **Implement segment assignment**
   - Category-based defaults
   - Config overrides (dirty/clean mod, delay placement)
   - User pedal-level overrides

2. **Build routing config UI**
   - Toggle switches for 4-cable, mod placement, delay placement
   - Preset buttons (Classic 4CM, Edge-style, etc.)
   - Visual indicator of current topology

3. **Wire toggle → optimization**
   - Config change triggers reassignment
   - Reassignment triggers re-optimization
   - Re-optimization triggers cable regeneration

4. **Handle conflicts**
   - Detect when manual position contradicts config
   - Prompt user for resolution

### Step 5: Effects Loop (Week 3-4)

1. **Add amp node**
   - Position, dimensions, jack locations
   - Render amp visualization

2. **Implement segment separation**
   - Front pedals on bottom row (near amp input)
   - Loop pedals on top row (near send/return)

3. **Route amp cables**
   - Front → amp input
   - Amp send → loop → amp return

4. **Update optimizer**
   - Include amp cables in cost function
   - Test with typical 4-cable setups

### Step 6: Polish & Edge Cases (Week 4)

1. **Cable rendering cleanup**
   - Smooth paths (Bezier or rounded corners)
   - Standoff implementation
   - Color coding by segment

2. **User overrides**
   - Manual pedal positioning
   - Signal chain reordering
   - Lock pedal in place

3. **Performance**
   - Cache A* results
   - Debounce optimization triggers
   - Profile and optimize hot paths

---

## Part 9: Testing Strategy

### Unit Tests

```typescript
describe('CollisionGrid', () => {
  it('places non-overlapping pedals', () => { /* ... */ });
  it('rejects overlapping pedals', () => { /* ... */ });
  it('rejects out-of-bounds pedals', () => { /* ... */ });
  it('removes pedals correctly', () => { /* ... */ });
});

describe('CableRouter', () => {
  it('finds direct path with no obstacles', () => { /* ... */ });
  it('routes around single obstacle', () => { /* ... */ });
  it('returns null when no path exists', () => { /* ... */ });
  it('prefers channel routing', () => { /* ... */ });
});

describe('Optimizer', () => {
  it('places 3 pedals in valid positions', () => { /* ... */ });
  it('reduces cable length vs initial placement', () => { /* ... */ });
  it('handles effects loop topology', () => { /* ... */ });
});
```

### Integration Tests

- Load predefined board with 5 pedals, run optimization, verify no collisions
- Add pedal to existing optimized board, verify re-optimization works
- Toggle effects loop on/off, verify pedal positions adjust

### Visual Regression Tests

- Screenshot known configurations before/after optimization
- Compare cable paths for obvious improvements

---

## Part 10: Success Criteria

### MVP (Phase 1 Complete)

- [ ] Linear chain optimization produces valid, collision-free layouts
- [ ] Cable routing avoids all pedals
- [ ] Total cable length is measurably shorter than naive placement
- [ ] Coordinate system is consistent (no pixel/grid bugs)

### Phase 2 Complete

- [ ] Effects loop topology routes correctly
- [ ] Front chain and loop chain are visually separated
- [ ] Amp send/return cables route through channel
- [ ] Optimization considers amp position
- [ ] Toggling 4-cable method triggers re-optimization
- [ ] Clean/dirty modulation toggle moves mod pedals between segments
- [ ] Delay placement toggle works correctly
- [ ] Routing presets apply and optimize in one action

### Quality Bar

- [ ] No cable-through-pedal visual glitches
- [ ] Optimization completes in <500ms for 10 pedals
- [ ] User can manually override any pedal position
- [ ] Clear visual distinction between signal chain segments

---

## Appendix A: Reference Signal Chains

### Minimal (3 pedals)
```
Guitar → Tuner → Overdrive → Delay → Amp
```

### Standard No-Loop (6 pedals)
```
Guitar → Tuner → Compressor → Overdrive → Chorus → Delay → Reverb → Amp
```

### 4-Cable Method (8 pedals)
```
Front: Guitar → Tuner → Wah → Compressor → Overdrive → Amp Input
Loop: Amp Send → Chorus → Delay → Reverb → Amp Return
```

### Fuzz-First Edge Case
```
Guitar → Fuzz Face → Tuner → Overdrive → Amp
(Fuzz must be first due to impedance sensitivity)
```

---

## Appendix B: Algorithm Alternatives Considered

| Algorithm | Pros | Cons | Verdict |
|-----------|------|------|---------|
| **Greedy only** | Fast, simple | Suboptimal results | Baseline only |
| **Exhaustive search** | Optimal | O(n!) complexity, unusable | Rejected |
| **Genetic algorithm** | Escapes local minima | Complex, slow convergence | Overkill for <20 pedals |
| **Simulated annealing** | Good results, handles interdependency | Tuning required | Future enhancement |
| **Greedy + local search** | Fast, good results, simple | May hit local minima | **Selected for MVP** |

---

## Appendix C: File Structure After Rebuild

```
src/lib/engine/
├── types/
│   ├── coordinates.ts      # GridPosition, conversions
│   ├── pedal.ts            # Pedal, PlacedPedal, JackPosition
│   ├── chain.ts            # SignalChain, ChainSegment
│   └── board.ts            # BoardConfig, RailConfig
├── collision/
│   ├── collision-grid.ts   # CollisionGrid class
│   └── rail-snap.ts        # Rail snapping utilities
├── routing/
│   ├── cable-router.ts     # A* pathfinding
│   ├── path-simplifier.ts  # Smooth paths for rendering
│   └── jack-positions.ts   # Jack coordinate calculation
├── optimization/
│   ├── cost-function.ts    # Layout evaluation
│   ├── greedy-placement.ts # Initial placement
│   ├── local-search.ts     # Iterative refinement
│   └── optimizer.ts        # Main entry point
└── index.ts                # Public API
```
