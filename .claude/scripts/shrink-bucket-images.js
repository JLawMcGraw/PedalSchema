#!/usr/bin/env node
/**
 * Re-encode the gear photos in place: max 1280px longest edge, PNG, alpha
 * kept, and a YEAR of cache-control instead of an hour.
 *
 * WHY 1280. The largest size anything is ever drawn at is the pedal detail
 * page, whose `sizes` caps the derivative at 640; 1280 is that at 2x for a
 * retina display, with nothing above it to serve. The bucket held originals
 * up to 3014px and 7.42 MB - a thumbnail source thirty times larger than the
 * thumbnail.
 *
 * WHY PALETTE PNG. Measured on the real corpus, rendered at the 260px the
 * cards actually show: palette costs a mean difference of 0.70/255 against
 * truecolour's 0.13, and the WORST case is identical either way (2.87 vs
 * 2.85) because that difference comes from the RESIZE, not the quantisation.
 * For 0.2% of imperceptible change it is three times smaller - 19.57 MB
 * against 57.07 MB.
 *
 * WHY NOT WEBP. It would be 6.03 MB, better again. But every path in the
 * bucket ends in `.png` and every `image_url` in the database points at it,
 * so WebP means either a content-type that contradicts the extension or a
 * migration across three tables. Neither is worth 13 MB that nobody is
 * paying for: the free tier's storage limit is 1 GB, and per-visitor egress
 * is already zero since the images started going through Next's optimiser.
 *
 * ALPHA IS THE ONE THING THAT MUST SURVIVE. All 85 objects are knockout PNGs
 * with transparent backgrounds, and the editor canvas clips them onto the
 * board. This refuses to upload any image that lost its alpha channel, and
 * refuses to upload one that came out BIGGER than what is already there.
 *
 * Reads from a LOCAL BACKUP, not from storage - the bytes were downloaded
 * once for the inventory, and paying the egress twice to do the same job
 * would be its own joke. The backup is also the rollback: re-uploading it
 * restores the originals exactly.
 *
 * Usage:
 *   BACKUP_DIR=<dir> node .claude/scripts/shrink-bucket-images.js            # dry run
 *   BACKUP_DIR=<dir> node .claude/scripts/shrink-bucket-images.js --apply    # writes
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadEnv } = require('./lib/twin');
loadEnv();
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DIR = process.env.BACKUP_DIR;
const BUCKET = 'pedal-images';
const MAX = 1280;
const YEAR = '31536000';
const APPLY = process.argv.includes('--apply');

(async () => {
  const rows = JSON.parse(fs.readFileSync(path.join(DIR, '_inventory.json'), 'utf8'));
  let before = 0, after = 0, failed = 0, done = 0;

  for (const r of rows) {
    const orig = fs.readFileSync(path.join(DIR, r.path));
    before += orig.length;

    const longest = Math.max(r.w, r.h);
    let img = sharp(orig);
    if (longest > MAX) {
      img = img.resize({
        width: r.w >= r.h ? MAX : null,
        height: r.h > r.w ? MAX : null,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const out = await img.png({ compressionLevel: 9, palette: true }).toBuffer();
    after += out.length;

    // Never upload something bigger than what is already there.
    if (out.length >= orig.length) {
      console.log(`  skip (no gain) ${r.path}`);
      continue;
    }

    const meta = await sharp(out).metadata();
    if (!meta.hasAlpha && r.alpha) {
      console.error(`  ALPHA LOST, refusing: ${r.path}`);
      failed++;
      continue;
    }

    if (APPLY) {
      const { error } = await sb.storage.from(BUCKET).upload(r.path, out, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: YEAR,
      });
      if (error) { console.error(`  FAILED ${r.path}: ${error.message}`); failed++; continue; }
    }
    done++;
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(2);
  console.log(`\n${APPLY ? 'UPLOADED' : 'DRY RUN'}: ${done} objects`);
  console.log(`before ${mb(before)} MB -> after ${mb(after)} MB  (${(100 * (1 - after / before)).toFixed(1)}% smaller)`);
  console.log(`failures: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
