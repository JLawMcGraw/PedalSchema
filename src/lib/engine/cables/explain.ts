/**
 * What a drawn cable LOOKS like, and - when it failed - what to say about it.
 *
 * The canvas had a four-way visual vocabulary that nothing explained: colour
 * by cable type, dashed for a route around the board, red for a route that
 * does not exist. A player looking at a red line got no reason for it, and a
 * red line is precisely the case where the picture alone is not enough - it
 * says "this cannot be wired" without saying what to move.
 *
 * Two reasons this lives here rather than in the components:
 *
 * 1. ONE definition of the vocabulary. The legend and the renderer must agree
 *    or the legend is lying, and a swatch that has drifted from its stroke is
 *    worse than no legend. Both read `cableAppearance`.
 * 2. It is testable without a DOM. This project has no jsdom and no
 *    testing-library, so anything expressed inside a component cannot be
 *    checked at all - see the note in cable-renderer.tsx about the perimeter
 *    tooltip that was not shipped for exactly that reason.
 *
 * On `power`: `Cable['cableType']` admits it, and the renderer coloured it the
 * same red as an invalid path - so in principle a power cable and an
 * unroutable cable were indistinguishable. In practice `calculateCables` only
 * ever emits 'instrument' or 'patch' (measured on the saved boards: orange 4,
 * green 20, green dashed 1, red 0), so red currently means one thing. It is
 * mapped here as its own kind rather than deleted, so that if power cables are
 * ever drawn the collision is a visible fact in this file instead of a
 * surprise on the canvas.
 */

import type { RoutedCable } from './route-cables';
import { OBSTACLE_MARGIN } from '../geometry';

/** Board pixels per inch. Matches INCHES_TO_PIXELS in store/derived. */
const PIXELS_PER_INCH = 40;

/**
 * The clearance a route has to keep from every pedal it does not terminate on.
 * Quoted in the failure text so the number the router refused on is the number
 * the user is told about, rather than a rounded-off "not enough room".
 */
export const CLEARANCE_INCHES = OBSTACLE_MARGIN / PIXELS_PER_INCH;

export type CableKind = 'instrument' | 'patch' | 'power' | 'around' | 'unroutable';

export interface CableAppearance {
  /** Stroke colour */
  colour: string;
  /** Drawn dashed: the route is not on the board surface */
  dashed: boolean;
  /** Which legend entry this cable is an instance of */
  kind: CableKind;
}

/**
 * The cable palette, taken from the app's own tokens rather than raw Tailwind.
 *
 * These were `#f59e0b`, `#22c55e` and `#ef4444` - three hues from outside the
 * design system, and the last of it on the canvas. The replacement is not a
 * repaint for its own sake: the old set put its two most common cables 6.4 dE
 * apart under simulated deuteranopia, below the 8.0 the project holds
 * categorical colours to, so a red-green colourblind player could not reliably
 * tell an instrument cable from a patch cable. The new set's worst pair is
 * 11.1, and every one of them clears 4:1 against the board.
 *
 *   instrument  --primary            the live signal in and out of the board
 *   patch       --muted-foreground   the bulk of the cables, so they recede
 *   unroutable  --destructive        a failure, and the only red on the canvas
 *
 * `power` is UNREACHABLE today - power cables are filtered out before routing
 * (see `cables/index.ts`, `.filter(c => c.cableType !== 'power')`) - but it
 * used to share its colour with `unroutable`, so the first power cable ever
 * drawn would have looked like a failed one. It has its own colour now.
 *
 * Arithmetic re-checked by `.claude/scripts/verify-palette.js`, which reads
 * these values straight out of this file.
 */
const COLOURS: Record<CableKind, string> = {
  instrument: '#56dc85', // oklch(0.80 0.17 152)  = --primary
  patch: '#9fa5ac', //      oklch(0.72 0.012 250) = --muted-foreground
  power: '#d37e01', //      oklch(0.67 0.15 65)   - unreachable, see above
  around: '#9fa5ac', //     a perimeter patch run is still a patch cable
  unroutable: '#ec5b57', // oklch(0.66 0.18 25)   = --destructive
};

/** Everything the appearance depends on - kept narrow so tests need no fixture. */
type AppearanceInput = Pick<RoutedCable, 'valid' | 'strategy'> & {
  cable: Pick<RoutedCable['cable'], 'cableType'>;
};

export function cableAppearance(routed: AppearanceInput): CableAppearance {
  // Invalid outranks everything. A cable can be an instrument cable AND
  // unroutable, and if the type won that failure would hide behind an ordinary
  // colour. It is also drawn SOLID: dashes mean "deliberately off the surface",
  // which is the opposite of what a failure is.
  if (!routed.valid) {
    return { colour: COLOURS.unroutable, dashed: false, kind: 'unroutable' };
  }

  // A perimeter route could not fit between the rows, so it was sent around
  // the outside - what a player does by running it underneath. Dashed already
  // reads as "not on the surface"; the colour stays the cable's own so the
  // dash adds information instead of replacing it.
  if (routed.strategy === 'perimeter') {
    const colour = routed.cable.cableType === 'instrument' ? COLOURS.instrument : COLOURS.patch;
    return { colour, dashed: true, kind: 'around' };
  }

  const kind: CableKind =
    routed.cable.cableType === 'instrument' ? 'instrument'
    : routed.cable.cableType === 'power' ? 'power'
    : 'patch';
  return { colour: COLOURS[kind], dashed: false, kind };
}

/** The four entries a legend has to carry, in the order they are worth reading. */
export const CABLE_LEGEND: Array<{ kind: CableKind; label: string; hint: string }> = [
  { kind: 'instrument', label: 'Instrument', hint: 'guitar to the board, and board to the amp' },
  { kind: 'patch', label: 'Patch', hint: 'pedal to pedal' },
  { kind: 'around', label: 'Around the board', hint: 'no room between the rows - run it underneath' },
  { kind: 'unroutable', label: 'Will not fit', hint: 'no route exists at this spacing' },
];

export function legendSwatch(kind: CableKind): CableAppearance {
  return {
    colour: COLOURS[kind],
    dashed: kind === 'around',
    kind,
  };
}

export interface RoutingFailure {
  /** "FZ-1W → EQ-200" */
  label: string;
  /** One sentence naming the cause and the clearance it was refused at. */
  reason: string;
  /** Pedals the drawn line passes through, in the order it meets them. */
  through: string[];
}

/** Endpoint labels for the ends that are not pedals. */
const EXTERNAL_LABELS: Record<string, string> = {
  guitar: 'Guitar',
  amp_input: 'Amp input',
  amp_send: 'Amp send',
  amp_return: 'Amp return',
};

function endpointName(
  type: string | undefined,
  pedalId: string | null | undefined,
  nameOf: (id: string | null) => string | null
): string {
  if (type && type !== 'pedal') return EXTERNAL_LABELS[type] ?? type;
  return nameOf(pedalId ?? null) ?? 'a pedal';
}

/**
 * Why this cable has no route, in the terms the player can act on.
 *
 * The facts all already exist on the routed cable - `laneOutcome` names which
 * END failed to find a channel (8-8 built it for exactly this), and
 * `validation.violations` names the pedals the drawn line runs through. None
 * of it reached the screen. Returns null for a cable that routed, so callers
 * can map over every cable without filtering first.
 */
export function explainRoutingFailure(
  routed: RoutedCable,
  nameOf: (id: string | null) => string | null
): RoutingFailure | null {
  if (routed.valid) return null;

  const from = endpointName(routed.cable.fromType, routed.cable.fromPedalId, nameOf);
  const to = endpointName(routed.cable.toType, routed.cable.toPedalId, nameOf);

  // Deduped and in path order: the same pedal shows up once per segment that
  // clips it, and an obstacle that is not a pedal has no name to report.
  //
  // Split into pedals the cable CROSSES and its own endpoints, because a
  // cable that clips the pedal it is going to reads as a broken message when
  // the two are listed together ("FZ-1W -> EQ-200 ... drawn through EQ-200").
  // Both facts are real - findPathViolations exempts an endpoint on its own
  // segment only, so clipping it mid-path is a genuine violation and means the
  // cable is entering that pedal's body rather than approaching its jack - so
  // they are reported separately rather than one of them dropped.
  const endpointIds = new Set(
    [routed.cable.fromPedalId, routed.cable.toPedalId].filter(Boolean) as string[]
  );
  const crosses: string[] = [];
  const intoBody: string[] = [];
  for (const violation of routed.validation?.violations ?? []) {
    const name = nameOf(violation.pedalId);
    if (!name) continue;
    const bucket = violation.pedalId && endpointIds.has(violation.pedalId) ? intoBody : crosses;
    if (!bucket.includes(name)) bucket.push(name);
  }
  const through = [...crosses, ...intoBody];

  // `laneOutcome` is undefined when the corridor router did not run, so every
  // branch has to survive not having it.
  const cause = (() => {
    switch (routed.laneOutcome) {
      case 'unattached-from':
        return `${from} has no clear channel to leave by`;
      case 'unattached-to':
        return `${to} has no clear channel to arrive by`;
      case 'unattached-both':
        return 'Neither jack has a clear channel to the rest of the board';
      case 'evicted':
        return 'The channel it needs is already carrying as many cables as it can hold';
      default:
        return 'The pedals between the two jacks leave no gap wide enough';
    }
  })();

  // Kept to one line. This is read on the canvas, over the board it is
  // describing, so every extra clause is board the user cannot see.
  const clauses: string[] = [];
  if (crosses.length) clauses.push(`through ${crosses.join(', ')}`);
  if (intoBody.length) {
    // A cable can clip BOTH its endpoints, and "into EQ-200 and GE-7's own
    // body" attaches one possessive to two names and one body to two pedals.
    clauses.push(
      intoBody.length === 1
        ? `into ${intoBody[0]}'s own body`
        : `into ${intoBody.map((n) => `${n}'s`).join(' and ')} own bodies`
    );
  }
  const drawn = clauses.length ? ` Drawn ${clauses.join(', and ')}.` : '';

  return {
    label: `${from} → ${to}`,
    reason: `${cause} at ${CLEARANCE_INCHES}in clearance.${drawn}`,
    through,
  };
}
