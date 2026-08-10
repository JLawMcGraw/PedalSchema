/**
 * The canvas draws cables in four appearances and, until now, explained none
 * of them. Worse, two of the four were indistinguishable in principle: the
 * renderer painted `cableType: 'power'` and `valid: false` the same red.
 * Measured on the saved `test` board, the drawable vocabulary is
 * `orange solid 4, green solid 20, green dashed 1` - no power cable is ever
 * generated (`calculateCables` only ever emits 'instrument' or 'patch'), so
 * red means exactly one thing and the legend can say so without hedging.
 *
 * This module is the single definition of that vocabulary. The renderer and
 * the legend both read it, so a legend swatch cannot drift from the stroke it
 * claims to describe.
 */
import { describe, it, expect } from 'vitest';
import type { RoutedCable } from '../route-cables';
import { cableAppearance, explainRoutingFailure, CLEARANCE_INCHES } from '../explain';

type Stub = Parameters<typeof cableAppearance>[0];

const routed = (over: Partial<RoutedCable> = {}): RoutedCable =>
  ({
    path: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    strategy: 'lane-router',
    valid: true,
    fromPedalId: 'a',
    toPedalId: 'b',
    fromPos: { x: 0, y: 0 },
    toPos: { x: 10, y: 0 },
    cable: { id: 'c1', cableType: 'patch', fromPedalId: 'a', toPedalId: 'b', fromType: 'pedal', toType: 'pedal' },
    ...over,
  } as unknown as RoutedCable);

describe('cable appearance', () => {
  it('names each of the four things the canvas can draw', () => {
    expect(cableAppearance(routed() as Stub).kind).toBe('patch');
    expect(cableAppearance(routed({ cable: { cableType: 'instrument' } } as Partial<RoutedCable>) as Stub).kind)
      .toBe('instrument');
    expect(cableAppearance(routed({ strategy: 'perimeter' }) as Stub).kind).toBe('around');
    expect(cableAppearance(routed({ valid: false }) as Stub).kind).toBe('unroutable');
  });

  it('lets invalid outrank every other appearance', () => {
    // A cable can be an instrument cable AND unroutable. Red has to win, or a
    // failure hides behind an ordinary colour.
    const a = cableAppearance(
      routed({ valid: false, strategy: 'perimeter', cable: { cableType: 'instrument' } } as Partial<RoutedCable>) as Stub
    );
    expect(a.kind).toBe('unroutable');
    expect(a.dashed).toBe(false);
  });

  it('dashes only the route that leaves the board surface', () => {
    expect(cableAppearance(routed({ strategy: 'perimeter' }) as Stub).dashed).toBe(true);
    expect(cableAppearance(routed({ strategy: 'astar' }) as Stub).dashed).toBe(false);
  });
});

describe('explaining a failure', () => {
  const nameOf = (id: string | null) => (id ? { a: 'FZ-1W', b: 'EQ-200', x: 'GE-7' }[id] ?? id : null);

  it('says nothing about a cable that routed', () => {
    expect(explainRoutingFailure(routed(), nameOf)).toBeNull();
  });

  it('names the endpoints, the cause, and the pedals it was drawn through', () => {
    const failure = explainRoutingFailure(
      routed({
        valid: false,
        strategy: 'fallback-invalid',
        laneOutcome: 'unattached-both',
        validation: {
          valid: false,
          violations: [
            { segmentIndex: 1, obstacleIndex: 0, pedalId: 'b', point: { x: 0, y: 0 } },
            { segmentIndex: 1, obstacleIndex: 1, pedalId: 'x', point: { x: 0, y: 0 } },
            // Same pedal twice, and one obstacle that is not a pedal at all.
            { segmentIndex: 2, obstacleIndex: 1, pedalId: 'x', point: { x: 0, y: 0 } },
            { segmentIndex: 3, obstacleIndex: 9, pedalId: null, point: { x: 0, y: 0 } },
          ],
        },
      }),
      nameOf
    )!;

    expect(failure.label).toBe('FZ-1W → EQ-200');
    expect(failure.through).toEqual(['EQ-200', 'GE-7']); // deduped, nulls dropped
    expect(failure.reason).toMatch(/neither jack/i);
    expect(failure.reason).toContain(String(CLEARANCE_INCHES));
  });

  it('distinguishes which end failed', () => {
    const reason = (laneOutcome: RoutedCable['laneOutcome']) =>
      explainRoutingFailure(routed({ valid: false, laneOutcome }), nameOf)!.reason;

    expect(reason('unattached-from')).toContain('FZ-1W');
    expect(reason('unattached-to')).toContain('EQ-200');
    expect(reason('evicted')).toContain('already carrying');
  });

  it('still explains a failure the corridor router never saw', () => {
    // laneOutcome is undefined when the lane router is switched off.
    const failure = explainRoutingFailure(routed({ valid: false, laneOutcome: undefined }), nameOf)!;
    expect(failure.reason.length).toBeGreaterThan(0);
    expect(failure.through).toEqual([]);
  });

  it('uses external endpoint names, not pedal ids', () => {
    const failure = explainRoutingFailure(
      routed({
        valid: false,
        cable: { cableType: 'instrument', fromType: 'guitar', fromPedalId: null, toType: 'pedal', toPedalId: 'a' },
      } as Partial<RoutedCable>),
      nameOf
    )!;
    expect(failure.label).toBe('Guitar → FZ-1W');
  });
});
