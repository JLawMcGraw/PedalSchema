/**
 * The cables of a board: who connects to whom, how each one is routed, and how
 * long each one therefore is.
 *
 * ONE derivation, because cable LENGTH had three:
 *
 *   the wiring list, "What to buy",     straight-line jack distance x 1.2,
 *   the toolbar CABLE field,            rounded up to a standard length -
 *   the Cables drawer, the dashboard    computed before anything was routed
 *
 *   the canvas                          the routed path
 *
 *   the Optimize summary                the routed path ("12in less cable")
 *
 * So the app drew one cable and told you to buy another. Measured on
 * 2026-11-16 over 216 boards: 165 of about 1,330 pedal-to-pedal cables were
 * drawn LONGER than the length listed for them - the worst a cable sent around
 * the outside of the board, 55.4in on the canvas and a 12in patch cable on the
 * shopping list. Board totals disagreed in both directions (174in against
 * 113.2in drawn; 60in against 75.6in), and pressing Optimize could report
 * "12in less cable" while the CABLE field beside it did not move, because one
 * was measuring routes and the other was summing rounded estimates.
 *
 * The estimate could never have been right. A cable's length is a property of
 * its ROUTE, and the route is decided by every other pedal on the board.
 *
 * This lives in the engine rather than in store/derived so that a server
 * component can call it: the dashboard's hero card shows the same CABLE number
 * as the editor's toolbar, and it can only be the same number if it is the
 * same function.
 */

import type { Amp, Board, Cable, Pedal, PlacedPedal, RoutingConfig } from '@/types';
import { calculatePathLength } from '../geometry';
import { calculateCables, roundToStandardLength } from './index';
import { routeAllCables, type RoutedCable, type RoutedPath } from './route-cables';

/**
 * Board pixels per inch. Matches INCHES_TO_PIXELS in store/derived and the
 * PIXELS_PER_INCH the layout cost function routes at - the router's clearances
 * are pixel constants calibrated to this scale, so it is the only value that
 * means anything. A parameter only so store/derived can pass its own constant
 * and the two cannot drift apart silently.
 */
const PIXELS_PER_INCH = 40;

/** How long a routed path is, in inches. */
export function routedLengthInches(routed: Pick<RoutedPath, 'path'>, scale: number = PIXELS_PER_INCH): number {
  return calculatePathLength(routed.path) / scale;
}

/**
 * The cable to BUY for one connection: the shortest standard length that
 * covers the route it is drawn on.
 *
 * No slack factor is added on top. Rounding up to a standard length is the
 * slack - a 7in route is listed as a 12in cable - and a multiplier here would
 * be a second, invisible opinion about the same thing.
 *
 * An UNROUTABLE cable keeps its straight-line estimate. Its path is the
 * deliberate through-the-pedals L that the canvas draws red (see
 * `fallback-invalid` in routing-strategies), which is a picture of a problem,
 * not a route anyone would cut a cable to. The board has to change before that
 * cable has a real length, and the legend already says so.
 */
export function purchaseLengthInches(
  routed: Pick<RoutedPath, 'path' | 'valid'>,
  estimateInches: number,
  scale: number = PIXELS_PER_INCH
): number {
  if (!routed.valid) return estimateInches;
  return roundToStandardLength(routedLengthInches(routed, scale));
}

export interface CableSource {
  /** Stamped onto each Cable; the configuration being derived, if it has an id yet. */
  configurationId: string | null;
  placedPedals: PlacedPedal[];
  pedalsById: Record<string, Pedal>;
  board: Board;
  amp: Amp | null;
  useEffectsLoop: boolean;
  use4CableMethod: boolean;
  routingConfig?: RoutingConfig;
}

export interface DerivedCables {
  /**
   * Cable topology. `calculatedLengthInches` is the length to BUY - see
   * purchaseLengthInches - and is the same object each RoutedCable carries.
   */
  cables: Cable[];
  /** Routed paths in pixels. Shorter than `cables` if an endpoint did not resolve. */
  routedCables: RoutedCable[];
  /**
   * Total length of the cables AS DRAWN, in inches - exact, not rounded.
   *
   * Summed over every routed path, valid or not, for the same reason
   * `crossings` is: the canvas draws the invalid ones too. It is also what the
   * layout cost function's `cableLength` dimension sums, so this number and
   * the Optimize summary's "Nin less cable" move together by construction -
   * derive-cables.test.ts asserts they are equal.
   */
  drawnLengthInches: number;
}

export function deriveCables(source: CableSource, scale: number = PIXELS_PER_INCH): DerivedCables {
  const {
    configurationId, placedPedals, pedalsById, board, amp,
    useEffectsLoop, use4CableMethod, routingConfig,
  } = source;

  const connections = calculateCables(
    placedPedals, pedalsById, board, amp, useEffectsLoop, routingConfig, use4CableMethod
  );

  // Estimated lengths first: nothing is routed yet, and the router does not
  // read the length anyway.
  const estimated: Cable[] = connections.map((c, index) => ({
    id: `cable-${index}`,
    configurationId: configurationId || '',
    fromType: c.fromType,
    fromPedalId: c.fromPedalId,
    fromJack: c.fromJackType,
    toType: c.toType,
    toPedalId: c.toPedalId,
    toJack: c.toJackType,
    calculatedLengthInches: c.calculatedLengthInches,
    cableType: c.cableType,
    sortOrder: c.sortOrder,
    createdAt: '',
  }));

  const fxLoopActive = useEffectsLoop && !!amp?.hasEffectsLoop;
  const routed = routeAllCables(estimated, placedPedals, pedalsById, board, scale, fxLoopActive);

  // Now each cable can be given the length of the route it actually takes.
  // Keyed by id rather than index: routeAllCables drops a cable whose endpoint
  // no longer resolves, so the two arrays are not guaranteed to line up.
  const routedById = new Map(routed.map((r) => [r.cable.id, r]));
  const cables: Cable[] = estimated.map((cable) => {
    const route = routedById.get(cable.id);
    if (!route) return cable; // never routed - the estimate is all there is
    return {
      ...cable,
      calculatedLengthInches: purchaseLengthInches(route, cable.calculatedLengthInches ?? 0, scale),
    };
  });

  // The routed cables must carry the SAME cable objects the list shows, or a
  // consumer holding a RoutedCable would read the stale estimate off it.
  const cableById = new Map(cables.map((c) => [c.id, c]));
  const routedCables: RoutedCable[] = routed.map((r) => ({ ...r, cable: cableById.get(r.cable.id)! }));

  const drawnLengthInches = routedCables.reduce((sum, r) => sum + routedLengthInches(r, scale), 0);

  return { cables, routedCables, drawnLengthInches };
}
