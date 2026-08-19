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

  it('the standoff clears its own pedal but fits a minimum-width SIDE gap', () => {
    // Restated from OBSTACLE_MARGIN's own contract so that changing the margin
    // fails HERE rather than somewhere geometric three modules away.
    expect(STANDOFF).toBeGreaterThan(OBSTACLE_MARGIN);
    expect(STANDOFF).toBeLessThanOrEqual(px(COLLISION_SPACING) - OBSTACLE_MARGIN);
  });

  it('a stub from a TOP-edge jack does NOT fit a designed row corridor - known', () => {
    /*
     * THE SAME BLIND SPOT AS R1, ONE CONSTANT OVER, and this test exists to
     * stop it being rediscovered a third time.
     *
     * The check above - the only one STANDOFF had - measures it against
     * COLLISION_SPACING, the SIDE axis. Nothing measured it against ROW_GAP,
     * which is exactly what this file's header says went wrong with
     * OBSTACLE_MARGIN: "they were only ever compared to COLLISION_SPACING,
     * which is the OTHER axis."
     *
     * A jack on a pedal's TOP or BOTTOM edge points its stub INTO a row
     * corridor, so it needs STANDOFF to plant plus OBSTACLE_MARGIN to clear
     * the row opposite:
     *
     *     needs  STANDOFF + OBSTACLE_MARGIN = 10 + 6 = 16px
     *     has    ROW_GAP  = 0.35in          =         14px
     *     short by 2px (0.05in)
     *
     * Measured on the owner's 22-pedal board, 2026-08-18: BigSky carries every
     * jack on its top edge and sits in the middle row, so both its cables
     * plant at y=208 in a corridor whose legal band starts at y=210, and both
     * are drawn red.
     *
     * ASSERTED AS A KNOWN CONTRADICTION, not as a target. Fixing it does NOT
     * turn that board green - the same corridor seats one run and four cables
     * want it, so capacity binds independently - which is why this is written
     * down rather than chased. If it is ever resolved (STANDOFF <= 8, or a
     * right-angle plug modelled separately from a straight one), this test
     * fails and whoever did it must come back and rewrite the story here.
     */
    expect(
      STANDOFF + OBSTACLE_MARGIN,
      'the row-axis standoff contradiction is fixed - update this test and the note on it'
    ).toBeGreaterThan(px(ROW_GAP));
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
