'use client';

import type { Cable, PlacedPedal, Pedal, Board } from '@/types';

interface Point { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

const STANDOFF = 30;
const CORNER_MARGIN = 50; // Margin around pedal corners - increased for better visual separation
const COLLISION_MARGIN = 30; // Margin for collision detection - increased to keep cables visually clear of pedals
const DEBUG_ASCII = false; // Enable ASCII visualization for debugging
const DEBUG_VALIDATION = false; // Log detailed collision validation
const DEBUG_PATHS = false; // Log all paths for debugging

// Distance between two points
function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Check if a line segment from p1 to p2 intersects a box (with margin)
// Uses separating axis theorem - simpler and more reliable
function lineIntersectsBox(p1: Point, p2: Point, box: Box, margin: number = 8): boolean {
  const left = box.x - margin;
  const right = box.x + box.width + margin;
  const top = box.y - margin;
  const bottom = box.y + box.height + margin;

  // Quick bounding box rejection
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (maxX < left || minX > right || maxY < top || minY > bottom) {
    return false;
  }

  // Check if either endpoint is inside the box
  if (p1.x >= left && p1.x <= right && p1.y >= top && p1.y <= bottom) return true;
  if (p2.x >= left && p2.x <= right && p2.y >= top && p2.y <= bottom) return true;

  // Check line against each edge of the box
  const edges = [
    [{ x: left, y: top }, { x: right, y: top }],     // Top edge
    [{ x: right, y: top }, { x: right, y: bottom }], // Right edge
    [{ x: right, y: bottom }, { x: left, y: bottom }], // Bottom edge
    [{ x: left, y: bottom }, { x: left, y: top }],  // Left edge
  ];

  for (const [e1, e2] of edges) {
    if (segmentsIntersect(p1, p2, e1, e2)) {
      return true;
    }
  }

  return false;
}

// Check if two line segments intersect
function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;

  return false;
}

function direction(p1: Point, p2: Point, p3: Point): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1: Point, p2: Point, p: Point): boolean {
  return p.x >= Math.min(p1.x, p2.x) && p.x <= Math.max(p1.x, p2.x) &&
         p.y >= Math.min(p1.y, p2.y) && p.y <= Math.max(p1.y, p2.y);
}

// Check if path between two points is clear of all boxes (optionally excluding some)
function isPathClear(p1: Point, p2: Point, boxes: Box[], excludeIndices: Set<number> = new Set()): boolean {
  for (let i = 0; i < boxes.length; i++) {
    if (excludeIndices.has(i)) continue;
    if (lineIntersectsBox(p1, p2, boxes[i], COLLISION_MARGIN)) return false;
  }
  return true;
}

// Get the box index containing a point
function getBoxIndex(p: Point, boxes: Box[]): number {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (p.x >= box.x && p.x <= box.x + box.width &&
        p.y >= box.y && p.y <= box.y + box.height) {
      return i;
    }
  }
  return -1;
}

// Calculate standoff point perpendicular to the jack's edge
function getStandoff(jack: Point, box: Box | null): Point {
  if (!box) {
    // External connection (guitar/amp)
    return jack.x < 0
      ? { x: jack.x + STANDOFF, y: jack.y }
      : { x: jack.x - STANDOFF, y: jack.y };
  }

  // Find closest edge
  const dLeft = Math.abs(jack.x - box.x);
  const dRight = Math.abs(jack.x - (box.x + box.width));
  const dTop = Math.abs(jack.y - box.y);
  const dBottom = Math.abs(jack.y - (box.y + box.height));
  const min = Math.min(dLeft, dRight, dTop, dBottom);

  if (min === dLeft) return { x: box.x - STANDOFF, y: jack.y };
  if (min === dRight) return { x: box.x + box.width + STANDOFF, y: jack.y };
  if (min === dTop) return { x: jack.x, y: box.y - STANDOFF };
  return { x: jack.x, y: box.y + box.height + STANDOFF };
}

// Check if a point is inside any box (with optional exclusions)
function isPointInsideAnyBox(p: Point, boxes: Box[], exclude: Set<number> = new Set()): number {
  for (let i = 0; i < boxes.length; i++) {
    if (exclude.has(i)) continue;
    const box = boxes[i];
    if (p.x >= box.x && p.x <= box.x + box.width &&
        p.y >= box.y && p.y <= box.y + box.height) {
      return i;
    }
  }
  return -1;
}

// Get ALL box indices that contain a point (handles overlapping boxes)
function getAllBoxIndices(p: Point, boxes: Box[]): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (p.x >= box.x && p.x <= box.x + box.width &&
        p.y >= box.y && p.y <= box.y + box.height) {
      result.add(i);
    }
  }
  return result;
}

// Smart pathfinding - tries multiple strategies in order of preference:
// 1. Direct path (if clear)
// 2. Simple orthogonal (L-shaped) paths
// 3. Route through center gap between pedal rows
// 4. Route via perimeter as fallback
function findPathAStar(start: Point, end: Point, boxes: Box[], fromBoxIdx: number = -1, toBoxIdx: number = -1): Point[] {
  // Build exclude set for source/dest AND any boxes that overlap with them
  const excludeSet = new Set<number>();

  const boxesOverlap = (a: Box, b: Box): boolean => {
    return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
             a.y + a.height <= b.y || b.y + b.height <= a.y);
  };

  if (fromBoxIdx >= 0) {
    excludeSet.add(fromBoxIdx);
    const srcBox = boxes[fromBoxIdx];
    for (let i = 0; i < boxes.length; i++) {
      if (i !== fromBoxIdx && boxesOverlap(srcBox, boxes[i])) {
        excludeSet.add(i);
      }
    }
  }

  if (toBoxIdx >= 0) {
    excludeSet.add(toBoxIdx);
    const destBox = boxes[toBoxIdx];
    for (let i = 0; i < boxes.length; i++) {
      if (i !== toBoxIdx && boxesOverlap(destBox, boxes[i])) {
        excludeSet.add(i);
      }
    }
  }

  // STRATEGY 1: Direct path
  // For direct path to be valid, the line should NOT pass through the interior of the destination box
  // It should only "touch" the destination at the jack position
  if (isPathClear(start, end, boxes, excludeSet)) {
    // Additional check: if destination box exists, verify we're not passing through its interior
    let directPathValid = true;
    if (toBoxIdx >= 0) {
      const destBox = boxes[toBoxIdx];
      // Check if start point is outside dest box
      const startOutsideDest = start.x < destBox.x || start.x > destBox.x + destBox.width ||
                                start.y < destBox.y || start.y > destBox.y + destBox.height;
      if (startOutsideDest) {
        // If start is outside dest, check if the line would pass through dest's interior
        // The line should only touch dest at the end point (jack position)
        // We use a slightly expanded box to catch lines that just clip the edge
        const expandedDestBox = {
          x: destBox.x + 5,
          y: destBox.y + 5,
          width: destBox.width - 10,
          height: destBox.height - 10
        };
        if (expandedDestBox.width > 0 && expandedDestBox.height > 0) {
          // Check if line from start to a point BEFORE the end intersects the expanded box
          // Sample points along the line (except the last 10%)
          for (let t = 0; t < 0.9; t += 0.1) {
            const checkPoint = {
              x: start.x + (end.x - start.x) * t,
              y: start.y + (end.y - start.y) * t
            };
            if (checkPoint.x >= expandedDestBox.x && checkPoint.x <= expandedDestBox.x + expandedDestBox.width &&
                checkPoint.y >= expandedDestBox.y && checkPoint.y <= expandedDestBox.y + expandedDestBox.height) {
              directPathValid = false;
              break;
            }
          }
        }
      }
    }
    if (directPathValid) {
      return [start, end];
    }
  }

  // Find bounding box of ALL pedals
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  }

  const margin = CORNER_MARGIN;
  const perimTop = minY - margin;
  const perimBottom = maxY + margin;
  const perimLeft = minX - margin;
  const perimRight = maxX + margin;

  // STRATEGY 2: Simple L-shaped paths (horizontal then vertical, or vertical then horizontal)
  // This works well for adjacent pedals
  // IMPORTANT: The intermediate point should NOT be inside the destination box
  // Only the FINAL segment can enter the destination
  const midH = { x: end.x, y: start.y };  // Horizontal first
  const midV = { x: start.x, y: end.y };  // Vertical first

  // Check if intermediate points are inside dest box (not allowed!)
  const midHInDest = toBoxIdx >= 0 &&
    midH.x >= boxes[toBoxIdx].x && midH.x <= boxes[toBoxIdx].x + boxes[toBoxIdx].width &&
    midH.y >= boxes[toBoxIdx].y && midH.y <= boxes[toBoxIdx].y + boxes[toBoxIdx].height;
  const midVInDest = toBoxIdx >= 0 &&
    midV.x >= boxes[toBoxIdx].x && midV.x <= boxes[toBoxIdx].x + boxes[toBoxIdx].width &&
    midV.y >= boxes[toBoxIdx].y && midV.y <= boxes[toBoxIdx].y + boxes[toBoxIdx].height;


  // For first segment (start->mid), only exclude source; for second segment (mid->end), exclude both
  const srcOnlyExclude = new Set<number>();
  if (fromBoxIdx >= 0) {
    srcOnlyExclude.add(fromBoxIdx);
    const srcBox = boxes[fromBoxIdx];
    for (let i = 0; i < boxes.length; i++) {
      if (i !== fromBoxIdx && boxesOverlap(srcBox, boxes[i])) {
        srcOnlyExclude.add(i);
      }
    }
  }

  if (!midHInDest && isPathClear(start, midH, boxes, srcOnlyExclude) && isPathClear(midH, end, boxes, excludeSet)) {
    return [start, midH, end];
  }

  if (!midVInDest && isPathClear(start, midV, boxes, srcOnlyExclude) && isPathClear(midV, end, boxes, excludeSet)) {
    return [start, midV, end];
  }

  // STRATEGY 3: Find horizontal gaps between pedal rows and route through them
  // Collect all y-boundaries of non-excluded boxes
  const yBoundaries: Array<{ y: number; isTop: boolean; boxIdx: number }> = [];
  for (let i = 0; i < boxes.length; i++) {
    if (excludeSet.has(i)) continue;
    yBoundaries.push({ y: boxes[i].y, isTop: true, boxIdx: i });
    yBoundaries.push({ y: boxes[i].y + boxes[i].height, isTop: false, boxIdx: i });
  }
  yBoundaries.sort((a, b) => a.y - b.y);

  // Find gaps (regions where no box exists)
  const gaps: Array<{ y1: number; y2: number }> = [];
  let lastBottom = -Infinity;
  for (const boundary of yBoundaries) {
    if (boundary.isTop && boundary.y > lastBottom + margin) {
      // Found a gap
      gaps.push({ y1: lastBottom, y2: boundary.y });
    }
    if (!boundary.isTop) {
      lastBottom = Math.max(lastBottom, boundary.y);
    }
  }

  // Helper to check if point is inside destination box
  const isInsideDestBox = (p: Point): boolean => {
    if (toBoxIdx < 0) return false;
    const box = boxes[toBoxIdx];
    return p.x >= box.x && p.x <= box.x + box.width &&
           p.y >= box.y && p.y <= box.y + box.height;
  };

  // STRATEGY 3a: If source and dest are in same row, route through center gap
  // Check if start and end are at similar Y positions (same row)
  const srcBox = fromBoxIdx >= 0 ? boxes[fromBoxIdx] : null;
  const destBox = toBoxIdx >= 0 ? boxes[toBoxIdx] : null;

  if (srcBox && destBox) {
    const srcCenterY = srcBox.y + srcBox.height / 2;
    const destCenterY = destBox.y + destBox.height / 2;
    const sameRow = Math.abs(srcCenterY - destCenterY) < 100; // Within 100px = same row

    if (sameRow) {
      // Find the actual gap between rows by looking at ALL pedals
      const rowTop = Math.min(srcBox.y, destBox.y);
      const rowBottom = Math.max(srcBox.y + srcBox.height, destBox.y + destBox.height);

      // Find the bottom of any row ABOVE our row
      let aboveRowBottom = -Infinity;
      // Find the top of any row BELOW our row
      let belowRowTop = Infinity;

      for (let i = 0; i < boxes.length; i++) {
        if (i === fromBoxIdx || i === toBoxIdx) continue; // Skip src/dest
        const box = boxes[i];
        const boxCenterY = box.y + box.height / 2;

        // If this box is above our row
        if (boxCenterY < rowTop) {
          aboveRowBottom = Math.max(aboveRowBottom, box.y + box.height);
        }
        // If this box is below our row
        if (boxCenterY > rowBottom) {
          belowRowTop = Math.min(belowRowTop, box.y);
        }
      }

      // For same-row routing, determine if dest is to the left or right
      const destIsLeft = destBox.x + destBox.width / 2 < srcBox.x + srcBox.width / 2;

      // Calculate routing Y - either through gap above, or just above the row if no gap
      let routeY: number;
      if (aboveRowBottom > -Infinity) {
        // There's a row above - use the center of the gap
        routeY = (aboveRowBottom + rowTop) / 2;
        // Ensure we're in the clear zone
        if (routeY <= aboveRowBottom + COLLISION_MARGIN || routeY >= rowTop - COLLISION_MARGIN) {
          routeY = rowTop - COLLISION_MARGIN - 5; // Just above our row with small margin
        }
      } else {
        // No row above - route just above our row with minimal clearance
        // Use a small margin to stay close to the board
        routeY = Math.max(rowTop - COLLISION_MARGIN - 5, -20); // Don't go more than 20px above board
      }

      // Simple L-shaped route: up to routeY, then across, then down
      const p1 = { x: start.x, y: routeY };
      const p2 = { x: end.x, y: routeY };

      // Check if this simple route works
      // For same-row routing, exclude BOTH source and dest for the horizontal segment
      // since we're routing above/below both pedals
      const path1Clear = isPathClear(start, p1, boxes, excludeSet);
      const path2Clear = isPathClear(p1, p2, boxes, excludeSet); // Exclude both for horizontal
      const path3Clear = isPathClear(p2, end, boxes, excludeSet);

      if (path1Clear && path2Clear && path3Clear) {
        return [start, p1, p2, end];
      }

      // If simple route doesn't work, try routing away from dest first
      const escapeX = destIsLeft
        ? srcBox.x + srcBox.width + margin / 2  // Go to right of source
        : srcBox.x - margin / 2;                 // Go to left of source

      const p1Escape = { x: escapeX, y: start.y };
      const p2Escape = { x: escapeX, y: routeY };
      const p3Escape = { x: end.x, y: routeY };

      const escapePath1Clear = isPathClear(start, p1Escape, boxes, srcOnlyExclude);
      const escapePath2Clear = isPathClear(p1Escape, p2Escape, boxes, srcOnlyExclude);
      const escapePath3Clear = isPathClear(p2Escape, p3Escape, boxes, srcOnlyExclude);
      const escapePath4Clear = isPathClear(p3Escape, end, boxes, excludeSet);

      if (escapePath1Clear && escapePath2Clear && escapePath3Clear && escapePath4Clear) {
        return [start, p1Escape, p2Escape, p3Escape, end];
      }
    }
  }

  // STRATEGY 3b: Try routing through detected gaps between rows
  for (const gap of gaps) {
    const gapY = (gap.y1 + gap.y2) / 2;

    // Check if this gap is between start and end vertically
    const startY = start.y;
    const endY = end.y;
    const minStartEndY = Math.min(startY, endY);
    const maxStartEndY = Math.max(startY, endY);

    // Only use gap if it's roughly between start and end
    if (gapY >= minStartEndY - 100 && gapY <= maxStartEndY + 100) {
      // Route: start -> (start.x, gapY) -> (end.x, gapY) -> end
      const p1 = { x: start.x, y: gapY };
      const p2 = { x: end.x, y: gapY };

      // Intermediate points should NOT be inside destination box
      if (isInsideDestBox(p1) || isInsideDestBox(p2)) continue;

      if (isPathClear(start, p1, boxes, srcOnlyExclude) &&
          isPathClear(p1, p2, boxes, srcOnlyExclude) &&
          isPathClear(p2, end, boxes, excludeSet)) {
        return [start, p1, p2, end];
      }
    }
  }

  // STRATEGY 4: Route via edges of adjacent boxes (for adjacent pedals)
  // srcBox and destBox already defined above in Strategy 3a
  if (srcBox && destBox) {
    // Try routing around the edge of source box
    const srcEdges = [
      { x: srcBox.x - margin, y: start.y },           // Left of source
      { x: srcBox.x + srcBox.width + margin, y: start.y }, // Right of source
      { x: start.x, y: srcBox.y - margin },           // Above source
      { x: start.x, y: srcBox.y + srcBox.height + margin } // Below source
    ];

    const destEdges = [
      { x: destBox.x - margin, y: end.y },
      { x: destBox.x + destBox.width + margin, y: end.y },
      { x: end.x, y: destBox.y - margin },
      { x: end.x, y: destBox.y + destBox.height + margin }
    ];

    // Try each combination of source edge -> dest edge
    for (const srcEdge of srcEdges) {
      // Skip if srcEdge is inside destination
      if (isInsideDestBox(srcEdge)) continue;
      if (!isPathClear(start, srcEdge, boxes, srcOnlyExclude)) continue;

      for (const destEdge of destEdges) {
        // Skip if destEdge is inside destination (shouldn't happen but check anyway)
        if (isInsideDestBox(destEdge)) continue;
        if (!isPathClear(destEdge, end, boxes, excludeSet)) continue;

        // Try direct connection between edges
        if (isPathClear(srcEdge, destEdge, boxes, srcOnlyExclude)) {
          return [start, srcEdge, destEdge, end];
        }

        // Try L-shaped connection between edges
        const midH2 = { x: destEdge.x, y: srcEdge.y };
        const midV2 = { x: srcEdge.x, y: destEdge.y };

        // Skip if intermediate points are inside destination
        if (!isInsideDestBox(midH2) &&
            isPathClear(srcEdge, midH2, boxes, srcOnlyExclude) &&
            isPathClear(midH2, destEdge, boxes, srcOnlyExclude)) {
          return [start, srcEdge, midH2, destEdge, end];
        }

        if (!isInsideDestBox(midV2) &&
            isPathClear(srcEdge, midV2, boxes, srcOnlyExclude) &&
            isPathClear(midV2, destEdge, boxes, srcOnlyExclude)) {
          return [start, srcEdge, midV2, destEdge, end];
        }
      }
    }
  }

  // STRATEGY 5: Route via perimeter (top or bottom)
  // Check that intermediate points aren't inside dest box
  const topP1 = { x: start.x, y: perimTop };
  const topP2 = { x: end.x, y: perimTop };
  if (!isInsideDestBox(topP1) && !isInsideDestBox(topP2)) {
    const topRoute = [start, topP1, topP2, end];
    let topValid = true;
    for (let i = 0; i < topRoute.length - 1; i++) {
      const useExclude = i === topRoute.length - 2 ? excludeSet : srcOnlyExclude;
      if (!isPathClear(topRoute[i], topRoute[i + 1], boxes, useExclude)) {
        topValid = false;
        break;
      }
    }
    if (topValid) return topRoute;
  }

  // Try bottom perimeter
  const bottomP1 = { x: start.x, y: perimBottom };
  const bottomP2 = { x: end.x, y: perimBottom };
  if (!isInsideDestBox(bottomP1) && !isInsideDestBox(bottomP2)) {
    const bottomRoute = [start, bottomP1, bottomP2, end];
    let bottomValid = true;
    for (let i = 0; i < bottomRoute.length - 1; i++) {
      const useExclude = i === bottomRoute.length - 2 ? excludeSet : srcOnlyExclude;
      if (!isPathClear(bottomRoute[i], bottomRoute[i + 1], boxes, useExclude)) {
        bottomValid = false;
        break;
      }
    }
    if (bottomValid) return bottomRoute;
  }

  // STRATEGY 6: L-shaped via corners
  const cornerRoutes = [
    [start, { x: perimLeft, y: start.y }, { x: perimLeft, y: end.y }, end],
    [start, { x: perimRight, y: start.y }, { x: perimRight, y: end.y }, end],
    [start, { x: start.x, y: perimTop }, { x: perimLeft, y: perimTop }, { x: perimLeft, y: end.y }, end],
    [start, { x: start.x, y: perimBottom }, { x: perimLeft, y: perimBottom }, { x: perimLeft, y: end.y }, end],
  ];

  for (let routeIdx = 0; routeIdx < cornerRoutes.length; routeIdx++) {
    const route = cornerRoutes[routeIdx];
    // Check no intermediate points are inside dest box
    let hasInsideDest = false;
    for (let i = 1; i < route.length - 1; i++) {
      if (isInsideDestBox(route[i])) {
        hasInsideDest = true;
        break;
      }
    }
    if (hasInsideDest) continue;

    let valid = true;
    for (let i = 0; i < route.length - 1; i++) {
      const useExclude = i === route.length - 2 ? excludeSet : srcOnlyExclude;
      if (!isPathClear(route[i], route[i + 1], boxes, useExclude)) {
        valid = false;
        break;
      }
    }
    if (valid) {
      return route;
    }
  }

  // FALLBACK: Route via top-left perimeter (go up first, then left, then down)
  // This ensures we don't cut through pedals that might be on the same horizontal level
  return [start, { x: start.x, y: perimTop }, { x: perimLeft, y: perimTop }, { x: perimLeft, y: end.y }, end];
}

interface JackInfo {
  point: Point;
  type: 'input' | 'output' | 'send' | 'return';
  pedalIndex: number;
}

// ASCII visualization for debugging - shows pedals with jacks and cable path
function printASCIIGrid(
  boxes: Box[],
  path: Point[],
  cableId: string,
  startJack: Point,
  endJack: Point,
  allJacks: JackInfo[]
): void {
  if (!DEBUG_ASCII) return;

  // Find bounds - include all jacks
  const allX = [
    ...boxes.flatMap(b => [b.x, b.x + b.width]),
    ...path.map(p => p.x),
    ...allJacks.map(j => j.point.x)
  ];
  const allY = [
    ...boxes.flatMap(b => [b.y, b.y + b.height]),
    ...path.map(p => p.y),
    ...allJacks.map(j => j.point.y)
  ];
  const minX = Math.min(...allX) - 40;
  const maxX = Math.max(...allX) + 40;
  const minY = Math.min(...allY) - 20;
  const maxY = Math.max(...allY) + 20;

  // Scale to reasonable ASCII size
  const width = 100;
  const height = 35;
  const scaleX = (x: number) => Math.round(((x - minX) / (maxX - minX)) * (width - 1));
  const scaleY = (y: number) => Math.round(((y - minY) / (maxY - minY)) * (height - 1));

  // Create grid
  const grid: string[][] = Array(height).fill(null).map(() => Array(width).fill(' '));

  // Draw boxes (pedals)
  boxes.forEach((box, idx) => {
    const x1 = scaleX(box.x);
    const x2 = scaleX(box.x + box.width);
    const y1 = scaleY(box.y);
    const y2 = scaleY(box.y + box.height);

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          if (y === y1 || y === y2 || x === x1 || x === x2) {
            grid[y][x] = '#';
          } else {
            grid[y][x] = '.';
          }
        }
      }
    }
    // Label pedal index in center
    const cx = Math.round((x1 + x2) / 2);
    const cy = Math.round((y1 + y2) / 2);
    if (cy >= 0 && cy < height && cx >= 0 && cx < width) {
      grid[cy][cx] = String(idx);
    }
  });

  // Draw all jacks (i=input, o=output, s=send, r=return)
  for (const jack of allJacks) {
    const jx = scaleX(jack.point.x);
    const jy = scaleY(jack.point.y);
    if (jy >= 0 && jy < height && jx >= 0 && jx < width) {
      const char = jack.type === 'input' ? 'i' : jack.type === 'output' ? 'o' : jack.type === 'send' ? 's' : 'r';
      grid[jy][jx] = char;
    }
  }

  // Draw path
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const x1 = scaleX(p1.x);
    const y1 = scaleY(p1.y);
    const x2 = scaleX(p2.x);
    const y2 = scaleY(p2.y);

    // Draw line between points
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x1 + (x2 - x1) * s / steps);
      const y = Math.round(y1 + (y2 - y1) * s / steps);
      if (y >= 0 && y < height && x >= 0 && x < width) {
        const current = grid[y][x];
        if (current === ' ') {
          if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
            grid[y][x] = '-';
          } else if (Math.abs(y2 - y1) > Math.abs(x2 - x1)) {
            grid[y][x] = '|';
          } else {
            grid[y][x] = '*';
          }
        } else if (current === '-' || current === '|') {
          grid[y][x] = '+';
        }
      }
    }
  }

  // Mark start (S) and end (E) - the actual jack positions
  const startX = scaleX(startJack.x);
  const startY = scaleY(startJack.y);
  const endX = scaleX(endJack.x);
  const endY = scaleY(endJack.y);
  if (startY >= 0 && startY < height && startX >= 0 && startX < width) grid[startY][startX] = 'S';
  if (endY >= 0 && endY < height && endX >= 0 && endX < width) grid[endY][endX] = 'E';

  // Print as single string so browser captures it
  const lines: string[] = [];
  lines.push(`[Cable] ${cableId}`);
  lines.push(`Legend: #=pedal border, i=input jack, o=output jack, s=send, r=return, S=cable start, E=cable end`);
  lines.push(`Pedals: ${boxes.length}, Jacks shown: ${allJacks.length}`);
  lines.push('┌' + '─'.repeat(width) + '┐');
  for (const row of grid) {
    lines.push('│' + row.join('') + '│');
  }
  lines.push('└' + '─'.repeat(width) + '┘');
  lines.push(`Path: ${path.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join('→')}`);
  console.log(lines.join('\n'));
}

// VALIDATION: Check if path goes through any pedal boxes
// Returns array of collision descriptions, empty if path is valid
function validatePath(
  path: Point[],
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number
): string[] {
  const errors: string[] = [];

  // Find ALL boxes containing start and end points (for overlapping pedals)
  const start = path[0];
  const end = path[path.length - 1];
  const startBoxes = new Set<number>();
  const endBoxes = new Set<number>();

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (start.x >= box.x && start.x <= box.x + box.width &&
        start.y >= box.y && start.y <= box.y + box.height) {
      startBoxes.add(i);
    }
    if (end.x >= box.x && end.x <= box.x + box.width &&
        end.y >= box.y && end.y <= box.y + box.height) {
      endBoxes.add(i);
    }
  }

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];

    for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
      const box = boxes[boxIdx];

      // Check if segment endpoints are inside this box
      const p1InBox = p1.x >= box.x && p1.x <= box.x + box.width &&
                      p1.y >= box.y && p1.y <= box.y + box.height;
      const p2InBox = p2.x >= box.x && p2.x <= box.x + box.width &&
                      p2.y >= box.y && p2.y <= box.y + box.height;

      // Skip collision with source boxes if segment starts inside (exiting source)
      if (p1InBox && startBoxes.has(boxIdx)) continue;

      // Skip collision with dest boxes if segment ends inside (entering dest)
      if (p2InBox && endBoxes.has(boxIdx)) continue;

      // Skip collision if this is a direct connection within overlapping boxes
      // (both endpoints in their respective source/dest boxes)
      if (p1InBox && p2InBox && (startBoxes.has(boxIdx) || endBoxes.has(boxIdx))) continue;

      if (lineIntersectsBox(p1, p2, box, 5)) {
        errors.push(`Segment ${i} (${Math.round(p1.x)},${Math.round(p1.y)})→(${Math.round(p2.x)},${Math.round(p2.y)}) COLLIDES with box ${boxIdx} (x:${box.x.toFixed(0)}-${(box.x+box.width).toFixed(0)}, y:${box.y.toFixed(0)}-${(box.y+box.height).toFixed(0)})`);
      }
    }
  }

  return errors;
}

// Print validation result for a cable path
function printValidation(
  cableId: string,
  path: Point[],
  boxes: Box[],
  fromBoxIdx: number,
  toBoxIdx: number
): void {
  if (!DEBUG_ASCII) return;

  const errors = validatePath(path, boxes, fromBoxIdx, toBoxIdx);
  if (errors.length === 0) {
    console.log(`[Cable] ✓ VALID: ${cableId}`);
  } else {
    console.log(`[Cable] ✗ INVALID: ${cableId}`);
    for (const err of errors) {
      console.log(`[Cable]   ${err}`);
    }
  }
}

// Convert path to orthogonal segments (only horizontal and vertical)
// IMPORTANT: Check ALL boxes for collisions - intermediate waypoints should not be inside ANY pedal
// The only points allowed inside pedals are the actual jack positions (start/end of path)
function makeOrthogonal(path: Point[], boxes: Box[], excludeIndices: Set<number> = new Set()): Point[] {
  if (path.length < 2) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];
    const isLastSegment = (i === path.length - 1);

    // If not already horizontal or vertical, add intermediate point
    if (Math.abs(prev.x - curr.x) > 1 && Math.abs(prev.y - curr.y) > 1) {
      // Try both directions and pick the one without collision
      const horizontalFirst = { x: curr.x, y: prev.y };
      const verticalFirst = { x: prev.x, y: curr.y };

      // Check which option has fewer collisions
      // CRITICAL: Check ALL boxes, don't exclude destination box for intermediate points
      // Only the final destination point (curr on last segment) can be inside dest box
      let hCollision = false;
      let vCollision = false;

      for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
        const box = boxes[boxIdx];
        const isExcluded = excludeIndices.has(boxIdx);

        // Check if intermediate point itself is inside a box (bad unless it's source/dest)
        const hPointInBox = horizontalFirst.x >= box.x && horizontalFirst.x <= box.x + box.width &&
                            horizontalFirst.y >= box.y && horizontalFirst.y <= box.y + box.height;
        const vPointInBox = verticalFirst.x >= box.x && verticalFirst.x <= box.x + box.width &&
                            verticalFirst.y >= box.y && verticalFirst.y <= box.y + box.height;

        if (hPointInBox && !isExcluded) hCollision = true;
        if (vPointInBox && !isExcluded) vCollision = true;

        // Check line segments for intersection
        // For source/dest boxes (excluded), allow cable to exit/enter
        // For all other boxes, ANY intersection is a collision
        if (lineIntersectsBox(prev, horizontalFirst, box, COLLISION_MARGIN)) {
          if (!isExcluded) {
            hCollision = true;
          }
        }
        if (lineIntersectsBox(horizontalFirst, curr, box, COLLISION_MARGIN)) {
          if (!isExcluded || !isLastSegment) {
            // Only allow entering dest box on final segment
            if (!isExcluded) hCollision = true;
          }
        }

        if (lineIntersectsBox(prev, verticalFirst, box, COLLISION_MARGIN)) {
          if (!isExcluded) {
            vCollision = true;
          }
        }
        if (lineIntersectsBox(verticalFirst, curr, box, COLLISION_MARGIN)) {
          if (!isExcluded || !isLastSegment) {
            if (!isExcluded) vCollision = true;
          }
        }
      }

      // Choose based on collision detection, defaulting to longer direction
      if (!hCollision && !vCollision) {
        // Neither has collision, use longer direction
        if (Math.abs(curr.x - prev.x) > Math.abs(curr.y - prev.y)) {
          result.push(horizontalFirst);
        } else {
          result.push(verticalFirst);
        }
      } else if (!hCollision) {
        result.push(horizontalFirst);
      } else if (!vCollision) {
        result.push(verticalFirst);
      } else {
        // Both have collision - need to route around obstacles
        // Find blocking boxes that are NOT source/dest - check LINE INTERSECTIONS, not just point-in-box
        const nonExcludedBlockingBoxes: { box: Box; idx: number }[] = [];
        for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
          if (excludeIndices.has(boxIdx)) continue; // Skip source/dest boxes
          const box = boxes[boxIdx];

          // Check if EITHER orthogonal path would intersect this box
          const hPathIntersects = lineIntersectsBox(prev, horizontalFirst, box, COLLISION_MARGIN) ||
                                   lineIntersectsBox(horizontalFirst, curr, box, COLLISION_MARGIN);
          const vPathIntersects = lineIntersectsBox(prev, verticalFirst, box, COLLISION_MARGIN) ||
                                   lineIntersectsBox(verticalFirst, curr, box, COLLISION_MARGIN);

          if (hPathIntersects || vPathIntersects) {
            nonExcludedBlockingBoxes.push({ box, idx: boxIdx });
          }
        }

        if (nonExcludedBlockingBoxes.length === 0) {
          // Only source/dest boxes blocking - use direct orthogonal with smaller axis change
          if (Math.abs(curr.x - prev.x) <= Math.abs(curr.y - prev.y)) {
            result.push(horizontalFirst);
          } else {
            result.push(verticalFirst);
          }
        } else {
          // Real blocking boxes - route around them
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const { box } of nonExcludedBlockingBoxes) {
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
          }

          // Determine best route around based on prev position relative to blocking boxes
          const margin = CORNER_MARGIN;

          // Calculate distances to each side
          const distToLeft = Math.abs(prev.x - (minX - margin));
          const distToRight = Math.abs(prev.x - (maxX + margin));
          const distToTop = Math.abs(prev.y - (minY - margin));
          const distToBottom = Math.abs(prev.y - (maxY + margin));

          // Find minimum distance and route that way
          const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

          if (minDist === distToTop && prev.y < minY) {
            // Route above
            result.push({ x: prev.x, y: minY - margin });
            result.push({ x: curr.x, y: minY - margin });
          } else if (minDist === distToBottom && prev.y > maxY) {
            // Route below
            result.push({ x: prev.x, y: maxY + margin });
            result.push({ x: curr.x, y: maxY + margin });
          } else if (minDist === distToLeft || prev.x < (minX + maxX) / 2) {
            // Route around left side
            result.push({ x: minX - margin, y: prev.y });
            result.push({ x: minX - margin, y: curr.y });
          } else {
            // Route around right side
            result.push({ x: maxX + margin, y: prev.y });
            result.push({ x: maxX + margin, y: curr.y });
          }
        }
      }
    }
    result.push(curr);
  }

  return result;
}

interface CableRendererProps {
  cable: Cable;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  board: Board;
  scale: number;
  cableIndex?: number;
  totalCables?: number;
}

export function CableRenderer({ cable, placedPedals, pedalsById, board, scale, cableIndex = 0, totalCables = 1 }: CableRendererProps) {
  const boardWidth = board.widthInches * scale;
  const boardHeight = board.depthInches * scale;


  const getJackPosition = (type: string, pedalId: string | null, jackType: string | null): Point | null => {
    if (type === 'guitar') return { x: boardWidth + 60, y: boardHeight / 2 };
    if (type === 'amp_input') return { x: -60, y: boardHeight / 2 };
    if (type === 'amp_send') return { x: -60, y: boardHeight * 0.3 };
    if (type === 'amp_return') return { x: -60, y: boardHeight * 0.7 };

    if (type === 'pedal' && pedalId && jackType) {
      const placed = placedPedals.find((p) => p.id === pedalId);
      if (!placed) return null;

      const pedal = pedalsById[placed.pedalId] || placed.pedal;
      if (!pedal) return { x: placed.xInches * scale + 50, y: placed.yInches * scale + 50 };

      let jack = pedal.jacks?.find((j) => j.jackType === jackType);
      if (!jack && pedal.jacks?.length) {
        jack = jackType === 'input' || jackType === 'send'
          ? pedal.jacks.find((j) => j.jackType === 'input') || pedal.jacks.find((j) => j.side === 'right')
          : pedal.jacks.find((j) => j.jackType === 'output') || pedal.jacks.find((j) => j.side === 'left');
      }

      const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
      const w = (isRotated ? pedal.depthInches : pedal.widthInches) * scale;
      const h = (isRotated ? pedal.widthInches : pedal.depthInches) * scale;
      const x = placed.xInches * scale;
      const y = placed.yInches * scale;

      if (!jack) {
        return jackType === 'input' || jackType === 'send' ? { x: x + w, y: y + h / 2 } : { x, y: y + h / 2 };
      }

      let side = jack.side;
      if (isRotated) {
        const steps = placed.rotationDegrees / 90;
        const sides = ['top', 'right', 'bottom', 'left'] as const;
        side = sides[(sides.indexOf(side) + steps) % 4];
      }

      switch (side) {
        case 'top': return { x: x + (w * jack.positionPercent) / 100, y };
        case 'bottom': return { x: x + (w * jack.positionPercent) / 100, y: y + h };
        case 'left': return { x, y: y + (h * jack.positionPercent) / 100 };
        case 'right': return { x: x + w, y: y + (h * jack.positionPercent) / 100 };
      }
    }
    return null;
  };

  const fromPos = getJackPosition(cable.fromType, cable.fromPedalId, cable.fromJack);
  const toPos = getJackPosition(cable.toType, cable.toPedalId, cable.toJack);
  if (!fromPos || !toPos) return null;

  // Build obstacle boxes and collect all jack positions
  const boxes: Box[] = [];
  const allJacks: JackInfo[] = [];

  placedPedals.forEach((placed, pedalIndex) => {
    const pedal = pedalsById[placed.pedalId] || placed.pedal;
    if (!pedal) return;

    const isRotated = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
    const w = (isRotated ? pedal.depthInches : pedal.widthInches) * scale;
    const h = (isRotated ? pedal.widthInches : pedal.depthInches) * scale;
    const x = placed.xInches * scale;
    const y = placed.yInches * scale;

    boxes.push({ x, y, width: w, height: h });

    // Collect all jacks for this pedal
    if (pedal.jacks) {
      for (const jack of pedal.jacks) {
        let side = jack.side;
        if (isRotated) {
          const steps = placed.rotationDegrees / 90;
          const sides = ['top', 'right', 'bottom', 'left'] as const;
          side = sides[(sides.indexOf(side) + steps) % 4];
        }

        let jackPos: Point;
        switch (side) {
          case 'top': jackPos = { x: x + (w * jack.positionPercent) / 100, y }; break;
          case 'bottom': jackPos = { x: x + (w * jack.positionPercent) / 100, y: y + h }; break;
          case 'left': jackPos = { x, y: y + (h * jack.positionPercent) / 100 }; break;
          case 'right': jackPos = { x: x + w, y: y + (h * jack.positionPercent) / 100 }; break;
          default: jackPos = { x: x + w / 2, y: y + h / 2 };
        }

        allJacks.push({
          point: jackPos,
          type: jack.jackType as 'input' | 'output' | 'send' | 'return',
          pedalIndex
        });
      }
    }
  });

  // Find the specific box index for source and destination pedals (not ALL overlapping boxes)
  let fromBoxIdx = -1;
  let toBoxIdx = -1;
  if (cable.fromPedalId) {
    fromBoxIdx = placedPedals.findIndex(p => p.id === cable.fromPedalId);
  }
  if (cable.toPedalId) {
    toBoxIdx = placedPedals.findIndex(p => p.id === cable.toPedalId);
  }

  // Find path using A*, only excluding the specific source/destination pedals
  const rawPath = findPathAStar(fromPos, toPos, boxes, fromBoxIdx, toBoxIdx);

  // Build exclude set for source/destination boxes AND any overlapping boxes
  const excludeSet = new Set<number>();
  const boxesOverlap = (a: Box, b: Box): boolean => {
    return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
             a.y + a.height <= b.y || b.y + b.height <= a.y);
  };

  if (fromBoxIdx >= 0) {
    excludeSet.add(fromBoxIdx);
    const srcBox = boxes[fromBoxIdx];
    for (let i = 0; i < boxes.length; i++) {
      if (i !== fromBoxIdx && boxesOverlap(srcBox, boxes[i])) {
        excludeSet.add(i);
      }
    }
  }
  if (toBoxIdx >= 0) {
    excludeSet.add(toBoxIdx);
    const destBox = boxes[toBoxIdx];
    for (let i = 0; i < boxes.length; i++) {
      if (i !== toBoxIdx && boxesOverlap(destBox, boxes[i])) {
        excludeSet.add(i);
      }
    }
  }

  // Convert to orthogonal path, passing exclude set so we don't flag source/dest as collisions
  let path = makeOrthogonal(rawPath, boxes, excludeSet);

  // POST-VALIDATION: Check if path crosses any non-excluded boxes and reroute if needed
  // Helper to check if a segment is clear
  const isSegmentClear = (p1: Point, p2: Point): boolean => {
    for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
      if (excludeSet.has(boxIdx)) continue;
      if (lineIntersectsBox(p1, p2, boxes[boxIdx], 0)) return false;
    }
    return true;
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    let fixed = false;
    for (let i = 0; i < path.length - 1 && !fixed; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
        if (excludeSet.has(boxIdx)) continue;
        if (lineIntersectsBox(p1, p2, boxes[boxIdx], 0)) {
          const box = boxes[boxIdx];
          const isVertical = Math.abs(p1.x - p2.x) < Math.abs(p1.y - p2.y);

          // Try both escape directions and pick one that's clear
          let newSegments: Point[][] = [];
          if (isVertical) {
            const escapeLeft = box.x - CORNER_MARGIN;
            const escapeRight = box.x + box.width + CORNER_MARGIN;
            newSegments = [
              [{ x: escapeLeft, y: p1.y }, { x: escapeLeft, y: p2.y }],
              [{ x: escapeRight, y: p1.y }, { x: escapeRight, y: p2.y }]
            ];
          } else {
            const escapeAbove = box.y - CORNER_MARGIN;
            const escapeBelow = box.y + box.height + CORNER_MARGIN;
            newSegments = [
              [{ x: p1.x, y: escapeAbove }, { x: p2.x, y: escapeAbove }],
              [{ x: p1.x, y: escapeBelow }, { x: p2.x, y: escapeBelow }]
            ];
          }

          // Find an escape route that doesn't create new collisions
          for (const [waypoint1, waypoint2] of newSegments) {
            if (isSegmentClear(p1, waypoint1) && isSegmentClear(waypoint1, waypoint2) && isSegmentClear(waypoint2, p2)) {
              const newPath = [...path.slice(0, i + 1), waypoint1, waypoint2, ...path.slice(i + 1)];
              path = newPath;
              fixed = true;
              break;
            }
          }
          if (fixed) break;
        }
      }
    }
    if (!fixed) break;
  }

  // Log all paths for debugging
  if (DEBUG_PATHS) {
    const cableId = `${cable.fromType}:${cable.fromPedalId?.slice(0,4) || 'ext'} → ${cable.toType}:${cable.toPedalId?.slice(0,4) || 'ext'}`;
    const srcPedal = fromBoxIdx >= 0 ? placedPedals[fromBoxIdx] : null;
    const destPedal = toBoxIdx >= 0 ? placedPedals[toBoxIdx] : null;
    const srcName = srcPedal ? (pedalsById[srcPedal.pedalId]?.name || 'unknown') : 'ext';
    const destName = destPedal ? (pedalsById[destPedal.pedalId]?.name || 'unknown') : 'ext';
    console.log(`PATH: ${srcName} → ${destName} | ${path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('→')}`);
  }

  // Detailed validation logging - check ALL cables for real intersections
  if (DEBUG_VALIDATION) {
    const cableId = `${cable.fromType}:${cable.fromPedalId?.slice(0,4) || 'ext'} → ${cable.toType}:${cable.toPedalId?.slice(0,4) || 'ext'}`;

    // Check for ACTUAL intersections with NON-EXCLUDED boxes
    const violations: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      for (let boxIdx = 0; boxIdx < boxes.length; boxIdx++) {
        if (excludeSet.has(boxIdx)) continue; // Skip source/dest boxes
        const box = boxes[boxIdx];
        const intersects = lineIntersectsBox(p1, p2, box, 0); // Check with 0 margin for actual intersection

        if (intersects) {
          const placed = placedPedals[boxIdx];
          const pedal = placed ? (pedalsById[placed.pedalId] || placed.pedal) : null;
          violations.push(`Seg${i} (${p1.x.toFixed(0)},${p1.y.toFixed(0)})→(${p2.x.toFixed(0)},${p2.y.toFixed(0)}) CROSSES ${pedal?.name || `Box${boxIdx}`}`);
        }
      }
    }

    if (violations.length > 0) {
      // Log everything in one line so Playwright captures it
      const info = `!!! COLLISION: ${cableId} | boxes=${fromBoxIdx}→${toBoxIdx} | CROSSES: ${violations.map(v => v.split('CROSSES ')[1]).join(', ')} | Path: ${path.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('→')}`;
      console.log(info);
    }
  }

  // ASCII debug visualization (when enabled)
  if (DEBUG_ASCII) {
    const cableId = `${cable.fromType}:${cable.fromPedalId?.slice(0,4) || 'ext'} → ${cable.toType}:${cable.toPedalId?.slice(0,4) || 'ext'}`;

    // Log boxes for first cable
    if (cable.fromType === 'guitar') {
      const boxStr = boxes.map((b, i) => `${i}:x${b.x.toFixed(0)}-${(b.x+b.width).toFixed(0)},y${b.y.toFixed(0)}-${(b.y+b.height).toFixed(0)}`).join(' | ');
      console.log(`[Cable] BOXES: ${boxStr}`);
    }

    printASCIIGrid(boxes, path, cableId, fromPos, toPos, allJacks);

    // VALIDATE: Check and report if path goes through any pedal
    printValidation(cableId, path, boxes, fromBoxIdx, toBoxIdx);
  }

  const pathD = 'M ' + path.map(p => `${p.x} ${p.y}`).join(' L ');

  const color = cable.cableType === 'instrument' ? '#f59e0b' :
                cable.cableType === 'power' ? '#ef4444' : '#22c55e';

  // Debug: draw collision boxes to verify they match pedal positions
  const DEBUG_BOXES = false;
  const isFirstCable = cable.fromType === 'guitar';

  // Log pedal positions when this is the first cable
  if (DEBUG_BOXES && isFirstCable) {
    console.log('=== PEDAL BOXES ===');
    boxes.forEach((box, i) => {
      const placed = placedPedals[i];
      const pedal = placed ? (pedalsById[placed.pedalId] || placed.pedal) : null;
      console.log(`Box ${i}: ${pedal?.name} x=${box.x.toFixed(0)}-${(box.x + box.width).toFixed(0)}, y=${box.y.toFixed(0)}-${(box.y + box.height).toFixed(0)}`);
    });
    console.log('=== END PEDAL BOXES ===');
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Debug: Show collision boxes with labels */}
      {DEBUG_BOXES && isFirstCable && boxes.map((box, i) => {
        const placed = placedPedals[i];
        const pedal = placed ? (pedalsById[placed.pedalId] || placed.pedal) : null;
        return (
          <g key={`debug-box-${i}`}>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill="rgba(255,0,0,0.1)"
              stroke="red"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
            <text
              x={box.x + 5}
              y={box.y + 15}
              fill="red"
              fontSize={12}
              fontWeight="bold"
            >
              {i}: {pedal?.name?.slice(0, 8) || '?'} c{placed?.chainPosition || '?'}
            </text>
          </g>
        );
      })}
      <path d={pathD} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={pathD} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={fromPos.x} cy={fromPos.y} r={5} fill={color} stroke="#000" strokeWidth={1} />
      <circle cx={toPos.x} cy={toPos.y} r={5} fill={color} stroke="#000" strokeWidth={1} />
    </g>
  );
}
