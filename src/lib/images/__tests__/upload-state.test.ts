import { describe, expect, it } from 'vitest';
import {
  IMAGE_PROCESSING_VERSION,
  approvedImageMetadata,
  isUsablePedalPhotoStatus,
  noImageMetadata,
} from '../upload-state';
import type { KnockoutStatus } from '../knockout';

describe('pedal photo upload state', () => {
  it.each<KnockoutStatus>(['knocked-out', 'already-cutout'])(
    'accepts %s as a board image',
    (status) => expect(isUsablePedalPhotoStatus(status)).toBe(true)
  );

  it.each<KnockoutStatus>([
    'no-background',
    'ragged-background',
    'subject-eaten',
    'reverted',
  ])('rejects %s as a board image', (status) => {
    expect(isUsablePedalPhotoStatus(status)).toBe(false);
  });

  it('records processing geometry and physical aspect', () => {
    const metadata = approvedImageMetadata(
      'knocked-out',
      { sourceWidth: 1200, sourceHeight: 1800, outputWidth: 580, outputHeight: 1020 },
      { widthInches: 2.9, depthInches: 5.1 }
    );

    expect(metadata).toMatchObject({
      image_processing_status: 'approved',
      image_processing_result: 'knocked-out',
      image_processing_version: IMAGE_PROCESSING_VERSION,
      image_source_width: 1200,
      image_source_height: 1800,
      image_output_width: 580,
      image_output_height: 1020,
      image_rotation_quarter_turns: 0,
      image_perspective_top: 0,
    });
    expect(metadata.image_footprint_ratio).toBeCloseTo(1, 5);
  });

  it('clears every processing field when a pedal is saved without an image', () => {
    expect(noImageMetadata()).toEqual({
      image_processing_status: 'not-provided',
      image_processing_result: null,
      image_processing_version: 0,
      image_source_width: null,
      image_source_height: null,
      image_output_width: null,
      image_output_height: null,
      image_footprint_ratio: null,
      image_rotation_quarter_turns: 0,
      image_perspective_top: 0,
    });
  });

  it('records manual orientation and perspective corrections', () => {
    const metadata = approvedImageMetadata(
      'already-cutout',
      { sourceWidth: 1000, sourceHeight: 800, outputWidth: 600, outputHeight: 900 },
      { widthInches: 4, depthInches: 6 },
      { quarterTurns: 1, topEdgeCorrection: 0.18 }
    );

    expect(metadata).toMatchObject({
      image_rotation_quarter_turns: 1,
      image_perspective_top: 0.18,
    });
  });
});
