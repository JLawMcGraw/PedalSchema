import { describe, it, expect } from 'vitest';
import { isRotated, rotateSide, rotatedFootprint, rotationSteps } from '../rotation';

describe('isRotated', () => {
  it('is true only for the quarter turns that swap width and depth', () => {
    expect(isRotated(0)).toBe(false);
    expect(isRotated(90)).toBe(true);
    expect(isRotated(180)).toBe(false);
    expect(isRotated(270)).toBe(true);
  });

  it('normalises values outside 0-270, which the database permits', () => {
    // rotation_degrees is a bare INTEGER with no CHECK constraint. The old
    // inline copies compared against 90/270 literally, so -90 read as "not
    // rotated" and the pedal was measured along the wrong axis.
    expect(isRotated(-90)).toBe(true);
    expect(isRotated(450)).toBe(true);
    expect(isRotated(360)).toBe(false);
    expect(isRotated(-180)).toBe(false);
  });
});

describe('rotateSide', () => {
  it('steps a jack clockwise around the pedal', () => {
    expect(rotateSide('right', 90)).toBe('bottom');
    expect(rotateSide('bottom', 90)).toBe('left');
    expect(rotateSide('left', 90)).toBe('top');
    expect(rotateSide('top', 90)).toBe('right');
  });

  it('leaves sides alone at 0 and inverts them at 180', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(rotateSide(side, 0)).toBe(side);
      expect(rotateSide(side, 360)).toBe(side);
    }
    expect(rotateSide('top', 180)).toBe('bottom');
    expect(rotateSide('left', 180)).toBe('right');
  });

  it('handles negative rotation without falling off the ring', () => {
    // sides[(0 - 1) % 4] is sides[-1] === undefined in the naive version
    expect(rotateSide('top', -90)).toBe('left');
    expect(rotateSide('right', -90)).toBe('top');
  });

  it('is the identity after four quarter turns', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      let result = side;
      for (let i = 0; i < 4; i++) result = rotateSide(result, 90);
      expect(result).toBe(side);
    }
  });
});

describe('rotatedFootprint', () => {
  // A real BOSS compact and the real EQ-200, not invented numbers
  const compact = { widthInches: 2.87, depthInches: 5.08 };
  const eq200 = { widthInches: 3.98, depthInches: 5.43 };

  it('swaps width and depth on a quarter turn', () => {
    expect(rotatedFootprint(compact, 0)).toEqual({ widthInches: 2.87, depthInches: 5.08 });
    expect(rotatedFootprint(compact, 90)).toEqual({ widthInches: 5.08, depthInches: 2.87 });
    expect(rotatedFootprint(compact, 180)).toEqual({ widthInches: 2.87, depthInches: 5.08 });
    expect(rotatedFootprint(compact, 270)).toEqual({ widthInches: 5.08, depthInches: 2.87 });
  });

  it('makes a deep pedal shallow - the reason rotation can win space', () => {
    // EQ-200 is 5.43in deep, which fits no row band on a 16in board without
    // growing one. Rotated it is 3.98in deep and fits any row.
    expect(rotatedFootprint(eq200, 90).depthInches).toBe(3.98);
  });
});

describe('rotationSteps', () => {
  it('reports quarter turns clockwise, normalised', () => {
    expect(rotationSteps(0)).toBe(0);
    expect(rotationSteps(90)).toBe(1);
    expect(rotationSteps(180)).toBe(2);
    expect(rotationSteps(270)).toBe(3);
    expect(rotationSteps(-90)).toBe(3);
    expect(rotationSteps(450)).toBe(1);
  });
});
