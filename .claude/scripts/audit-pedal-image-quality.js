#!/usr/bin/env node
/**
 * Read-only catalogue image review.
 *
 * Downloads the currently served pedal images, measures alpha and physical
 * geometry, and writes a checkerboard contact sheet plus JSON manifest. It
 * never updates Supabase or storage.
 *
 * Usage: node .claude/scripts/audit-pedal-image-quality.js
 * Output: /tmp/pedal-image-audit/{manifest.json,contact-sheet.png}
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });

const pipelineCore = require('../../src/lib/images/pipeline-core.cjs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const OUTPUT = process.env.OUTPUT || '/tmp/pedal-image-audit';
const TILE_W = 240;
const TILE_H = 300;
const IMAGE_W = 208;
const IMAGE_H = 220;
const COLS = 6;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function measure(buf, physicalAspect) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
  const quality = pipelineCore.alphaQualityReport(image);
  const ratio = info.width / info.height / physicalAspect;
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  const corners = [
    alphaAt(0, 0),
    alphaAt(info.width - 1, 0),
    alphaAt(0, info.height - 1),
    alphaAt(info.width - 1, info.height - 1),
  ];
  const flags = [];
  if (quality.lowAlphaShare > 0.005) flags.push('low-alpha-matte');
  if (quality.solidStrayShare > 0.05) flags.push('fragmented');
  if (corners.every((alpha) => alpha > 200)) flags.push('opaque-corners');
  if (ratio < 0.8 || ratio > 1.25) flags.push('aspect-mismatch');
  return {
    width: info.width,
    height: info.height,
    footprintRatio: +ratio.toFixed(4),
    corners,
    ...quality,
    flags,
  };
}

function tileBackground() {
  return Buffer.from(`
    <svg width="${TILE_W}" height="${TILE_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#272b2f"/>
          <rect width="8" height="8" fill="#353a3f"/>
          <rect x="8" y="8" width="8" height="8" fill="#353a3f"/>
        </pattern>
      </defs>
      <rect width="${TILE_W}" height="${TILE_H}" fill="#171a1d"/>
      <rect x="16" y="12" width="${IMAGE_W}" height="${IMAGE_H}" fill="url(#grid)"/>
    </svg>`);
}

function tileLabel(pedal, report) {
  const title = `${pedal.manufacturer} ${pedal.name}`;
  const detail = report
    ? `${report.width}x${report.height} · ratio ${report.footprintRatio.toFixed(2)}`
    : 'NO BOARD IMAGE';
  const flags = report?.flags.length ? report.flags.join(' · ') : 'review-ready';
  const flagColour = report?.flags.length ? '#ffb15a' : '#74e39a';
  return Buffer.from(`
    <svg width="${TILE_W}" height="${TILE_H}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: 600 12px Arial, sans-serif; fill: #f2f4f5; }
        .detail { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #a8b0b7; }
        .flag { font: 700 9px ui-monospace, SFMono-Regular, Menlo, monospace; fill: ${flagColour}; letter-spacing: .4px; }
      </style>
      <text x="16" y="250" class="title">${escapeXml(title.slice(0, 34))}</text>
      <text x="16" y="269" class="detail">${escapeXml(detail)}</text>
      <text x="16" y="287" class="flag">${escapeXml(flags.slice(0, 40).toUpperCase())}</text>
    </svg>`);
}

async function makeTile(pedal, buf, report) {
  const layers = [{ input: tileBackground(), top: 0, left: 0 }];
  if (buf) {
    const image = await sharp(buf)
      .resize(IMAGE_W, IMAGE_H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    layers.push({ input: image, top: 12, left: 16 });
  }
  layers.push({ input: tileLabel(pedal, report), top: 0, left: 0 });
  return sharp({
    create: { width: TILE_W, height: TILE_H, channels: 4, background: '#171a1d' },
  }).composite(layers).png().toBuffer();
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const { data: pedals, error } = await supabase
    .from('pedals')
    .select('id,name,manufacturer,image_url,width_inches,depth_inches')
    .order('manufacturer')
    .order('name');
  if (error) throw error;

  const rows = [];
  const tiles = [];
  for (const pedal of pedals) {
    let buf = null;
    let report = null;
    let fetchError = null;
    if (pedal.image_url) {
      try {
        const response = await fetch(pedal.image_url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buf = Buffer.from(await response.arrayBuffer());
        report = await measure(buf, pedal.width_inches / pedal.depth_inches);
      } catch (error) {
        fetchError = String(error.message || error);
      }
    }
    rows.push({
      id: pedal.id,
      name: pedal.name,
      manufacturer: pedal.manufacturer,
      imageUrl: pedal.image_url,
      physical: { width: pedal.width_inches, depth: pedal.depth_inches },
      report,
      error: fetchError,
      disposition: !pedal.image_url
        ? 'fallback'
        : fetchError
          ? 'failed'
          : report.flags.length
            ? 'needs-review'
            : 'review-ready',
    });
    tiles.push(await makeTile(pedal, buf, report));
    process.stdout.write('.');
  }

  const rowsCount = Math.ceil(tiles.length / COLS);
  const composites = tiles.map((input, index) => ({
    input,
    left: (index % COLS) * TILE_W,
    top: Math.floor(index / COLS) * TILE_H,
  }));
  await sharp({
    create: {
      width: COLS * TILE_W,
      height: rowsCount * TILE_H,
      channels: 4,
      background: '#0f1113',
    },
  }).composite(composites).png().toFile(path.join(OUTPUT, 'contact-sheet.png'));

  const summary = {
    takenAt: new Date().toISOString(),
    total: rows.length,
    withImages: rows.filter((row) => row.imageUrl).length,
    fallback: rows.filter((row) => row.disposition === 'fallback').length,
    failed: rows.filter((row) => row.disposition === 'failed').length,
    needsReview: rows.filter((row) => row.disposition === 'needs-review').length,
    reviewReady: rows.filter((row) => row.disposition === 'review-ready').length,
  };
  fs.writeFileSync(
    path.join(OUTPUT, 'manifest.json'),
    JSON.stringify({ summary, pedals: rows }, null, 2)
  );

  console.log(`\n${JSON.stringify(summary)}`);
  for (const row of rows.filter((item) => item.disposition !== 'review-ready')) {
    console.log(
      `  ${(row.manufacturer + ' ' + row.name).padEnd(36)} ${row.disposition}` +
        `${row.report?.flags.length ? `: ${row.report.flags.join(', ')}` : ''}` +
        `${row.error ? `: ${row.error}` : ''}`
    );
  }
  console.log(`\nWrote ${OUTPUT}/manifest.json and ${OUTPUT}/contact-sheet.png (read-only audit)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
