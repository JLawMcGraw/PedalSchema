/**
 * Turning stored pedal fields into text a person reads.
 *
 * Pure, and separate from the page, because one of these has a correctness
 * trap in it that no amount of looking at the rendered page will reveal - see
 * `formatCurrentDraw`.
 */
import type { JackSide, JackType, PowerPolarity, ChainLocation } from '@/types';

/**
 * Current draw, respecting the THREE states of `currentMa`.
 *
 *   null -> "Unknown"     nobody has published or measured it
 *   0    -> "0 mA"        a real, measured zero (a passive volume pedal)
 *   n    -> "n mA"
 *
 * The trap is that `null` and `0` are both falsy, so the obvious
 * `ma ? `${ma} mA` : 'Unknown'` reports a measured zero as unknown. Two call
 * sites used to hand-roll exactly that and have been routed through here:
 * `pedal-card.tsx` printed nothing for a measured zero, and
 * `properties-panel.tsx` was worse - `{voltage}V{ma && ...}` yields the falsy
 * operand, so React would have printed "9V0". Both were latent rather than
 * wrong today: of 67 pedals one has a null draw and NONE has a real zero,
 * which is precisely why neither would have been noticed.
 *
 * The dangerous direction is the other one and is guarded elsewhere: a `?? 0`
 * in a power TOTAL would report a supply as adequate while ignoring every
 * pedal whose draw nobody knows. See `lib/engine/power`.
 */
export function formatCurrentDraw(currentMa: number | null): string {
  if (currentMa == null) return 'Unknown';
  return `${currentMa} mA`;
}

/** Supply voltage. Whole numbers stay whole: "9V", not "9.0V". */
export function formatVoltage(voltage: number): string {
  return `${trimNumber(voltage)}V`;
}

/**
 * Footprint as W x D x H in inches.
 *
 * The multiplication sign is U+00D7, not the letter x - these sit next to
 * digits and an "x" reads as a variable.
 */
export function formatDimensions(w: number, d: number, h: number): string {
  return `${trimNumber(w)}″ × ${trimNumber(d)}″ × ${trimNumber(h)}″`;
}

/** Drop a trailing ".0" but keep real decimals: 4.5 -> "4.5", 9.0 -> "9". */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

const POLARITY_LABELS: Record<PowerPolarity, string> = {
  center_negative: 'Centre negative',
  center_positive: 'Centre positive',
};

export function formatPolarity(polarity: PowerPolarity): string {
  return POLARITY_LABELS[polarity] ?? polarity;
}

const JACK_LABELS: Record<JackType, string> = {
  input: 'Input',
  output: 'Output',
  send: 'Send',
  return: 'Return',
  power: 'Power',
  expression: 'Expression',
  midi_in: 'MIDI in',
  midi_out: 'MIDI out',
};

export function formatJackType(jackType: JackType): string {
  return JACK_LABELS[jackType] ?? jackType;
}

const SIDE_LABELS: Record<JackSide, string> = {
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
};

export function formatJackSide(side: JackSide): string {
  return SIDE_LABELS[side] ?? side;
}

const LOCATION_LABELS: Record<ChainLocation, string> = {
  front_of_amp: 'Front of amp',
  effects_loop: 'Effects loop',
  four_cable_hub: 'Four-cable hub',
  flexible: 'Flexible',
};

export function formatChainLocation(location: ChainLocation): string {
  return LOCATION_LABELS[location] ?? location;
}
