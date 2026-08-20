'use client';

import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { resolveNameEdit, NAME_MAX } from '@/lib/config-identity';
import { cn } from '@/lib/utils';

/**
 * The board's name, renamed in place.
 *
 * Deliberately NOT a dialog. Renaming is a one-field edit, and a modal for it
 * costs a trigger, an overlay, a focus trap and two buttons to change one
 * string - see `.agents/skills/redesign-existing-projects`, which calls out
 * "modals for everything" and asks for inline editing on simple actions.
 *
 * The commit rules live in `lib/config-identity` rather than here, because the
 * cases that matter are the DISCARDED ones (no-op edits must not mark the
 * board Unsaved) and a component cannot assert them.
 */
export function EditableTitle() {
  const { name, setName } = useConfigurationStore(
    useShallow((s) => ({ name: s.name, setName: s.setName }))
  );

  /** null = not editing. A string is the in-flight draft, '' included. */
  const [draft, setDraft] = useState<string | null>(null);

  /**
   * Focus and select on ATTACH, via a callback ref.
   *
   * Not an effect over a ref: this codebase has already shipped that bug twice
   * (canvas measurement, the wheel handler). An effect that reads `ref.current`
   * only ever sees the value from the render it was queued in, and a ref object
   * never changes identity, so nothing re-runs it when the node appears.
   */
  const focusOnAttach = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = useCallback(() => {
    setDraft((current) => {
      if (current === null) return null;
      const next = resolveNameEdit(current, name);
      if (next !== null) setName(next);
      return null;
    });
  }, [name, setName]);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(name)}
        aria-label="Rename board"
        title="Rename board"
        className={cn(
          'font-medium truncate rounded-none px-1 -mx-1 text-left',
          'transition-colors duration-200',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        {name}
      </button>
    );
  }

  return (
    <input
      ref={focusOnAttach}
      value={draft}
      maxLength={NAME_MAX}
      aria-label="Board name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          // Abandon the draft. Explicitly NOT commit() - Escape is the only way
          // back out of a rename you did not mean to start.
          e.preventDefault();
          setDraft(null);
        }
      }}
      className={cn(
        'font-medium bg-transparent rounded-none px-1 -mx-1 min-w-0 w-40 sm:w-64',
        'border border-input outline-none',
        'transition-[color,box-shadow] duration-200',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
      )}
    />
  );
}
