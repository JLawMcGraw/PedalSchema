'use strict';

/*
 * Sharp boundary for the runtime-neutral pedal image pipeline.
 *
 * Pixel decisions live in pipeline-core.cjs. This adapter only decodes and
 * encodes buffers, which keeps the exact detector and cleanup semantics shared
 * with browser uploads while remaining directly testable in Node.
 */
const sharp = require('sharp');
const pipelineCore = require('../src/lib/images/pipeline-core.cjs');

async function decode(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Expected RGBA pixels; received ${info.channels} channels`);
  return {
    image: {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    },
  };
}

async function encode(image) {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).png().toBuffer();
}

async function knockOutBackground(buf, useGradient = true, bgTol = 35, allowRagged = false) {
  const { image } = await decode(buf);
  const result = pipelineCore.knockOutBackground(image, { useGradient, bgTol, allowRagged });
  const ok = result.status === 'knocked-out' || result.status === 'already-cutout';
  if (!ok || result.status === 'already-cutout') return { buf, ok, status: result.status };
  return { buf: await encode(result.image), ok: true, status: result.status };
}

async function clearLowAlphaMatte(buf) {
  const { image } = await decode(buf);
  const result = pipelineCore.clearLowAlphaMatte(image);
  return {
    buf: result.cleared ? await encode(result.image) : buf,
    cleared: result.cleared,
  };
}

async function dropStrayBackground(buf) {
  const { image } = await decode(buf);
  const result = pipelineCore.dropStrayBackground(image);
  return {
    buf: result.dropped ? await encode(result.image) : buf,
    dropped: result.dropped,
    blobs: result.blobs,
  };
}

module.exports = {
  decode,
  encode,
  knockOutBackground,
  clearLowAlphaMatte,
  dropStrayBackground,
};
