import type { KnockoutStatus } from './knockout';
import type { PhotoGeometryCorrection } from './geometry';

/** Increment whenever stored output pixels can change for the same source. */
export const IMAGE_PROCESSING_VERSION = 1;

export const USABLE_PHOTO_STATUSES = ['knocked-out', 'already-cutout'] as const;

export function isUsablePedalPhotoStatus(
  status: KnockoutStatus
): status is (typeof USABLE_PHOTO_STATUSES)[number] {
  return (USABLE_PHOTO_STATUSES as readonly KnockoutStatus[]).includes(status);
}

export interface ProcessedPhotoGeometry {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

/**
 * Geometry persisted with an approved board image.
 *
 * The ratio does not accept or reject an image yet; it makes the distortion
 * measurable so the geometry gate in the next pipeline phase can be added
 * without first migrating another set of unknown legacy assets.
 */
export function approvedImageMetadata(
  result: Extract<KnockoutStatus, 'knocked-out' | 'already-cutout'>,
  geometry: ProcessedPhotoGeometry,
  footprint: { widthInches: number; depthInches: number },
  correction: PhotoGeometryCorrection = { quarterTurns: 0, topEdgeCorrection: 0 }
) {
  const outputAspect = geometry.outputWidth / geometry.outputHeight;
  const footprintAspect = footprint.widthInches / footprint.depthInches;

  return {
    image_processing_status: 'approved' as const,
    image_processing_result: result,
    image_processing_version: IMAGE_PROCESSING_VERSION,
    image_source_width: geometry.sourceWidth,
    image_source_height: geometry.sourceHeight,
    image_output_width: geometry.outputWidth,
    image_output_height: geometry.outputHeight,
    image_footprint_ratio: outputAspect / footprintAspect,
    image_rotation_quarter_turns: correction.quarterTurns,
    image_perspective_top: correction.topEdgeCorrection,
  };
}

export function noImageMetadata() {
  return {
    image_processing_status: 'not-provided' as const,
    image_processing_result: null,
    image_processing_version: 0,
    image_source_width: null,
    image_source_height: null,
    image_output_width: null,
    image_output_height: null,
    image_footprint_ratio: null,
    image_rotation_quarter_turns: 0,
    image_perspective_top: 0,
  };
}
