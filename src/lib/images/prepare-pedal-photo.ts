/**
 * Browser shell around the pure knockout math: File -> silhouette PNG File.
 *
 * Runs client-side before upload so what lands in storage is already a cut-out,
 * matching the mirrored system-pedal images. No server round-trip and no sharp
 * in the deployed bundle.
 */

import { prepareSilhouette, type KnockoutStatus, type RgbaImage } from './knockout';

/** Longest edge kept for the stored asset. Board rects are ~100px wide; more
 *  detail than this only costs upload time and flood-fill work. */
const MAX_EDGE = 1600;

export interface PreparedPhoto {
  file: File;
  /** Object URL for previewing the result. Caller owns revocation. */
  previewUrl: string;
  status: KnockoutStatus;
  width: number;
  height: number;
}

async function decode(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function scaleFor(width: number, height: number): number {
  const longest = Math.max(width, height);
  return longest > MAX_EDGE ? MAX_EDGE / longest : 1;
}

function toCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToPngFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode the processed image.'));
        return;
      }
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
}

/** Swap any extension for .png - the output is always PNG (it has alpha). */
function pngName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '') || 'pedal';
  return `${base}.png`;
}

/**
 * Decode, downscale, knock out the background, trim, re-encode as PNG.
 * Throws only if the image cannot be decoded or encoded; a photo whose
 * background could not be identified comes back with a non-'knocked-out'
 * status and its pixels intact.
 */
export async function preparePedalPhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await decode(file);
  try {
    const scale = scaleFor(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const source = toCanvas(w, h);
    const sourceCtx = source.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) throw new Error('Canvas is unavailable in this browser.');
    sourceCtx.drawImage(bitmap, 0, 0, w, h);

    const input: RgbaImage = sourceCtx.getImageData(0, 0, w, h);
    const { image, status } = prepareSilhouette(input);

    const out = toCanvas(image.width, image.height);
    const outCtx = out.getContext('2d');
    if (!outCtx) throw new Error('Canvas is unavailable in this browser.');
    outCtx.putImageData(
      new ImageData(image.data, image.width, image.height),
      0,
      0
    );

    const png = await canvasToPngFile(out, pngName(file.name));
    return {
      file: png,
      previewUrl: URL.createObjectURL(png),
      status,
      width: image.width,
      height: image.height,
    };
  } finally {
    bitmap.close?.();
  }
}
