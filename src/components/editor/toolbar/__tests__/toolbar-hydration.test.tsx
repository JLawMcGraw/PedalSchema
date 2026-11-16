/**
 * The toolbar's buttons hydrate without a mismatch.
 *
 * Reported on 2026-11-16, on /editor/[id] in `next dev`:
 *
 *     A tree hydrated but some attributes of the server rendered HTML didn't
 *     match the client properties.
 *       <RuleItem label="Undo">      + disabled={true}   - disabled={null}
 *       <RuleItem label="Optimize">  + disabled={true}   - disabled={null}
 *       <button data-save-board>     + disabled={true}   - disabled={null}
 *
 * Read literally that says the server rendered the three ENABLED and the
 * client rendered them disabled. The first block here shows the server does no
 * such thing - it renders all four disabled whatever the store holds - so the
 * attribute was removed from the DOM after the HTML arrived and before React
 * hydrated. The three it was removed from are exactly the three that are live
 * on a board with unsaved edits (Redo, dead in that state, is not in the
 * report), which is the signature of Firefox restoring each button's previous
 * enabled/disabled state across a reload.
 *
 * The second block pins the opt-out. See NO_STATE_RESTORE in editor-toolbar.
 *
 * This renders a real component with react-dom/server, which needs no DOM -
 * worth knowing in a repo whose other component code is untested for want of
 * jsdom.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { makeAmp, makeBoard, makePedalSet } from '@/lib/engine/__tests__/support/fixtures';
import { useConfigurationStore } from '@/store/configuration-store';
import { EditorToolbar } from '../editor-toolbar';

const STATEFUL = ['Undo', 'Redo', 'Optimize', 'Save'];

/** The toolbar's stateful buttons as the SERVER emits them: label -> raw attribute text. */
function serverButtons(): Map<string, string> {
  const html = renderToString(React.createElement(EditorToolbar, { onSave: () => {} }));
  const found = new Map<string, string>();
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attributes = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const label = /aria-label="([^"]+)"/.exec(attributes)?.[1] ?? text;
    if (STATEFUL.includes(label)) found.set(label, attributes);
  }
  return found;
}

const store = () => useConfigurationStore.getState();

/** A board with pedals on it, one unsaved edit and one undo step: everything live. */
function makeStoreDirty(): void {
  const set = makePedalSet('seven');
  store().initConfiguration({
    id: 'toolbar-hydration', name: 'Toolbar hydration', board: makeBoard('wide'),
    amp: makeAmp(true), placedPedals: set.placedPedals, pedalsById: set.pedalsById,
  });
  store().movePedal(store().placedPedals[0].id, { x: 3, y: 3 });
}

describe('what the server renders for the stateful buttons', () => {
  beforeEach(() => {
    store().initConfiguration({ id: 'empty', name: 'Empty', board: makeBoard('wide'), placedPedals: [], pedalsById: {} });
  });

  it('finds all four', () => {
    expect([...serverButtons().keys()].sort()).toEqual([...STATEFUL].sort());
  });

  it('is disabled for every one on an untouched store', () => {
    for (const [label, attributes] of serverButtons()) {
      expect(/\bdisabled\b/.test(attributes), `${label} should be disabled`).toBe(true);
    }
  });

  it('is STILL disabled when the server-side store is dirty', () => {
    // The store is a module singleton and on the server it outlives a request,
    // so "the server had a dirty board" is the obvious suspect. It is not the
    // cause: React is given the store's initial state on the server.
    makeStoreDirty();
    expect(store().isDirty).toBe(true);
    expect(store().history.past.length).toBeGreaterThan(0);
    expect(store().placedPedals.length).toBeGreaterThan(0);

    for (const [label, attributes] of serverButtons()) {
      expect(/\bdisabled\b/.test(attributes), `${label} should be disabled`).toBe(true);
    }
  });
});

describe('a reload cannot re-enable them behind React\'s back', () => {
  it('every stateful button opts out of state restoration', () => {
    const buttons = serverButtons();
    expect(buttons.size).toBe(STATEFUL.length);
    for (const [label, attributes] of buttons) {
      // Case-insensitive: HTML attribute names are, and React's server renderer
      // currently writes this one as it is spelled in JSX.
      expect(/\bautocomplete="off"/i.test(attributes), `${label} is missing autocomplete="off"`).toBe(true);
    }
  });
});
