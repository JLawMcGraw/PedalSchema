import { describe, expect, it } from 'vitest';
import {
  applyPhotoGeometry,
  correctTopEdgePerspective,
  rotateQuarterTurns,
} from '../geometry';
import { image } from './fixtures';

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('photo geometry correction', () => {
  it('rotates pixels clockwise without mutating the source', () => {
    const input = image(2, 3, (x, y) => [x * 50, y * 50, 0, 255]);
    const before = new Uint8ClampedArray(input.data);
    const output = rotateQuarterTurns(input, 1);

    expect([output.width, output.height]).toEqual([3, 2]);
    expect(pixel(output.data, output.width, 2, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(output.data, output.width, 0, 1)).toEqual([50, 100, 0, 255]);
    expect(input.data).toEqual(before);
  });

  it('expands a narrow photographed top edge while keeping the bottom anchored', () => {
    const input = image(40, 40, (x, y) => {
      const halfWidth = 8 + Math.round(y * 0.2);
      return Math.abs(x - 19.5) <= halfWidth ? [40, 40, 45, 255] : [0, 0, 0, 0];
    });
    const output = correctTopEdgePerspective(input, 0.3);
    const opaqueOn = (y: number) => {
      let count = 0;
      for (let x = 0; x < output.width; x++) {
        if (output.data[(y * output.width + x) * 4 + 3] > 127) count++;
      }
      return count;
    };

    expect(opaqueOn(0)).toBeGreaterThan(16);
    expect(opaqueOn(39)).toBe(32);
  });

  it('applies rotation and perspective as one trimmed operation', () => {
    const input = image(20, 30, (x, y) =>
      x >= 5 && x < 15 && y >= 5 && y < 25 ? [20, 30, 40, 255] : [0, 0, 0, 0]
    );
    const output = applyPhotoGeometry(input, { quarterTurns: 1, topEdgeCorrection: 0 });

    expect([output.width, output.height]).toEqual([20, 10]);
  });
});
