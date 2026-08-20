#!/usr/bin/env node
/**
 * A published board is reachable by a stranger, previews as itself, and a
 * private one is not reachable at all.
 *
 * `isPublic`/`shareSlug` were in the types and the RLS policies from the very
 * first migration, and nothing in `src/` referenced either one - so a board
 * could not be shared at all.
 *
 * The check that matters is the one in a CLEAN BROWSER CONTEXT with no
 * session. Everything here passes trivially while logged in as the owner,
 * because the owner can read their own board through a different policy
 * entirely. A share link that only works for the person who made it is the
 * exact failure this gate exists to catch, and it is invisible from the
 * authoring tab.
 *
 * THIS SCRIPT WRITES. It publishes a real board and restores the exact
 * is_public/share_slug it found, in a finally block.
 *
 * Usage: node .claude/scripts/verify-sharing.js
 */
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, login, openEditor, BASE_URL } = require('./lib/twin');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

(async () => {
  loadEnv();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const browser = await chromium.launch();
  const owner = await browser
    .newContext({ viewport: { width: 1440, height: 950 } })
    .then((c) => c.newPage());

  let configId = null;
  let original = null;

  try {
    await login(owner);
    const url = await openEditor(owner);
    configId = url.match(/\/editor\/([0-9a-f-]{36})/)[1];

    const { data: before } = await sb
      .from('configurations')
      .select('is_public, share_slug, name')
      .eq('id', configId)
      .single();
    original = before;
    console.log(`board: ${before.name}  (${configId.slice(0, 8)})`);
    console.log(`start: is_public=${before.is_public} slug=${before.share_slug}\n`);

    // Make sure we begin unpublished, whatever the board's stored state.
    if (before.is_public) {
      await sb.from('configurations').update({ is_public: false }).eq('id', configId);
      await owner.reload();
    }

    // --- the control lives in the Board panel ---------------------------
    await owner.click('[data-panel-tab="properties"]');
    await owner.waitForSelector('#board-public', { timeout: 15000 });
    const startsOff = await owner.locator('#board-public').getAttribute('data-state');
    check(startsOff === 'unchecked', 'a board starts unpublished', `switch is ${startsOff}`);

    // --- publish ---------------------------------------------------------
    await owner.locator('#board-public').click();
    await owner.waitForFunction(
      () => {
        const el = document.querySelector('input[aria-label="Share link"]');
        return !!el && el.value.includes('/s/');
      },
      null,
      { timeout: 15000 }
    );
    const link = await owner.inputValue('input[aria-label="Share link"]');
    const slug = link.split('/s/')[1];
    check(!!slug, 'publishing produces a share link', link);

    const { data: afterPublish } = await sb
      .from('configurations')
      .select('is_public, share_slug')
      .eq('id', configId)
      .single();
    check(
      afterPublish.is_public === true && afterPublish.share_slug === slug,
      'and writes it immediately, without waiting for Save',
      `row: is_public=${afterPublish.is_public} slug=${afterPublish.share_slug}`
    );

    // --- THE CHECK: a stranger, with no session --------------------------
    const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const stranger = await strangerCtx.newPage();

    const cookies = await strangerCtx.cookies();
    check(cookies.length === 0, 'the stranger really has no session', `${cookies.length} cookies`);

    const resp = await stranger.goto(`${BASE_URL}/s/${slug}`);
    check(resp.status() === 200, 'a published board opens for a stranger', `-> ${resp.status()}`);
    check(
      !stranger.url().includes('/login'),
      'and is not bounced to the login page',
      stranger.url()
    );

    await stranger.waitForSelector('[data-pedal-canvas]', { timeout: 20000 });
    const view = await stranger.evaluate(() => {
      const svg = document.querySelector('[data-pedal-canvas]');
      return {
        pedals: svg.querySelectorAll('[data-pedal-id]').length,
        heading: document.querySelector('h1')?.textContent?.trim(),
        // The editor's furniture must not be here.
        hasToolbar: !!document.querySelector('button[aria-label="Rename board"]'),
        hasLibrary: !!document.querySelector('input[placeholder="Search pedals..."]'),
      };
    });
    const { count: realPedals } = await sb
      .from('configuration_pedals')
      .select('id', { count: 'exact', head: true })
      .eq('configuration_id', configId);

    check(
      view.pedals === realPedals,
      'the stranger sees every pedal on the board',
      `${view.pedals} rendered, ${realPedals} stored`
    );
    check(view.heading === original.name, 'and the board is named', `"${view.heading}"`);
    check(
      !view.hasToolbar && !view.hasLibrary,
      'and gets no editing furniture',
      `toolbar=${view.hasToolbar} library=${view.hasLibrary}`
    );

    // --- the link preview -------------------------------------------------
    /*
     * A shared link is most people's first sight of the app. It previewed as a
     * bare title on a blank card, and the check that matters is not "is there
     * a meta tag" but "does the URL in it return a real image" - a broken
     * og:image and a missing one look identical in the HTML.
     */
    const meta = await stranger.evaluate(() => {
      const get = (sel) => document.querySelector(sel)?.getAttribute('content') ?? null;
      return {
        ogTitle: get('meta[property="og:title"]'),
        ogDesc: get('meta[property="og:description"]'),
        ogImage: get('meta[property="og:image"]'),
        ogImageW: get('meta[property="og:image:width"]'),
        ogImageH: get('meta[property="og:image:height"]'),
        twCard: get('meta[name="twitter:card"]'),
      };
    });

    check(meta.ogTitle === original.name,
      'og:title is the board name, not the templated site title',
      `"${meta.ogTitle}"`);
    check(!!meta.ogImage, 'the page declares an og:image', meta.ogImage);
    check(meta.twCard === 'summary_large_image',
      'and asks for a large card', `twitter:card=${meta.twCard}`);

    if (meta.ogImage) {
      // Fetch it as a stranger would, and prove it is really a 1200x630 PNG by
      // reading the IHDR header rather than trusting the meta tag's numbers.
      const shot = await stranger.evaluate(async (url) => {
        const r = await fetch(url);
        const buf = new Uint8Array(await r.arrayBuffer());
        const be32 = (o) => (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
        return {
          status: r.status,
          type: r.headers.get('content-type'),
          bytes: buf.length,
          isPng: buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
          width: be32(16),
          height: be32(20),
          b64: btoa(String.fromCharCode(...buf.slice(0, 0))),
        };
      }, meta.ogImage);

      check(shot.status === 200 && shot.isPng,
        'the og:image URL returns a real PNG',
        `HTTP ${shot.status}, ${shot.type}, ${shot.bytes} bytes, PNG=${shot.isPng}`);
      check(shot.width === 1200 && shot.height === 630,
        'at the 1200x630 a large card wants',
        `${shot.width}x${shot.height} (declared ${meta.ogImageW}x${meta.ogImageH})`);
      // An image that renders the board is necessarily bigger than an empty
      // card; a satori failure tends to produce a near-empty PNG.
      check(shot.bytes > 8000, 'and is not a blank card', `${shot.bytes} bytes`);

      if (process.env.OG_IMAGE_OUT) {
        // A SEPARATE page. Navigating `stranger` to the image takes it off the
        // board, and the read-only drag check below then finds no pedal to
        // drag - which is how this was caught: the gate failed on the check
        // AFTER the one being added.
        const preview = await strangerCtx.newPage();
        await preview.goto(meta.ogImage);
        await preview.screenshot({ path: process.env.OG_IMAGE_OUT });
        await preview.close();
        console.log(`        saved preview to ${process.env.OG_IMAGE_OUT}`);
      }
    }

    // Read-only: dragging a pedal must not move it.
    const moved = await stranger.evaluate(async () => {
      const el = document.querySelector('[data-pedal-id]');
      const r = el.getBoundingClientRect();
      const before = { x: r.x, y: r.y };
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + 80, clientY: r.y + 40 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((r2) => setTimeout(r2, 300));
      const after = document.querySelector('[data-pedal-id]').getBoundingClientRect();
      return { before, after: { x: after.x, y: after.y } };
    });
    check(
      Math.abs(moved.after.x - moved.before.x) < 0.5 && Math.abs(moved.after.y - moved.before.y) < 0.5,
      'a viewer cannot drag someone else\'s pedals',
      `moved by ${(moved.after.x - moved.before.x).toFixed(2)}, ${(moved.after.y - moved.before.y).toFixed(2)}px`
    );

    // --- unpublish closes the link immediately ---------------------------
    await owner.locator('#board-public').click();
    await owner.waitForFunction(
      () => !document.querySelector('input[aria-label="Share link"]'),
      null,
      { timeout: 15000 }
    );
    const closed = await stranger.goto(`${BASE_URL}/s/${slug}`);
    check(
      closed.status() === 404,
      'unpublishing shuts the link at once',
      `-> ${closed.status()}`
    );

    // And it shuts for the OWNER too - the case RLS does NOT cover.
    //
    // A stranger is refused by the policy itself, so `.eq('is_public', true)`
    // in the loader looks redundant: dropping it still 404s an unpublished
    // board for a logged-out visitor. But the owner reads their own row
    // through "Users can view their own configurations", which has no
    // is_public condition - so without that .eq the person who unpublished
    // would load their own share page perfectly and conclude the link still
    // works for everyone else. That is the wrong direction for a sharing
    // mistake to point.
    const ownerOnClosed = await owner.goto(`${BASE_URL}/s/${slug}`);
    check(
      ownerOnClosed.status() === 404,
      'and shuts it for the owner too, who RLS would otherwise let in',
      `-> ${ownerOnClosed.status()}`
    );
    await owner.goto(url);
    await owner.click('[data-panel-tab="properties"]');
    await owner.waitForSelector('#board-public', { timeout: 15000 });

    // Re-publishing restores the SAME link rather than orphaning every copy.
    await owner.locator('#board-public').click();
    await owner.waitForSelector('input[aria-label="Share link"]', { timeout: 15000 });
    const relink = await owner.inputValue('input[aria-label="Share link"]');
    check(relink === link, 'and re-publishing gives back the same link', relink);

    // A slug nobody issued is a 404, not a crash.
    const nonsense = await stranger.goto(`${BASE_URL}/s/zzzzzzzzzzzz`);
    check(nonsense.status() === 404, 'an unknown slug is a 404', `-> ${nonsense.status()}`);
    const malformed = await stranger.goto(`${BASE_URL}/s/not_a_slug!`);
    check(malformed.status() === 404, 'so is a malformed one', `-> ${malformed.status()}`);

    await strangerCtx.close();
  } catch (err) {
    check(false, 'gate ran to completion', err.stack || err.message);
  } finally {
    if (configId && original) {
      const { error } = await sb
        .from('configurations')
        .update({ is_public: original.is_public, share_slug: original.share_slug })
        .eq('id', configId);
      const { data: now } = await sb
        .from('configurations')
        .select('is_public, share_slug')
        .eq('id', configId)
        .single();
      check(
        !error && now.is_public === original.is_public && now.share_slug === original.share_slug,
        'restored the board to how it was found',
        `is_public=${now.is_public} slug=${now.share_slug}`
      );
    }
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
