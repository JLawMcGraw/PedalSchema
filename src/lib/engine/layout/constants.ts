/**
 * Row geometry constants, shared by the placer and the routing cost.
 */

/**
 * Front-to-back clearance between pedals in ADJACENT ROWS, as opposed to the
 * side-to-side COLLISION_SPACING between neighbours in the same row.
 *
 * They are different quantities and conflating them cost a whole row. A cable
 * leaves a pedal through its side jacks, so the gap between two pedals sitting
 * beside each other must fit a cable run; the gap between rows carries the
 * corridor but does not have to admit a cable BETWEEN two specific pedals.
 * Requiring 0.5in in both axes meant a 32x16 board could hold only two rows of
 * 5.08in pedals (3 rows need 15.24in of pedal, leaving 0.38in per gap), so any
 * third row was unreachable: every candidate there collided with the row in
 * front of it, and the chain silently skipped that row and came back for it
 * later - which is what made a 20-pedal board read front -> back -> middle.
 */
export const ROW_GAP = 0.35;

/**
 * The floor under ROW_GAP: the least front-to-back clearance a placement is
 * allowed to have. ROW_GAP is the corridor rows are DESIGNED for; this is what
 * makes a candidate legal, and they have to be separate numbers.
 *
 * A row band sometimes has to grow to house a deeper-than-typical pedal, and
 * that depth comes out of the corridors: three rows on a 16in board housing one
 * 5.43in pedal need 5.43 + 2x5.10 = 15.63in, which leaves 0.185in per corridor.
 * Demanding the full 0.35in there left EQ-200 with no legal row at all - it
 * straddled two bands instead, which pinned its x to the one column with
 * nothing above it, truncated the packed run to four pedals and wrapped the
 * tail of the chain back to the right-hand side, out of signal order.
 *
 * Do not raise this to a rounder 0.2 without redoing that arithmetic: the real
 * board clears it by 0.035in, and at 0.2 the budget does not close, the row
 * never grows, and the whole mechanism silently does nothing.
 */
export const MIN_ROW_CLEARANCE = 0.15;
