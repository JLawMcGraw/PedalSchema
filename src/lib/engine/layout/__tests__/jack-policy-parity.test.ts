/**
 * The layout engine and the router must agree on WHICH jack a pedal uses.
 *
 * `sameSideJackPad` had its own copy of the lookup -
 * `pedal.jacks.find((j) => j.jackType === jackType)` - so `ea9bf67`, which
 * fixed that scan in `findJack`, did not reach it. Two policies for one
 * question, which is the shape of defect this project keeps paying for: the
 * facing-jack shortcut carries a comment about it, the perimeter rung selected
 * against one path and returned another, and P1.5 existed to stop the
 * optimizer scoring geometry it does not draw.
 *
 * It is not wrong on today's catalogue, and that is measured rather than
 * assumed: all 39 duplicate jack groups have both jacks on the SAME side
 * (39 same, 0 straddling), and this function reads only `.side`, so the two
 * policies happen to return the same answer.
 *
 * "Happens to" is the problem. The catalogue contains no pedal whose duplicate
 * jacks straddle two sides, so nothing would notice if one were added - which
 * is exactly why the fixture below is built by hand rather than taken from the
 * dump. It is the case the corpus cannot supply.
 */
import { describe, it, expect } from 'vitest';
import type { Pedal, PedalJack, PlacedPedal } from '@/types';
import { sameSideJackPad } from '../index';
import { findJack } from '../../cables/endpoints';

const NOW = '2024-01-01T00:00:00Z';

const jack = (
  jackType: PedalJack['jackType'],
  side: PedalJack['side'],
  label: string,
  positionPercent: number
): PedalJack => ({ id: `${label}-${side}`, pedalId: 'p1', jackType, side, positionPercent, label });

function makePedal(jacks: PedalJack[]): Pedal {
  return {
    id: 'p1', name: 'Straddler', manufacturer: 'Test', category: 'delay',
    widthInches: 3, depthInches: 5, heightInches: 2, voltage: 9, currentMa: 50,
    polarity: 'center_negative', defaultChainPosition: null,
    preferredLocation: 'front_of_amp', supports4Cable: false,
    needsBufferBefore: false, needsDirectPickup: false, isSystem: true,
    createdBy: null, createdAt: NOW, updatedAt: NOW, imageUrl: null, notes: null,
    jacks,
  } as Pedal;
}

const placed = (pedal: Pedal): PlacedPedal => ({
  id: 'placed-1', configurationId: 'c1', pedalId: pedal.id,
  xInches: 0, yInches: 0, rotationDegrees: 0, chainPosition: 1,
  location: 'front_of_amp', isActive: true, useLoop: false, createdAt: NOW, pedal,
});

describe('the layout engine uses the same jack the router does', () => {
  it('agrees when the duplicated jacks straddle two sides', () => {
    // findJack takes the MONO input, which is on the RIGHT. A bare `.find()`
    // takes the first row instead - INPUT B, on the LEFT - which matches the
    // output's side and invents a shared-side gap that does not exist.
    const pedal = makePedal([
      jack('input', 'left', 'INPUT B', 20),
      jack('input', 'right', 'INPUT A (MONO)', 40),
      jack('output', 'left', 'OUTPUT A (MONO)', 20),
    ]);
    const pedalsById = { p1: pedal };

    expect(findJack(pedal, 'input').side).toBe('right');
    expect(findJack(pedal, 'output').side).toBe('left');

    // Router says the sides DIFFER, so there is no shared-side gap to pad.
    expect(sameSideJackPad(placed(pedal), pedalsById)).toBe(0);
  });

  it('still pads when the router agrees both jacks are on one side', () => {
    const pedal = makePedal([
      jack('input', 'left', 'INPUT A (MONO)', 20),
      jack('output', 'left', 'OUTPUT A (MONO)', 60),
    ]);
    expect(sameSideJackPad(placed(pedal), { p1: pedal })).toBe(0.35);
  });

  it('does not pad a top/bottom pair - those feed the wide row channels', () => {
    const pedal = makePedal([
      jack('input', 'top', 'INPUT A (MONO)', 20),
      jack('output', 'top', 'OUTPUT A (MONO)', 60),
    ]);
    expect(sameSideJackPad(placed(pedal), { p1: pedal })).toBe(0);
  });

  it('pads nothing for a pedal with no jack data', () => {
    const pedal = makePedal([]);
    expect(sameSideJackPad(placed(pedal), { p1: pedal })).toBe(0);
  });

  it('honours rotation, which is why it cannot just read .side', () => {
    // Both on the left; rotating 90 degrees moves them together to another
    // edge, so they stay shared - but a top/bottom edge is not padded.
    const pedal = makePedal([
      jack('input', 'left', 'INPUT A (MONO)', 20),
      jack('output', 'left', 'OUTPUT A (MONO)', 60),
    ]);
    const rotated = { ...placed(pedal), rotationDegrees: 90 };
    expect(sameSideJackPad(rotated, { p1: pedal })).toBe(0);
  });
});
