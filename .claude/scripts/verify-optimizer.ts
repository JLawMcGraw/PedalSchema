/**
 * Optimizer Verification Script
 *
 * Run with: npx tsx .claude/scripts/verify-optimizer.ts
 */

import { createSignalFlowLayout, calculateCableLengthCost, optimizeLayoutV2 } from '../../src/lib/engine/layout/optimizer-v2';
import type { PlacedPedal, Pedal, Board } from '../../src/types';

// Test board: 22" x 12.5" (Pedaltrain Classic 1)
const testBoard: Board = {
  id: 'test-board',
  name: 'Test Board',
  widthInches: 22,
  depthInches: 12.5,
  rails: [
    { positionFromBackInches: 8, lengthInches: 22 },
    { positionFromBackInches: 2, lengthInches: 22 },
  ],
};

// Test pedals
const testPedalsById: Record<string, Pedal> = {
  'pedal-ts': {
    id: 'pedal-ts',
    name: 'Tube Screamer',
    widthInches: 2.87,
    depthInches: 5.12,
    category: 'overdrive',
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50 },
      { jackType: 'output', side: 'left', positionPercent: 50 },
    ],
  },
  'pedal-bd': {
    id: 'pedal-bd',
    name: 'Blues Driver',
    widthInches: 2.87,
    depthInches: 5.12,
    category: 'overdrive',
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50 },
      { jackType: 'output', side: 'left', positionPercent: 50 },
    ],
  },
  'pedal-dd': {
    id: 'pedal-dd',
    name: 'DD-7 Delay',
    widthInches: 2.91,
    depthInches: 5.04,
    category: 'delay',
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50 },
      { jackType: 'output', side: 'left', positionPercent: 50 },
    ],
  },
  'pedal-rv': {
    id: 'pedal-rv',
    name: 'RV-6 Reverb',
    widthInches: 2.91,
    depthInches: 5.04,
    category: 'reverb',
    jacks: [
      { jackType: 'input', side: 'right', positionPercent: 50 },
      { jackType: 'output', side: 'left', positionPercent: 50 },
    ],
  },
};

function createPlacedPedals(count: number): PlacedPedal[] {
  const pedalIds = ['pedal-ts', 'pedal-bd', 'pedal-dd', 'pedal-rv'];
  const pedals: PlacedPedal[] = [];

  for (let i = 0; i < count && i < pedalIds.length; i++) {
    pedals.push({
      id: `placed-${i}`,
      pedalId: pedalIds[i],
      pedal: testPedalsById[pedalIds[i]],
      xInches: 0,
      yInches: 0,
      rotationDegrees: 0,
      chainPosition: i + 1,
      location: 'front_of_amp',
    });
  }

  return pedals;
}

function boxesCollide(
  x1: number, y1: number, w1: number, h1: number,
  x2: number, y2: number, w2: number, h2: number,
  margin: number = 0.25
): boolean {
  return !(
    x1 + w1 + margin <= x2 ||
    x2 + w2 + margin <= x1 ||
    y1 + h1 + margin <= y2 ||
    y2 + h2 + margin <= y1
  );
}

console.log('========================================');
console.log('OPTIMIZER V2 VERIFICATION');
console.log('========================================\n');

// Test 1: Signal Flow Layout
console.log('TEST 1: Signal Flow Layout with 4 Pedals');
console.log('----------------------------------------');

const placedPedals = createPlacedPedals(4);
const placements = createSignalFlowLayout(placedPedals, testPedalsById, testBoard);

console.log('\nExtracted Placement Data:');
placements.forEach((p, i) => {
  const pedal = testPedalsById[placedPedals[i].pedalId];
  const rightEdge = p.x + pedal.widthInches;
  const bottomEdge = p.y + pedal.depthInches;
  console.log(`  Pedal ${i + 1} (${pedal.name}): x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}, rightEdge=${rightEdge.toFixed(2)}, bottomEdge=${bottomEdge.toFixed(2)}`);
});

// Collision check
console.log('\nCollision Check:');
let hasCollision = false;
for (let i = 0; i < placements.length; i++) {
  const p1 = placements[i];
  const pedal1 = testPedalsById[placedPedals[i].pedalId];

  for (let j = i + 1; j < placements.length; j++) {
    const p2 = placements[j];
    const pedal2 = testPedalsById[placedPedals[j].pedalId];

    const collision = boxesCollide(
      p1.x, p1.y, pedal1.widthInches, pedal1.depthInches,
      p2.x, p2.y, pedal2.widthInches, pedal2.depthInches
    );

    if (collision) {
      console.log(`  ✗ COLLISION: Pedal ${i + 1} and Pedal ${j + 1}`);
      hasCollision = true;
    }
  }
}

if (!hasCollision) {
  console.log('  ✓ No collisions detected');
}

// Signal flow order check
console.log('\nSignal Flow Order Check:');
const xPositions = placements.map((p, i) => ({ idx: i + 1, x: p.x }));
xPositions.sort((a, b) => b.x - a.x); // Sort by X descending (rightmost first)

console.log('  Expected order (right to left): 1, 2, 3, 4');
console.log(`  Actual order (right to left): ${xPositions.map(p => p.idx).join(', ')}`);

const isCorrectOrder = xPositions[0].idx === 1 && xPositions[xPositions.length - 1].idx === 4;
if (isCorrectOrder) {
  console.log('  ✓ Pedal 1 is rightmost, Pedal 4 is leftmost');
} else {
  console.log('  ✗ Signal flow order is INCORRECT');
}

// Bounds check
console.log('\nBounds Check:');
let allInBounds = true;
for (let i = 0; i < placements.length; i++) {
  const p = placements[i];
  const pedal = testPedalsById[placedPedals[i].pedalId];

  const inBounds =
    p.x >= 0 &&
    p.x + pedal.widthInches <= testBoard.widthInches &&
    p.y >= 0 &&
    p.y + pedal.depthInches <= testBoard.depthInches;

  if (!inBounds) {
    console.log(`  ✗ Pedal ${i + 1} OUT OF BOUNDS`);
    allInBounds = false;
  }
}

if (allInBounds) {
  console.log('  ✓ All pedals within board bounds');
}

// Cable length check
console.log('\nCable Length Analysis:');
const cost = calculateCableLengthCost(placements, placedPedals, testPedalsById, testBoard);
console.log(`  Total cable length: ${cost.toFixed(2)} inches`);

// Compare with bad placement
const badPlacements = [
  { id: 'placed-0', x: 2, y: 2 },   // Pedal 1 on LEFT (bad!)
  { id: 'placed-1', x: 18, y: 2 },  // Pedal 2 on RIGHT (bad!)
  { id: 'placed-2', x: 8, y: 7 },
  { id: 'placed-3', x: 14, y: 7 },
];
const badCost = calculateCableLengthCost(badPlacements, placedPedals, testPedalsById, testBoard);

console.log(`  Bad placement cable length: ${badCost.toFixed(2)} inches`);
console.log(`  Improvement: ${((badCost - cost) / badCost * 100).toFixed(1)}%`);

if (cost < badCost) {
  console.log('  ✓ Optimized layout has shorter cables than bad layout');
} else {
  console.log('  ✗ Optimized layout is NOT better than bad layout');
}

// ASCII Diagram
console.log('\n========================================');
console.log('ASCII DIAGRAM (Board: 22" x 12.5")');
console.log('========================================');
console.log('');
console.log('Guitar                                              Amp');
console.log('  |                                                   |');
console.log('  v                                                   v');

// Create a simple ASCII grid
const gridWidth = 44; // 2 chars per inch
const gridHeight = 13; // 1 char per inch

const grid: string[][] = [];
for (let y = 0; y < gridHeight; y++) {
  grid[y] = [];
  for (let x = 0; x < gridWidth; x++) {
    grid[y][x] = '.';
  }
}

// Place pedals on grid
placements.forEach((p, i) => {
  const pedal = testPedalsById[placedPedals[i].pedalId];
  const startX = Math.floor(p.x * 2);
  const startY = Math.floor(p.y);
  const endX = Math.floor((p.x + pedal.widthInches) * 2);
  const endY = Math.floor(p.y + pedal.depthInches);

  for (let y = startY; y < endY && y < gridHeight; y++) {
    for (let x = startX; x < endX && x < gridWidth; x++) {
      if (x >= 0 && y >= 0) {
        grid[y][x] = String(i + 1);
      }
    }
  }
});

// Print grid
for (let y = 0; y < gridHeight; y++) {
  console.log('  ' + grid[y].join(''));
}

console.log('');
console.log('Legend: 1=Tube Screamer, 2=Blues Driver, 3=DD-7 Delay, 4=RV-6 Reverb');
console.log('Signal flow: Guitar(right) -> 1 -> 2 -> 3 -> 4 -> Amp(left)');

// Final verdict
console.log('\n========================================');
console.log('VERIFICATION RESULT');
console.log('========================================');

const passed = !hasCollision && isCorrectOrder && allInBounds && cost < badCost;

if (passed) {
  console.log('✓ VERIFIED: Optimizer places pedals correctly');
  console.log('  - No collisions');
  console.log('  - Correct signal flow order (right to left)');
  console.log('  - All pedals within bounds');
  console.log('  - Cable length is optimized');
} else {
  console.log('✗ VERIFICATION FAILED');
  if (hasCollision) console.log('  - Collisions detected');
  if (!isCorrectOrder) console.log('  - Incorrect signal flow order');
  if (!allInBounds) console.log('  - Pedals out of bounds');
  if (cost >= badCost) console.log('  - Cable length not optimized');
}
