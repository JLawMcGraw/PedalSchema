import { trimTransparent, type RgbaImage } from './knockout';

export type QuarterTurns = 0 | 1 | 2 | 3;

export interface PhotoGeometryCorrection {
  quarterTurns: QuarterTurns;
  /**
   * Expand (>0) or compress (<0) the top edge relative to the bottom edge.
   * Range is deliberately conservative: this is correction, not an effect.
   */
  topEdgeCorrection: number;
}

export const DEFAULT_PHOTO_GEOMETRY: PhotoGeometryCorrection = {
  quarterTurns: 0,
  topEdgeCorrection: 0,
};

export function rotateQuarterTurns(input: RgbaImage, turns: QuarterTurns): RgbaImage {
  if (turns === 0) return input;
  const outWidth = turns % 2 ? input.height : input.width;
  const outHeight = turns % 2 ? input.width : input.height;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < input.height; y++) {
    for (let x = 0; x < input.width; x++) {
      let outX: number;
      let outY: number;
      if (turns === 1) {
        outX = input.height - 1 - y;
        outY = x;
      } else if (turns === 2) {
        outX = input.width - 1 - x;
        outY = input.height - 1 - y;
      } else {
        outX = y;
        outY = input.width - 1 - x;
      }
      const source = (y * input.width + x) * 4;
      const target = (outY * outWidth + outX) * 4;
      data.set(input.data.subarray(source, source + 4), target);
    }
  }

  return { data, width: outWidth, height: outHeight };
}

function samplePremultiplied(input: RgbaImage, x: number, y: number, out: Uint8ClampedArray, at: number) {
  if (x < 0 || y < 0 || x > input.width - 1 || y > input.height - 1) return;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, input.width - 1);
  const y1 = Math.min(y0 + 1, input.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const samples = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ] as const;

  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const [sx, sy, weight] of samples) {
    const source = (sy * input.width + sx) * 4;
    const a = input.data[source + 3] / 255;
    alpha += a * weight;
    red += input.data[source] * a * weight;
    green += input.data[source + 1] * a * weight;
    blue += input.data[source + 2] * a * weight;
  }
  if (alpha <= 0) return;
  out[at] = red / alpha;
  out[at + 1] = green / alpha;
  out[at + 2] = blue / alpha;
  out[at + 3] = alpha * 255;
}

export function correctTopEdgePerspective(
  input: RgbaImage,
  correction: number
): RgbaImage {
  const amount = Math.max(-0.35, Math.min(0.35, correction));
  if (Math.abs(amount) < 0.001) return input;
  const data = new Uint8ClampedArray(input.data.length);
  const centre = (input.width - 1) / 2;

  for (let y = 0; y < input.height; y++) {
    const progress = input.height === 1 ? 1 : y / (input.height - 1);
    const sourceScale = 1 - amount * (1 - progress);
    for (let x = 0; x < input.width; x++) {
      const sourceX = centre + (x - centre) * sourceScale;
      samplePremultiplied(input, sourceX, y, data, (y * input.width + x) * 4);
    }
  }

  return { data, width: input.width, height: input.height };
}

export function applyPhotoGeometry(
  input: RgbaImage,
  correction: PhotoGeometryCorrection
): RgbaImage {
  const rotated = rotateQuarterTurns(input, correction.quarterTurns);
  const corrected = correctTopEdgePerspective(rotated, correction.topEdgeCorrection);
  return trimTransparent(corrected);
}
