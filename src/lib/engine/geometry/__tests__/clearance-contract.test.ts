/**
 * The clearance constants describe ONE piece of physical space and live in
 * three files. This is the test that makes them agree.
 *
 * Written after OBSTACLE_MARGIN spent an unknown length of time demanding 16px
 * to pass between rows the placer designs 14px apart: a board laid out exactly
 * to spec had no usable row corridor, and every cable crossing between rows
 * was drawn red. Nothing failed, because no test compared the two numbers -
 * they were only ever compared to COLLISION_SPACING, which is the OTHER axis.
 */
import { describe, it, expect } from 'vitest';
import { OBSTACLE_MARGIN, STANDOFF, ENDPOINT_TOLERANCE } from '../index';
import { COLLISION_SPACING } from '../../collision';
import { ROW_GAP, MIN_ROW_CLEARANCE } from '../../layout/constants';
import { INCHES_TO_PIXELS } from '@/store/derived';

const px = (inches: number) => inches * INCHES_TO_PIXELS;

describe('clearance constants describe the same space', () => {
  it('a cable fits between two pedals side by side at minimum spacing', () => {
    expect(2 * OBSTACLE_MARGIN).toBeLessThan(px(COLLISION_SPACING));
  });

  it('a cable fits along the corridor between two rows at the designed gap', () => {
    // The half that was missing. ROW_GAP is what the placer AIMS for, so a
    // board it is happy with must be a board the router can route.
    expect(2 * OBSTACLE_MARGIN).toBeLessThan(px(ROW_GAP));
  });

  it('the standoff clears its own pedal but fits a minimum-width gap', () => {
    // Restated from OBSTACLE_MARGIN's own contract so that changing the margin
    // fails HERE rather than somewhere geometric three modules away.
    expect(STANDOFF).toBeGreaterThan(OBSTACLE_MARGIN);
    expect(STANDOFF).toBeLessThanOrEqual(px(COLLISION_SPACING) - OBSTACLE_MARGIN);
  });

  it('the endpoint tolerance is a RELAXATION of the margin, never a tightening', () => {
    expect(ENDPOINT_TOLERANCE).toBeLessThan(OBSTACLE_MARGIN);
  });

  it('the legality floor sits below the designed gap, not above it', () => {
    // MIN_ROW_CLEARANCE is what makes a placement legal; ROW_GAP is what it
    // aims for. Inverted, every board would be born illegal.
    expect(MIN_ROW_CLEARANCE).toBeLessThan(ROW_GAP);
  });

  it('a board at the legality floor is KNOWN to be unroutable between rows', () => {
    // Not a contradiction - a deliberate, documented consequence. A row band
    // that grew to house a deep pedal takes the space out of its corridors,
    // and the cable that has to cross there gets routed around the board
    // instead. Asserted so that if MIN_ROW_CLEARANCE is ever raised past the
    // margin, someone notices that the perimeter fallback just went quiet.
    expect(px(MIN_ROW_CLEARANCE)).toBeLessThan(2 * OBSTACLE_MARGIN);
  });
});
