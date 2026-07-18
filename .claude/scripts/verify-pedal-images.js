#!/usr/bin/env node
/**
 * Verify pedal photos end-to-end:
 *  1. Editor canvas: every placed pedal whose pedal record has an imageUrl
 *     must render an SVG <image> whose href is on OUR storage host and
 *     whose geometry centers exactly on the pedal's box (data + math, not
 *     screenshot interpretation).
 *  2. Custom pedal upload: create a pedal through /pedals/new with a
 *     generated PNG, then confirm the DB row, the storage object (HTTP
 *     200), and cleanup.
 *
 * Usage: node .claude/scripts/verify-pedal-images.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

function loadEnv() {
  const envPath = path.join(__dirname, '../../.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

// 8x8 red PNG
const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64'
);

async function main() {
  loadEnv();
  const result = {};
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();

  try {
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15000 });

    // ---- 1. Canvas rendering ----
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    const href = await page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first().getAttribute('href');
    await page.goto('http://localhost:3000' + href);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    result.canvas = await page.evaluate(() => {
      const st = window.__getPedalSchemaState();
      const scale = 40;
      const checks = [];
      const images = [...document.querySelectorAll('svg g.pedal image')];
      for (const placed of st.placedPedals) {
        const pd = st.pedalsById[placed.pedalId];
        if (!pd?.imageUrl) { checks.push({ name: pd?.name, expected: 'no-image', ok: true }); continue; }
        const isRot = placed.rotationDegrees === 90 || placed.rotationDegrees === 270;
        const boxW = (isRot ? pd.depthInches : pd.widthInches) * scale;
        const boxH = (isRot ? pd.widthInches : pd.depthInches) * scale;
        const boxCx = placed.xInches * scale + boxW / 2;
        const boxCy = placed.yInches * scale + boxH / 2;
        const img = images.find(im => {
          const cx = parseFloat(im.getAttribute('x')) + parseFloat(im.getAttribute('width')) / 2;
          const cy = parseFloat(im.getAttribute('y')) + parseFloat(im.getAttribute('height')) / 2;
          return Math.abs(cx - boxCx) < 0.01 && Math.abs(cy - boxCy) < 0.01;
        });
        checks.push({
          name: pd.name,
          expectedCenter: [boxCx, boxCy],
          found: !!img,
          hrefOnOurStorage: img ? img.getAttribute('href').includes(location.hostname === 'localhost'
            ? 'supabase.co/storage/v1/object/public/pedal-images'
            : 'pedal-images') : false,
        });
      }
      return {
        placedWithImage: checks.filter(c => c.expectedCenter).length,
        rendered: checks.filter(c => c.found).length,
        allOnOurStorage: checks.filter(c => c.expectedCenter).every(c => c.hrefOnOurStorage),
        svgImageCount: images.length,
        detail: checks,
      };
    });

    await page.screenshot({ path: '.claude/screenshots/pedal-photos-editor.png' });

    // ---- 2. Upload flow ----
    const tmpPng = path.join(os.tmpdir(), 'verify-pedal.png');
    fs.writeFileSync(tmpPng, TEST_PNG);

    await page.goto('http://localhost:3000/pedals/new');
    await page.waitForLoadState('networkidle');
    await page.fill('#name', 'Verify Test Pedal');
    await page.fill('#manufacturer', 'ClaudeCo');
    await page.setInputFiles('#photo', tmpPng);
    await page.click('button[type="submit"]');
    await page.waitForURL(u => u.pathname === '/pedals', { timeout: 15000 }).catch(() => {});
    const landedOnList = page.url().endsWith('/pedals');
    await page.waitForTimeout(1000);

    // Confirm via service role: row exists, image on our storage, object serves
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: rows } = await sb.from('pedals')
      .select('id,name,image_url,is_system,created_by')
      .eq('name', 'Verify Test Pedal');
    const row = rows?.[0];
    let objectStatus = null;
    if (row?.image_url) {
      objectStatus = (await fetch(row.image_url, { method: 'HEAD' })).status;
    }
    const { data: jacks } = row
      ? await sb.from('pedal_jacks').select('jack_type,side').eq('pedal_id', row.id)
      : { data: null };

    result.upload = {
      landedOnList,
      rowCreated: !!row,
      isSystem: row?.is_system,
      imageOnOurStorage: !!row?.image_url?.includes('pedal-images'),
      storageObjectHttp: objectStatus,
      jacks: jacks?.map(j => `${j.jack_type}:${j.side}`),
    };

    // Cleanup the test pedal + its storage object
    if (row) {
      if (row.image_url) {
        const objPath = row.image_url.split('/pedal-images/')[1];
        if (objPath) await sb.storage.from('pedal-images').remove([objPath]);
      }
      await sb.from('pedals').delete().eq('id', row.id);
      result.upload.cleanedUp = true;
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
