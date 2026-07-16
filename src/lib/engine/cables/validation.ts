/**
 * Cable Path Validation Module
 *
 * Thin ObstacleSet-aware wrapper over the single validation policy in
 * ../geometry (findPathViolations / isPathClear). This module only maps
 * pedal IDs to box indices and enriches violations with pedal IDs.
 *
 * CRITICAL: The policy itself (margins, endpoint tolerance, stub
 * exemptions) is defined ONCE in ../geometry and shared by mid-routing
 * checks and final acceptance, so they can never disagree.
 *
 * Policy summary: a cable may only overlap its own source pedal on the
 * FIRST segment (the jack exit stub) and its destination pedal on the LAST
 * segment. Against every other pedal - and against its own pedals on all
 * middle segments - it must keep OBSTACLE_MARGIN clearance.
 */

import type { Point } from '../geometry';
import { findPathViolations, isPathClear } from '../geometry';
import type { ObstacleSet } from '../obstacles';

/**
 * Information about a single violation (path intersecting obstacle)
 */
export interface PathViolation {
  /** Index of the segment that caused the violation */
  segmentIndex: number;
  /** Index of the obstacle box that was intersected */
  obstacleIndex: number;
  /** ID of the pedal that was intersected (if known) */
  pedalId: string | null;
  /** Approximate point of intersection */
  point: Point;
}

/**
 * Result of path validation
 */
export interface ValidationResult {
  /** Whether the path is valid (no violations) */
  valid: boolean;
  /** List of violations found (empty if valid) */
  violations: PathViolation[];
}

function endpointIndices(
  obstacles: ObstacleSet,
  fromPedalId: string | null,
  toPedalId: string | null
): { fromBoxIdx: number; toBoxIdx: number } {
  return {
    fromBoxIdx: fromPedalId ? obstacles.pedalIdToBox.get(fromPedalId) ?? -1 : -1,
    toBoxIdx: toPedalId ? obstacles.pedalIdToBox.get(toPedalId) ?? -1 : -1,
  };
}

/**
 * Validate that a cable path does not intersect any obstacles.
 *
 * @param path - Array of points forming the cable path
 * @param obstacles - Obstacle set with all pedal boxes
 * @param fromPedalId - Source pedal (stub-exempt on the first segment only)
 * @param toPedalId - Destination pedal (stub-exempt on the last segment only)
 */
export function validateCablePath(
  path: Point[],
  obstacles: ObstacleSet,
  fromPedalId: string | null = null,
  toPedalId: string | null = null
): ValidationResult {
  const endpoints = endpointIndices(obstacles, fromPedalId, toPedalId);
  const boxViolations = findPathViolations(path, obstacles.boxes, endpoints);

  const violations: PathViolation[] = boxViolations.map((v) => ({
    segmentIndex: v.segmentIndex,
    obstacleIndex: v.boxIndex,
    pedalId: obstacles.boxToPedalId.get(v.boxIndex) ?? null,
    point: v.point,
  }));

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Quick check if a path is valid (no detailed violations)
 */
export function isPathValid(
  path: Point[],
  obstacles: ObstacleSet,
  fromPedalId: string | null = null,
  toPedalId: string | null = null
): boolean {
  return isPathClear(path, obstacles.boxes, endpointIndices(obstacles, fromPedalId, toPedalId));
}
