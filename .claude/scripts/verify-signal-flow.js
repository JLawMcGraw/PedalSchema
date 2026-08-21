#!/usr/bin/env node
/**
 * Does the Routing panel's Signal flow describe THIS board?
 *
 * The block it replaces was a drawing. Four hardcoded lines - `Guitar ->
 * Tuner -> NS-2 IN`, `Send -> Drives -> Amp IN` - rendered whether or not a
 * tuner, an NS-2 or a drive pedal was anywhere on the board, and rendered
 * identically for a nine-pedal rig and a twenty-two pedal one. It could not
 * disagree with the wiring, because it was never derived from anything.
 *
 * It is now built from `deriveSignalTopology`, which is the same function the
 * cable list, the routing cost and the placer already share. That makes a new
 * failure possible and worth gating: the diagram and the cables coming from
 * one source but being walked differently - a merged node that swallows a
 * device, a segment dropped, a pedal counted twice.
 *
 * So this asserts the two halves against each other and against the store:
 *
 *   FICTION      every device named is the guitar, the chosen amp, or a pedal
 *                actually on this board
 *   COVERAGE     every placed pedal appears exactly once, as a run member or
 *                as a hub node - nothing lost, nothing invented
 *   AGREEMENT    the external jacks the diagram names are exactly the external
 *                jacks the cables use
 *   RESPONSE     turning the effects loop on changes the diagram, and the
 *                header's mode readout tracks it
 *
 * Reads the twin (window.__getPedalSchemaState / __getPedalSchemaDerived) and
 * `data-flow-*` handles - never the rendered wording, per the 2026-08-20
 * selector sweep.
 *
 * Writes nothing. The effects-loop toggle is in memory only; there is no
 * autosave in this app and this never clicks [data-save-board]. It restores
 * the switch before it leaves.
 *
 * Usage: node .claude/scripts/verify-signal-flow.js
 */
const { chromium } = require('playwright');
const { loadEnv, login, openEditor, waitForCanvas } = require('./lib/twin');

loadEnv();

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

/** The flow as the panel actually rendered it, read off the handles. */
const readFlow = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-signal-flow]');
    if (!root) return null;
    // BY ATTRIBUTE, not by child index: the spine is the first child of this
    // element and carries neither handle. Reading `children` counted it as a
    // run of `Number(null)` = 0 and printed a phantom leading segment.
    return [...root.querySelectorAll('[data-flow-node], [data-flow-run]')].map((el) =>
      el.hasAttribute('data-flow-node')
        ? {
            kind: 'node',
            device: el.getAttribute('data-flow-node'),
            placedId: el.getAttribute('data-flow-node-id') || null,
            jacks: (el.getAttribute('data-flow-jacks') || '').split('|').filter(Boolean),
            endpoints: (el.getAttribute('data-flow-endpoints') || '').split('|').filter(Boolean),
          }
        : {
            kind: 'run',
            count: Number(el.getAttribute('data-flow-run')),
            ids: (el.getAttribute('data-flow-pedal-ids') || '').split('|').filter(Boolean),
          }
    );
  });

/** What the store and the cables say, with no help from the panel. */
const readTruth = (page) =>
  page.evaluate(() => {
    const s = window.__getPedalSchemaState();
    const d = window.__getPedalSchemaDerived();
    return {
      ampName: s.amp?.name ?? null,
      ampHasLoop: !!s.amp?.hasEffectsLoop,
      useEffectsLoop: s.useEffectsLoop,
      use4CableMethod: s.use4CableMethod,
      pedalCount: s.placedPedals.length,
      // IDS are what the assertions compare; the names are for the failure
      // message. Comparing names cannot tell two CS-3s apart, and this board
      // has two.
      pedalIds: s.placedPedals.map((p) => p.id),
      pedalNames: s.placedPedals.map((p) => (s.pedalsById[p.pedalId] || p.pedal)?.name ?? '?'),
      externalEndpoints: [
        ...new Set(
          d.cables.flatMap((c) =>
            [c.fromType, c.toType].filter((t) => t !== 'pedal')
          )
        ),
      ].sort(),
    };
  });

const modeReadout = (page) =>
  page.evaluate(() => {
    const tabpanel = document.querySelector('[role="tabpanel"]:not([hidden])');
    return tabpanel?.querySelector('[data-panel-meta]')?.textContent?.trim() ?? null;
  });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await login(page);
    const url = await openEditor(page);
    await waitForCanvas(page);
    console.log(`board: ${url}\n`);

    const routing = page.locator('[data-panel-tab="routing"]').first();
    await routing.waitFor({ timeout: 10000 });
    await routing.click();
    await page.locator('[data-signal-flow]').first().waitFor({ timeout: 10000 });

    const truth = await readTruth(page);
    const flow = await readFlow(page);
    console.log(
      `store: ${truth.pedalCount} pedals, amp=${truth.ampName}, ` +
        `loop=${truth.useEffectsLoop}, 4cm=${truth.use4CableMethod}`
    );
    console.log(
      'flow:  ' +
        flow
          .map((s) =>
            s.kind === 'node'
              ? `[${s.device}${s.jacks.length ? ' ' + s.jacks.join('>') : ''}]`
              : `(${s.count})`
          )
          .join(' ') +
        '\n'
    );

    // --- FICTION -----------------------------------------------------------
    const boardIds = new Set(truth.pedalIds);
    const nodes = flow.filter((s) => s.kind === 'node');
    const runs = flow.filter((s) => s.kind === 'run');

    const invented = nodes.filter((n) =>
      n.placedId ? !boardIds.has(n.placedId) : !['Guitar', truth.ampName].includes(n.device)
    );
    check(
      invented.length === 0,
      'every device in the diagram is on this board',
      invented.length
        ? `invented: ${invented.map((n) => n.device).join(', ')}`
        : `${nodes.length} nodes, all real`
    );

    const strangers = runs.flatMap((r) => r.ids).filter((id) => !boardIds.has(id));
    check(
      strangers.length === 0,
      'every pedal named in a run is on this board',
      strangers.length
        ? `not placed: ${strangers.join(', ')}`
        : `${runs.flatMap((r) => r.ids).length} run members`
    );

    check(
      runs.every((r) => r.count === r.ids.length),
      "each run's stated count matches the pedals it lists"
    );

    // --- COVERAGE ----------------------------------------------------------
    //
    // BY PLACED-PEDAL ID, which is what makes this exact. Matching on names
    // cannot tell two CS-3s apart, and it also cannot tell a hub drawn TWICE
    // - entered at IN, left at SEND, re-entered at RETURN - from a pedal
    // wrongly counted twice, which is a real failure this must still catch.
    const runIds = runs.flatMap((r) => r.ids);
    const hubIds = [...new Set(nodes.map((n) => n.placedId).filter(Boolean))];
    const duplicatedInRuns = runIds.filter((id, i) => runIds.indexOf(id) !== i);
    check(
      duplicatedInRuns.length === 0,
      'no pedal appears in two runs',
      duplicatedInRuns.length ? duplicatedInRuns.join(', ') : `${runIds.length} distinct`
    );
    check(
      hubIds.every((id) => !runIds.includes(id)),
      'a hub is a node OR a run member, never both'
    );

    const accounted = new Set([...runIds, ...hubIds]);
    const missing = truth.pedalIds.filter((id) => !accounted.has(id));
    check(
      accounted.size === truth.pedalCount && missing.length === 0,
      `the diagram accounts for all ${truth.pedalCount} pedals exactly once`,
      missing.length
        ? `missing ${missing.length}: ${missing
            .map((id) => truth.pedalNames[truth.pedalIds.indexOf(id)])
            .join(', ')}`
        : `${runIds.length} in runs + ${hubIds.length} hub node(s)`
    );

    // --- AGREEMENT WITH THE CABLES -----------------------------------------
    //
    // The diagram names amp jacks in words; the cables name them as endpoint
    // types. Same set, two vocabularies - which is exactly where a diagram
    // drifts away from the wiring it claims to describe.
    // The node's OWN declaration of which external jacks it is, not a guess
    // read off the label. The first version of this mapped the word to the
    // type - `includes('RET')` meant a return - and a Blues Deluxe, whose
    // return is labelled POWER AMP IN, was scored as a second send. The gate
    // failed while the panel was right, which is what reading copy buys you.
    const namedJacks = (steps) =>
      new Set(steps.filter((s) => s.kind === 'node').flatMap((s) => s.endpoints));
    const agrees = (steps, endpoints) => {
      const named = namedJacks(steps);
      const cabled = new Set(endpoints);
      return {
        ok: named.size === cabled.size && [...named].every((j) => cabled.has(j)),
        detail: `diagram: {${[...named].sort().join(', ')}}  cables: {${[...cabled]
          .sort()
          .join(', ')}}`,
      };
    };
    const first = agrees(flow, truth.externalEndpoints);
    check(first.ok, 'the external jacks in the diagram are the ones the cables use', first.detail);

    // --- RESPONSE ----------------------------------------------------------
    const modeBefore = await modeReadout(page);
    check(
      modeBefore === (truth.use4CableMethod ? '4-cable' : 'standard') ||
        modeBefore === 'pedal loop',
      `the header reports the topology mode ("${modeBefore}")`
    );

    if (truth.ampHasLoop) {
      const before = JSON.stringify(flow);
      const sw = page.locator('button[role="switch"][data-setting="effects-loop"]').first();
      await sw.click();
      await page.waitForTimeout(300);
      const after = await readFlow(page);
      check(
        JSON.stringify(after) !== before,
        'flipping the effects loop redraws the diagram',
        'flow: ' +
          after
            .map((s) => (s.kind === 'node' ? `[${s.device}]` : `(${s.count})`))
            .join(' ')
      );

      // AND IT STILL AGREES WITH THE CABLES in the new state. Asserting "the
      // loop is on, therefore the amp's loop jacks are wired" would be
      // asserting a rule the ENGINE does not hold to: while an NS-2 style
      // pedal loop is active, deriveSignalTopology returns before it ever
      // looks at the amp loop, so the switch changes pedal locations and
      // nothing else. That is worth knowing - see the session entry - but it
      // is the engine's behaviour, not this panel's, and the panel is now the
      // thing that SHOWS it, where the old drawing claimed a Send -> Return
      // run that did not exist. What must hold in every mode is that the
      // diagram and the cables describe the same rig.
      const endpointsNow = await page.evaluate(() => [
        ...new Set(
          window
            .__getPedalSchemaDerived()
            .cables.flatMap((c) => [c.fromType, c.toType].filter((t) => t !== 'pedal'))
        ),
      ]);
      const second = agrees(after, endpointsNow);
      check(second.ok, 'and it still agrees with the cables after the change', second.detail);

      // --- 4-CABLE METHOD, when this board can express it -------------------
      //
      // The mode the old drawing was WRITTEN for, and the one it got most
      // wrong: it hardcoded an NS-2, a tuner and a looper into four lines
      // that rendered the same on every board. The switch only exists when
      // the rig has a loop amp and a 4-cable-capable pedal, so this leg runs
      // only where it is real.
      const fourCm = page.locator('button[role="switch"][data-setting="four-cable-method"]');
      const loopIsOn = await page.evaluate(() => window.__getPedalSchemaState().useEffectsLoop);
      if (loopIsOn && (await fourCm.count()) > 0) {
        await fourCm.first().click();
        await page.waitForTimeout(300);
        const flow4 = await readFlow(page);
        const mode4 = await modeReadout(page);
        console.log(
          '  4cm:  ' +
            flow4
              .map((s) =>
                s.kind === 'node'
                  ? `[${s.device}${s.jacks.length ? ' ' + s.jacks.join('>') : ''}]`
                  : `(${s.count})`
              )
              .join(' ')
        );
        check(mode4 === '4-cable', `the header reports 4-cable ("${mode4}")`);

        const ids4 = flow4.filter((s) => s.kind === 'run').flatMap((r) => r.ids);
        const hubs4 = [...new Set(flow4.filter((s) => s.kind === 'node').map((n) => n.placedId).filter(Boolean))];
        const dupes4 = ids4.filter((id, i) => ids4.indexOf(id) !== i);
        check(
          dupes4.length === 0 && new Set([...ids4, ...hubs4]).size === truth.pedalCount,
          `4-cable accounts for all ${truth.pedalCount} pedals exactly once`,
          `${ids4.length} in runs + ${hubs4.length} hub node(s)`
        );

        // The method IS the hub spanning the preamp: the signal enters the
        // hub, leaves by its send into the amp input, comes back from the amp
        // send to the hub return, and leaves the hub's output to the amp
        // return. Four amp jacks, two hub visits. A diagram that cannot show
        // that is not showing the 4-cable method.
        const hubVisits = flow4.filter((s) => s.kind === 'node' && s.placedId);
        check(
          hubVisits.length === 2,
          'the hub is drawn twice - into the preamp and back out',
          hubVisits.map((n) => `${n.device} ${n.jacks.join('>')}`).join('  ')
        );

        const endpoints4 = await page.evaluate(() => [
          ...new Set(
            window
              .__getPedalSchemaDerived()
              .cables.flatMap((c) => [c.fromType, c.toType].filter((t) => t !== 'pedal'))
          ),
        ]);
        check(
          endpoints4.length === 4,
          '4-cable wires all four external jacks',
          `endpoints: ${endpoints4.sort().join(', ')}`
        );
        const third = agrees(flow4, endpoints4);
        check(third.ok, 'and the diagram names exactly those four', third.detail);

        await fourCm.first().click();
        await page.waitForTimeout(200);
        const off = await page.evaluate(() => window.__getPedalSchemaState().use4CableMethod);
        check(off === truth.use4CableMethod, '4-cable is left as it was found');
      }

      // Put it back. Nothing was saved, but leaving a board dirty in a browser
      // someone else's gate is about to open is not this script's business.
      await sw.click();
      await page.waitForTimeout(200);
      const restored = await page.evaluate(() => window.__getPedalSchemaState().useEffectsLoop);
      check(restored === truth.useEffectsLoop, 'the switch is left as it was found');
    } else {
      console.log('  SKIP  effects-loop response (this board\'s amp has no FX loop)');
    }

    // --- ONE INDENT ---------------------------------------------------------
    //
    // The old panel wrapped its body in `p-3 space-y-3` and every block inside
    // added its own `px-3`, so Routing's content sat 24px from the panel edge
    // while Power's sat at 12px - two panels one tab apart, indented
    // differently. Measured, not eyeballed.
    const routingX = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) [data-section-label]')].map(
        (el) => Math.round(el.getBoundingClientRect().left)
      )
    );
    const panelX = await page.evaluate(() => {
      const p = document.querySelector('[role="tabpanel"]:not([hidden])');
      return p ? Math.round(p.getBoundingClientRect().left) : null;
    });
    const indents = [...new Set(routingX.map((x) => x - panelX))];
    check(
      routingX.length > 0 && indents.length === 1 && indents[0] === 12,
      `every section label starts on one column (${indents.join(', ')}px from the panel edge)`,
      `${routingX.length} sections`
    );

    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  } catch (err) {
    console.error(err);
    failures++;
  } finally {
    await browser.close();
  }

  process.exit(failures === 0 ? 0 : 1);
})();
