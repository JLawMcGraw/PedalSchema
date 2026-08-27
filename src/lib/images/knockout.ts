/**
 * Typed application wrapper around the runtime-neutral image pipeline.
 *
 * The implementation lives in pipeline-core.cjs so the browser and the
 * CommonJS scraper execute the same flood fill and general cleanup stages.
 * This file owns the public TypeScript contract and the sequence used for a
 * user-supplied pedal photo.
 */

import pipelineCore from './pipeline-core.cjs';
import type { AlphaQualityReport } from './pipeline-core.cjs';

export interface RgbaImage {
  /** Pinned to ArrayBuffer so browser ImageData is assignable. */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export type KnockoutStatus =
  | 'knocked-out'
  | 'already-cutout'
  | 'no-background'
  | 'ragged-background'
  | 'subject-eaten'
  | 'reverted';

export interface KnockoutResult {
  image: RgbaImage;
  status: KnockoutStatus;
  /** Pixels made transparent; zero for every rejected result. */
  knocked: number;
}

export interface SilhouetteResult {
  image: RgbaImage;
  status: KnockoutStatus;
  quality: AlphaQualityReport;
  mattePixelsCleared: number;
  strayPixelsDropped: number;
}

/**
 * Remove edge-connected background from an RGBA image.
 *
 * Gradient following handles studio backdrops that fade far beyond the base
 * colour tolerance. Callers can disable it for the strict recovery pass when
 * that same mechanism walks through a soft edge into the subject.
 */
export function knockOutBackground(
  input: RgbaImage,
  useGradient = true
): KnockoutResult {
  return pipelineCore.knockOutBackground(input, { useGradient });
}

/** Crop transparent margins to the remaining subject. */
export function trimTransparent(input: RgbaImage, alphaThreshold = 25): RgbaImage {
  return pipelineCore.trimTransparent(input, alphaThreshold);
}

/**
 * Clear near-invisible alpha haze. Native transparent PNGs can carry a large
 * matte at alpha 1..31; on a dark board it is almost invisible, but it expands
 * the subject bounds and distorts the enclosure when projected to scale.
 */
export function clearLowAlphaMatte(input: RgbaImage, threshold = 32) {
  return pipelineCore.clearLowAlphaMatte(input, threshold);
}

/** Drop small, bright, neutral islands that are retained backdrop. */
export function dropStrayBackground(input: RgbaImage) {
  return pipelineCore.dropStrayBackground(input);
}

export function alphaQualityReport(input: RgbaImage): AlphaQualityReport {
  return pipelineCore.alphaQualityReport(input);
}

/**
 * Canonical browser-safe preparation sequence.
 *
 * Per-catalogue repairs such as rectangular outline detection and vertical-gap
 * closing stay in the scraper because they require a known pedal and a reviewed
 * override. The stages below are general: knockout, strict recovery, low-alpha
 * matte cleanup, conservative stray-island cleanup, trim, and measurement.
 */
export function prepareSilhouette(input: RgbaImage): SilhouetteResult {
  let { image, status } = knockOutBackground(input);
  if (status === 'subject-eaten') {
    ({ image, status } = knockOutBackground(input, false));
  }

  if (status !== 'knocked-out' && status !== 'already-cutout') {
    return {
      image,
      status,
      quality: alphaQualityReport(image),
      mattePixelsCleared: 0,
      strayPixelsDropped: 0,
    };
  }

  const matte = clearLowAlphaMatte(image);
  const swept = dropStrayBackground(matte.image);
  const trimmed = trimTransparent(swept.image);
  const tooSmall =
    trimmed.width < 8 ||
    trimmed.height < 8 ||
    trimmed.width * trimmed.height < input.width * input.height * 0.02;
  const output = tooSmall ? swept.image : trimmed;

  return {
    image: output,
    status,
    quality: alphaQualityReport(output),
    mattePixelsCleared: matte.cleared,
    strayPixelsDropped: swept.dropped,
  };
}

export type { AlphaQualityReport } from './pipeline-core.cjs';
