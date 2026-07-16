#!/usr/bin/env node
/**
 * Log in, open the first configuration in the editor, extract full source +
 * derived state via window.__getPedalSchemaState/__getPedalSchemaDerived,
 * and save JSON + a screenshot for offline analysis.
 *
 * Usage: node .claude/scripts/extract-live-state.js [output-dir]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    });
  }
}

async function main() {
  loadEnv();
  const outDir = process.argv[2] || '.claude/screenshots';
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
    await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });

    // Open the first configuration from the dashboard
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    const editorLink = page.locator('a[href^="/editor/"]:not([href="/editor/new"])').first();
    const href = process.env.CONFIG_ID ? '/editor/' + process.env.CONFIG_ID : await editorLink.getAttribute('href');
    console.log('opening', href);
    await page.goto('http://localhost:3000' + href);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    if (process.env.TOGGLE_FXLOOP) {
      // Flip the Effects Loop switch through the real UI (Routing tab)
      await page.getByRole('tab', { name: /routing/i }).click();
      await page.waitForTimeout(500);
      const row = page.locator('div', { hasText: /^Effects Loop$/ }).locator('..');
      await page.locator('button[role="switch"]').first().click();
      await page.waitForTimeout(1500);
      console.log('toggled Effects Loop via UI');
      if (process.env.TOGGLE_4CM) {
        // Switches: [0] Effects Loop, [1] Modulation, [2] 4-Cable Method
        await page.locator('button[role="switch"]').nth(2).click();
        await page.waitForTimeout(1500);
        console.log('toggled 4-Cable Method via UI');
      }
    }

    if (process.env.REPRO_FXLOOP) {
      // Re-load the current config with an FX-loop amp and the last two
      // chain pedals moved into the effects loop
      await page.evaluate(() => {
        const st = window.__getPedalSchemaState();
        const byChain = [...st.placedPedals].sort((a, b) => a.chainPosition - b.chainPosition);
        const loopIds = byChain.slice(-2).map(p => p.id);
        const placedPedals = st.placedPedals.map(p =>
          loopIds.includes(p.id)
            ? { ...p, location: 'effects_loop', locationOverride: true }
            : p
        );
        window.__loadPedalSchemaRepro({
          id: st.id,
          name: 'FX Loop Repro',
          board: st.board,
          amp: {
            id: 'amp-repro', name: 'Test Amp', manufacturer: 'T',
            hasEffectsLoop: true, loopType: 'series', loopLevel: null,
            sendJackLabel: null, returnJackLabel: null,
            isSystem: true, createdBy: null, createdAt: '', notes: null,
          },
          useEffectsLoop: true,
          use4CableMethod: false,
          modulationInLoop: false,
          placedPedals,
          pedalsById: st.pedalsById,
        });
      });
      await page.waitForTimeout(1500);
      console.log('loaded FX-loop repro state');
    }

    if (process.env.CLICK_OPTIMIZE) {
      const btn = page.getByRole('button', { name: /optimize layout/i }).first();
      await btn.click();
      await page.waitForTimeout(2500);
      console.log('clicked Optimize Layout');
    }

    const state = await page.evaluate(() => window.__getPedalSchemaState?.() ?? { error: 'hook missing' });
    const derived = await page.evaluate(() => {
      const d = window.__getPedalSchemaDerived?.();
      if (!d) return { error: 'hook missing' };
      return {
        cableCount: d.cables.length,
        collisions: d.collisions,
        routedCables: d.routedCables.map(rc => ({
          from: `${rc.cable.fromType}${rc.cable.fromPedalId ? ':' + rc.cable.fromPedalId : ''}:${rc.cable.fromJack ?? ''}`,
          to: `${rc.cable.toType}${rc.cable.toPedalId ? ':' + rc.cable.toPedalId : ''}:${rc.cable.toJack ?? ''}`,
          valid: rc.valid,
          path: rc.path,
          violations: rc.validation?.violations ?? [],
        })),
      };
    });

    fs.writeFileSync(path.join(outDir, 'live-state.json'), JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(outDir, 'live-derived.json'), JSON.stringify(derived, null, 2));
    await page.screenshot({ path: path.join(outDir, 'live-editor.png'), fullPage: false });

    console.log('pedals:', state.placedPedals?.length, '| cables:', derived.cableCount,
      '| invalid:', derived.routedCables?.filter(c => !c.valid).length,
      '| collisions:', derived.collisions?.length);
    console.log('saved to', outDir);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
