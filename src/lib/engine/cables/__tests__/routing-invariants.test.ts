/**
 * Cable Routing Invariant Tests
 *
 * These tests verify the geometric contract that previously made routing
 * impossible: cables must be routable between pedals placed at the minimum
 * legal spacing (COLLISION_SPACING = 0.5"), across rows, and to off-board
 * endpoints (guitar/amp).
 *
 * Each valid path is verified TWICE:
 * 1. By the shared validator (validateCablePath)
 * 2. Independently, by sampling every segment at 1px resolution and
 *    asserting no sample falls inside any non-endpoint pedal box
 *    (the raw "cable through pedal" failure, regardless of margin policy).
 */

import { describe, it, expect } from 'vitest';
import type { Board, Pedal, PlacedPedal } from '@/types';
import { generateObstacles } from '../../obstacles';
import { routeCableWithObstacles } from '../routing-strategies';
import { validateCablePath } from '../validation';
import { getExternalEndpointPx, getPedalJackPx } from '../endpoints';
import type { Point, Box } from '../../geometry';
import { OBSTACLE_MARGIN } from '../../geometry';
import { COLLISION_SPACING } from '../../collision';

const SCALE = 40; // px per inch, matching the editor canvas
const NOW = '2024-01-01T00:00:00Z';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBoard(): Board {
  // Pedaltrain Classic 1-style board: 22" x 12.5", two rails
  return {
    id: 'board-1',
    name: 'Test Board',
    manufacturer: null,
    widthInches: 22,
    depthInches: 12.5,
    railWidthInches: 2,
    clearanceUnderInches: null,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    rails: [
      { id: 'rail-front', boardId: 'board-1', positionFromBackInches: 8, sortOrder: 0 },
      { id: 'rail-back', boardId: 'board-1', positionFromBackInches: 2, sortOrder: 1 },
    ],
  };
}

function makePedal(id: string): Pedal {
  // Standard BOSS-style compact pedal, no explicit jacks
  // (synthetic jacks: input on right edge mid, output on left edge mid)
  return {
    id,
    name: `Pedal ${id}`,
    manufacturer: 'Test',
    category: 'overdrive',
    widthInches: 2.87,
    depthInches: 5.12,
    heightInches: 2.37,
    voltage: 9,
    currentMa: 50,
    polarity: 'center_negative',
    defaultChainPosition: null,
    preferredLocation: 'front_of_amp',
    supports4Cable: false,
    needsBufferBefore: false,
    needsDirectPickup: false,
    isSystem: true,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    imageUrl: null,
    notes: null,
    jacks: [],
  } as Pedal;
}

function makePlaced(
  id: string,
  pedalId: string,
  x: number,
  y: number,
  chainPosition: number,
  location: PlacedPedal['location'] = 'front_of_amp'
): PlacedPedal {
  return {
    id,
    configurationId: 'config-1',
    pedalId,
    xInches: x,
    yInches: y,
    rotationDegrees: 0,
    chainPosition,
    location,
    isActive: true,
    useLoop: false,
    createdAt: NOW,
  };
}

/**
 * Build a realistic fully-populated two-row board.
 *
 * Front row (y = 7.38, clamped so 5.12"-deep pedals fit the 12.5" board):
 *   p1 at x=18, p2 at x=14.63, p3 at x=11.26 (0.5" gaps = 20px)
 * Back row (y = 2):
 *   p4 at x=18, p5 at x=14.63, p6 at x=11.26
 *
 * The inter-row gap is 7.38 - (2 + 5.12) = 0.26" = 10.4px - the geometry
 * that made routing impossible with a 25px margin.
 */
function makeTwoRowSetup() {
  const board = makeBoard();
  const frontY = board.depthInches - 5.12; // 7.38
  const backY = 2;
  const w = 2.87;
  const gap = COLLISION_SPACING; // 0.5"

  const pedalsById: Record<string, Pedal> = {};
  const placed: PlacedPedal[] = [];

  const positions: Array<{ id: string; x: number; y: number }> = [
    { id: 'p1', x: 18, y: frontY },
    { id: 'p2', x: 18 - (w + gap), y: frontY },
    { id: 'p3', x: 18 - 2 * (w + gap), y: frontY },
    { id: 'p4', x: 18, y: backY },
    { id: 'p5', x: 18 - (w + gap), y: backY },
    { id: 'p6', x: 18 - 2 * (w + gap), y: backY },
  ];

  positions.forEach((pos, i) => {
    const pedal = makePedal(`pedal-${pos.id}`);
    pedalsById[pedal.id] = pedal;
    placed.push(makePlaced(pos.id, pedal.id, pos.x, pos.y, i + 1));
  });

  return { board, pedalsById, placed };
}

// ---------------------------------------------------------------------------
// Independent verification (does NOT use the validator under test)
// ---------------------------------------------------------------------------

/**
 * Sample every path segment at ~1px resolution and assert no sample point
 * lies strictly inside ANY pedal box - including the cable's own source and
 * destination, except on their stub segments (first segment for source,
 * last for destination). This is the raw "cable drawn through a pedal"
 * failure, independent of margin policy.
 */
function assertPathNeverEntersPedals(
  path: Point[],
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number,
  label: string
) {
  const lastSeg = path.length - 2;
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s];
    const b = path[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      for (let bi = 0; bi < boxes.length; bi++) {
        if (s === 0 && bi === fromBoxIdx) continue; // exit stub
        if (s === lastSeg && bi === toBoxIdx) continue; // entry stub
        const box = boxes[bi];
        const inside =
          px > box.x + 0.01 && px < box.x + box.width - 0.01 &&
          py > box.y + 0.01 && py < box.y + box.height - 0.01;
        expect(
          inside,
          `${label}: point (${px.toFixed(1)}, ${py.toFixed(1)}) on segment ${s} is INSIDE pedal box ${bi} ` +
          `(${box.x}-${box.x + box.width}, ${box.y}-${box.y + box.height})`
        ).toBe(false);
      }
    }
  }
}

function routeAndVerify(
  from: Point,
  to: Point,
  setup: ReturnType<typeof makeTwoRowSetup>,
  fromPedalId: string | null,
  toPedalId: string | null,
  label: string
) {
  const obstacles = generateObstacles(setup.placed, setup.pedalsById, setup.board, SCALE);

  const result = routeCableWithObstacles(from, to, obstacles, fromPedalId, toPedalId);

  const pathStr = result.path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' → ');
  expect(result.valid, `${label}: routing returned INVALID path: ${pathStr}`).toBe(true);

  // Re-check with the shared validator (should agree by construction)
  const validation = validateCablePath(result.path, obstacles, fromPedalId, toPedalId);
  expect(validation.valid, `${label}: validator rejected the accepted path: ${pathStr}`).toBe(true);

  // Independent check: sampled points never inside any pedal body
  const fromBoxIdx = fromPedalId ? obstacles.pedalIdToBox.get(fromPedalId) ?? -1 : -1;
  const toBoxIdx = toPedalId ? obstacles.pedalIdToBox.get(toPedalId) ?? -1 : -1;
  assertPathNeverEntersPedals(result.path, obstacles.boxes, fromBoxIdx, toBoxIdx, label);

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('clearance contract', () => {
  it('routing margin fits between pedals at minimum legal spacing', () => {
    // A cable lane needs 2 x OBSTACLE_MARGIN; minimum spacing is
    // COLLISION_SPACING inches = COLLISION_SPACING * SCALE px.
    // This is the invariant whose violation broke all routing before.
    expect(OBSTACLE_MARGIN * 2).toBeLessThan(COLLISION_SPACING * SCALE);
  });
});

describe('adjacent pedal hops at minimum spacing (0.5")', () => {
  const setup = makeTwoRowSetup();

  it('routes p1.out → p2.in (20px gap)', () => {
    const p1 = setup.placed.find(p => p.id === 'p1')!;
    const p2 = setup.placed.find(p => p.id === 'p2')!;
    const from = getPedalJackPx(p1, setup.pedalsById[p1.pedalId], 'output', SCALE);
    const to = getPedalJackPx(p2, setup.pedalsById[p2.pedalId], 'input', SCALE);
    routeAndVerify(from, to, setup, 'p1', 'p2', 'p1→p2');
  });

  it('routes p2.out → p3.in (20px gap)', () => {
    const p2 = setup.placed.find(p => p.id === 'p2')!;
    const p3 = setup.placed.find(p => p.id === 'p3')!;
    const from = getPedalJackPx(p2, setup.pedalsById[p2.pedalId], 'output', SCALE);
    const to = getPedalJackPx(p3, setup.pedalsById[p3.pedalId], 'input', SCALE);
    routeAndVerify(from, to, setup, 'p2', 'p3', 'p2→p3');
  });
});

describe('cross-row routing (10.4px inter-row gap, impossible with old 25px margin)', () => {
  const setup = makeTwoRowSetup();

  it('routes front-row p3.out → back-row p4.in around the rows', () => {
    const p3 = setup.placed.find(p => p.id === 'p3')!;
    const p4 = setup.placed.find(p => p.id === 'p4')!;
    const from = getPedalJackPx(p3, setup.pedalsById[p3.pedalId], 'output', SCALE);
    const to = getPedalJackPx(p4, setup.pedalsById[p4.pedalId], 'input', SCALE);
    const result = routeAndVerify(from, to, setup, 'p3', 'p4', 'p3→p4 (cross-row)');

    // All intermediate points must stay on the board
    const boardW = setup.board.widthInches * SCALE;
    const boardH = setup.board.depthInches * SCALE;
    for (let i = 1; i < result.path.length - 1; i++) {
      const p = result.path[i];
      expect(p.x, `intermediate point ${i} off board (x)`).toBeGreaterThanOrEqual(0);
      expect(p.x, `intermediate point ${i} off board (x)`).toBeLessThanOrEqual(boardW);
      expect(p.y, `intermediate point ${i} off board (y)`).toBeGreaterThanOrEqual(0);
      expect(p.y, `intermediate point ${i} off board (y)`).toBeLessThanOrEqual(boardH);
    }
  });

  it('routes back-row hops p4.out → p5.in', () => {
    const p4 = setup.placed.find(p => p.id === 'p4')!;
    const p5 = setup.placed.find(p => p.id === 'p5')!;
    const from = getPedalJackPx(p4, setup.pedalsById[p4.pedalId], 'output', SCALE);
    const to = getPedalJackPx(p5, setup.pedalsById[p5.pedalId], 'input', SCALE);
    routeAndVerify(from, to, setup, 'p4', 'p5', 'p4→p5');
  });
});

describe('external endpoints (guitar / amp)', () => {
  const setup = makeTwoRowSetup();

  it('routes guitar → p1.in (first pedal, front row right)', () => {
    const p1 = setup.placed.find(p => p.id === 'p1')!;
    const from = getExternalEndpointPx('guitar', setup.board, SCALE, false);
    const to = getPedalJackPx(p1, setup.pedalsById[p1.pedalId], 'input', SCALE);
    routeAndVerify(from, to, setup, null, 'p1', 'guitar→p1');
  });

  it('routes p6.out → amp input (last pedal, back row left)', () => {
    const p6 = setup.placed.find(p => p.id === 'p6')!;
    const from = getPedalJackPx(p6, setup.pedalsById[p6.pedalId], 'output', SCALE);
    const to = getExternalEndpointPx('amp_input', setup.board, SCALE, false);
    routeAndVerify(from, to, setup, 'p6', null, 'p6→amp_input');
  });

  it('routes amp send → left-zone pedal input (FX loop)', () => {
    const setup2 = makeTwoRowSetup();
    // Add an FX-loop pedal on the left of the front row
    const loopPedal = makePedal('pedal-fx1');
    setup2.pedalsById[loopPedal.id] = loopPedal;
    const fx1 = makePlaced('fx1', loopPedal.id, 1, setup2.board.depthInches - 5.12, 7, 'effects_loop');
    setup2.placed.push(fx1);

    const from = getExternalEndpointPx('amp_send', setup2.board, SCALE, true);
    const to = getPedalJackPx(fx1, loopPedal, 'input', SCALE);
    routeAndVerify(from, to, setup2, null, 'fx1', 'amp_send→fx1');
  });
});

describe('single validation policy', () => {
  it('mid-routing acceptance and final validation agree on the same paths', async () => {
    const setup = makeTwoRowSetup();
    const obstacles = generateObstacles(setup.placed, setup.pedalsById, setup.board, SCALE);
    const { isPathClear } = await import('../../geometry');

    // A path straight through the middle of p1 (clearly invalid)
    const p1Box = obstacles.boxes[obstacles.pedalIdToBox.get('p1')!];
    const through: Point[] = [
      { x: p1Box.x - 100, y: p1Box.y + p1Box.height / 2 },
      { x: p1Box.x + p1Box.width + 100, y: p1Box.y + p1Box.height / 2 },
    ];
    // A path far above all pedals (clearly valid)
    const above: Point[] = [
      { x: 100, y: 20 },
      { x: 700, y: 20 },
    ];

    for (const [path, expected] of [[through, false], [above, true]] as const) {
      const internal = isPathClear(path as Point[], obstacles.boxes);
      const final = validateCablePath(path as Point[], obstacles).valid;
      expect(internal).toBe(expected);
      expect(final).toBe(expected);
      expect(internal).toBe(final);
    }
  });
});

describe('cables never cross their own pedal bodies (regression: BF-3 → RC-1)', () => {
  it('routes around when the output jack faces AWAY from the destination', () => {
    // Recreate the real-world failure: source pedal flush against the board
    // left edge with its output on the LEFT edge, destination to its RIGHT.
    // The old router drew a straight line through both pedal bodies because
    // source/destination were excluded from validation.
    const setup = makeTwoRowSetup();
    const src = makePedal('pedal-src');
    const dst = makePedal('pedal-dst');
    setup.pedalsById[src.id] = src;
    setup.pedalsById[dst.id] = dst;
    const srcPlaced = makePlaced('src', src.id, 0, 0.5, 10);      // top-left corner
    const dstPlaced = makePlaced('dst', dst.id, 3.375, 0.5, 11);  // right of it
    setup.placed.push(srcPlaced, dstPlaced);

    // Synthetic jacks: output on LEFT edge mid (x=0 - faces off-board),
    // input on RIGHT edge mid of the destination (faces away from source)
    const from = getPedalJackPx(srcPlaced, src, 'output', SCALE);
    const to = getPedalJackPx(dstPlaced, dst, 'input', SCALE);
    expect(from.x).toBe(0); // on the board edge, facing away

    const result = routeAndVerify(from, to, setup, 'src', 'dst', 'src→dst (jacks facing away)');

    // The path must physically go AROUND: it needs more than a straight line
    expect(result.path.length).toBeGreaterThan(2);
  });

  it('adjacent facing jacks still get a direct two-stub connection', () => {
    const setup = makeTwoRowSetup();
    const p1 = setup.placed.find(p => p.id === 'p1')!;
    const p2 = setup.placed.find(p => p.id === 'p2')!;
    const from = getPedalJackPx(p1, setup.pedalsById[p1.pedalId], 'output', SCALE);
    const to = getPedalJackPx(p2, setup.pedalsById[p2.pedalId], 'input', SCALE);
    const result = routeAndVerify(from, to, setup, 'p1', 'p2', 'p1→p2 facing');
    // Straight or near-straight: no detour needed for facing jacks
    expect(result.path.length).toBeLessThanOrEqual(3);
  });
});

describe('lane separation (parallel cables stay distinguishable)', () => {
  it('spreads cables sharing a corridor onto distinct lanes', async () => {
    const { routeAllCables } = await import('../route-cables');
    const setup = makeTwoRowSetup();

    // Two long cables that both want the corridor above the rows:
    // guitar → p6 (back-row left) and p4 → amp-ish long run.
    const cables = [
      {
        id: 'c1', configurationId: 'c', fromType: 'guitar' as const, fromPedalId: null,
        fromJack: null, toType: 'pedal' as const, toPedalId: 'p6', toJack: 'input',
        calculatedLengthInches: 0, cableType: 'instrument' as const, sortOrder: 0, createdAt: NOW,
      },
      {
        id: 'c2', configurationId: 'c', fromType: 'guitar' as const, fromPedalId: null,
        fromJack: null, toType: 'pedal' as const, toPedalId: 'p5', toJack: 'input',
        calculatedLengthInches: 0, cableType: 'patch' as const, sortOrder: 1, createdAt: NOW,
      },
    ];

    const routed = routeAllCables(cables, setup.placed, setup.pedalsById, setup.board, SCALE, false);
    expect(routed.length).toBe(2);
    expect(routed.every((rc) => rc.valid)).toBe(true);

    // Collect long horizontal runs from middle segments of both cables
    const runs: Array<{ cable: string; y: number; lo: number; hi: number }> = [];
    for (const rc of routed) {
      for (let i = 1; i < rc.path.length - 2; i++) {
        const a = rc.path[i];
        const b = rc.path[i + 1];
        if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 12) {
          runs.push({ cable: rc.cable.id, y: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
        }
      }
    }

    // No two runs from DIFFERENT cables may coincide (same y, overlapping x)
    for (const r1 of runs) {
      for (const r2 of runs) {
        if (r1.cable === r2.cable) continue;
        const overlap = Math.min(r1.hi, r2.hi) - Math.max(r1.lo, r2.lo);
        if (overlap > 12) {
          expect(
            Math.abs(r1.y - r2.y),
            `runs of ${r1.cable} (y=${r1.y}) and ${r2.cable} (y=${r2.y}) overlap ${overlap.toFixed(0)}px horizontally but coincide vertically`
          ).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });
});
