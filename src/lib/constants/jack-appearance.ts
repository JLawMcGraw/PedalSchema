import type { JackType } from '@/types';

/**
 * COLOUR ON A JACK DOT ENCODES SIGNAL DIRECTION, AND NOTHING FINER.
 *
 * There used to be six hues, one per jack type. Three measurements killed that:
 *
 *   - the dots are 8px across (r=4), which is the size at which hue
 *     discrimination is worst;
 *   - there is NO LEGEND for them anywhere in the app, so six categories were
 *     being asserted and none explained;
 *   - the distribution is savagely skewed. Of 245 jacks in the catalogue,
 *     input and output are 64% while send and return together are 3.2% - eight
 *     jacks in total. Spending a scarce, unexplained channel on eight marks is
 *     not an encoding, it is decoration.
 *
 * And it was measurably failing: input and output - the two commonest jacks,
 * 64% of every dot on screen - sat 6.4 dE apart under simulated deuteranopia,
 * below the 8.0 this project holds categorical colour to. The pair that
 * mattered most was the pair that did not separate.
 *
 * So colour now carries the one thing this app is actually about: which way
 * the signal goes. `send` groups with output and `return` with input because
 * that is what they are - the loop's out and in. Everything that is not audio
 * goes grey, which says "not part of the signal path" better than a hue would.
 *
 * The exact type is still available and still exact: every dot carries a
 * <title>, so identity is never colour alone. That is what replaces the legend
 * this never had.
 *
 * Measured, all pairs, protan and deutan:
 *   in/out    29.7 dE      in/other  12.3 dE      out/other 18.0 dE
 * Re-checked by `.claude/scripts/verify-palette.js`, which reads these values
 * out of this file.
 */
export type JackGroup = 'in' | 'out' | 'other';

const GROUPS: Record<JackType, JackGroup> = {
  input: 'in',
  return: 'in',
  output: 'out',
  send: 'out',
  power: 'other',
  expression: 'other',
  midi_in: 'other',
  midi_out: 'other',
};

export const JACK_COLOURS: Record<JackGroup, string> = {
  in: '#2da6fa', //    oklch(0.70 0.16 245)
  out: '#e6ad00', //   oklch(0.78 0.16 85)
  other: '#9fa5ac', // oklch(0.72 0.012 250) = --muted-foreground
};

export function getJackGroup(jackType: JackType): JackGroup {
  return GROUPS[jackType] ?? 'other';
}

export function getJackColour(jackType: JackType): string {
  return JACK_COLOURS[getJackGroup(jackType)];
}
