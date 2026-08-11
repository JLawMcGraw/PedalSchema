/**
 * Shared access to the editor's machine twin.
 *
 * Every verification script needs the same three things: log in, read board
 * state, and convert board inches to screen pixels for a drag or click. Those
 * were re-derived per script, and the board-to-screen conversion carried a
 * correctness rule that lived only in a prose comment - "the page is full of
 * lucide icon <svg>s, the canvas is the largest one" - a heuristic that breaks
 * silently the day a bigger decorative SVG ships.
 *
 * The canvas now carries [data-pedal-canvas], so selecting it is exact rather
 * than heuristic, and that selection lives here once.
 *
 * State comes from window.__getPedalSchemaSnapshot(), which reads the SAME
 * derived state the canvas renders. Scripts must never recompute geometry
 * themselves; a twin that disagrees with the UI is worse than no twin.
 */
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/** Load .env.local without overriding real environment variables. */
function loadEnv() {
  const envPath = path.join(__dirname, '../../../.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/** Log in with VERIFY_EMAIL / VERIFY_PASSWORD from .env.local. */
async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', process.env.VERIFY_EMAIL);
  await page.fill('input[type="password"]', process.env.VERIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

/**
 * Open a configuration in the editor. Uses CONFIG_ID when set, else the first
 * configuration on the dashboard. Returns the href opened.
 */
async function openEditor(page, configId = process.env.CONFIG_ID) {
  if (configId) {
    await page.goto(`${BASE_URL}/editor/${configId}`);
  } else {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    const href = await page
      .locator('a[href^="/editor/"]:not([href="/editor/new"])')
      .first()
      .getAttribute('href');
    if (!href) throw new Error('No configuration found on the dashboard');
    await page.goto(`${BASE_URL}${href}`);
  }
  /*
   * `networkidle` is a PROXY for readiness, and not the one that matters here.
   * waitForCanvas below polls the real condition - the canvas element and the
   * twin hook both present - so an idle network adds nothing except a way to
   * fail.
   *
   * And it does fail: run the gates one after another (verify-all.sh) and the
   * dev server is busy enough recompiling that networkidle can miss its 30s
   * window on a page that has in fact rendered. verify-jack-render passed 3/3
   * standalone and timed out inside the suite, which is a timing guess losing
   * a race, not a defect it was built to catch.
   *
   * So: give it a short budget, and let waitForCanvas be the judge.
   */
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await waitForCanvas(page);
  return page.url();
}

/** Wait until the canvas and the twin hook are both present. */
async function waitForCanvas(page, timeout = 15000) {
  await page.waitForSelector('[data-pedal-canvas]', { timeout });
  await page.waitForFunction(() => typeof window.__getPedalSchemaSnapshot === 'function', { timeout });
}

/** The full board snapshot: pedals, cables with strategies, collisions. */
async function snapshot(page) {
  return page.evaluate(() => {
    if (typeof window.__getPedalSchemaSnapshot !== 'function') {
      throw new Error('__getPedalSchemaSnapshot missing - is this the editor page?');
    }
    return window.__getPedalSchemaSnapshot();
  });
}

/**
 * Convert a board coordinate in INCHES to a screen pixel position.
 *
 * The canvas scales its viewBox with xMidYMid meet (the SVG default), so the
 * drawing is centred and uniformly scaled inside the element - the letterboxed
 * offset has to be added back, which is the part scripts got wrong when each
 * reimplemented it.
 */
async function toScreen(page, xInches, yInches) {
  return page.evaluate(
    ([bx, by]) => {
      const svg = document.querySelector('[data-pedal-canvas]');
      if (!svg) throw new Error('[data-pedal-canvas] not found');
      const rect = svg.getBoundingClientRect();
      const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const SCALE_PX_PER_INCH = 40;
      return {
        x: rect.left + (rect.width - vw * scale) / 2 + (bx * SCALE_PX_PER_INCH - vx) * scale,
        y: rect.top + (rect.height - vh * scale) / 2 + (by * SCALE_PX_PER_INCH - vy) * scale,
      };
    },
    [xInches, yInches]
  );
}

/** Drag a pedal by a board-space delta in inches, via its centre. */
async function dragPedalByInches(page, pedalId, dxInches, dyInches) {
  const snap = await snapshot(page);
  const p = snap.pedals.find((q) => q.id === pedalId);
  if (!p) throw new Error(`pedal ${pedalId} not on the board`);
  const cx = p.xInches + p.widthInches / 2;
  const cy = p.yInches + p.depthInches / 2;

  const start = await toScreen(page, cx, cy);
  const end = await toScreen(page, cx + dxInches, cy + dyInches);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return { start, end };
}

module.exports = {
  BASE_URL,
  loadEnv,
  login,
  openEditor,
  waitForCanvas,
  snapshot,
  toScreen,
  dragPedalByInches,
};
