'use client';

import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';

/**
 * The editor's save state, in the app header.
 *
 * Mounted by `Header`, which is rendered for every page in the (dashboard)
 * group - so this has to decide for itself whether it has anything to say. It
 * reads the configuration store's `id`, which is null everywhere except the
 * editor, and renders nothing otherwise. That is deliberately not a prop: the
 * header is a server-rendered layout component two levels above the editor,
 * and threading editor state up through it would put board state in the
 * layout for the sake of one label.
 *
 * The handoff draws this as `REV 3 · SAVED 12:04`. Only the second half is
 * built. There is no revision counter anywhere in the schema or the store -
 * `configurations` has `updated_at` and nothing that counts - so REV would
 * have to be a number invented at render time, and a fabricated figure in an
 * instrument panel is worse than a missing one. It needs a column before it
 * can be shown.
 */
export function HeaderMeta() {
  const { id, isDirty, lastSavedAt } = useConfigurationStore(
    useShallow((s) => ({ id: s.id, isDirty: s.isDirty, lastSavedAt: s.lastSavedAt }))
  );

  if (!id) return null;

  const label = isDirty
    ? 'Unsaved'
    : lastSavedAt
      ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Saved';

  return (
    <span className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:inline">
      {label}
    </span>
  );
}
