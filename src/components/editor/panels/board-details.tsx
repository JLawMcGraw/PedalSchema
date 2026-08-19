'use client';

import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  resolveNameEdit,
  resolveDescriptionEdit,
  NAME_MAX,
  DESCRIPTION_MAX,
} from '@/lib/config-identity';

/**
 * Name and description, edited in place.
 *
 * This fills what used to be the Properties panel's empty state - a whole
 * column saying "Select a pedal to view properties" and nothing else. The
 * description had no UI at all before this: `setDescription` existed in the
 * store and `handleSave` wrote the column, so every board's description was
 * permanently whatever it was created with.
 *
 * Both fields commit on blur through `lib/config-identity`, so a focus-and-
 * leave does not mark the board Unsaved.
 */
export function BoardDetails() {
  const { name, description, setName, setDescription } = useConfigurationStore(
    useShallow((s) => ({
      name: s.name,
      description: s.description,
      setName: s.setName,
      setDescription: s.setDescription,
    }))
  );

  // Drafts are local so a keystroke does not mark the board dirty; the store
  // sees one value, on blur.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);

  const commitName = useCallback(() => {
    setNameDraft((draft) => {
      if (draft === null) return null;
      const next = resolveNameEdit(draft, name);
      if (next !== null) setName(next);
      return null;
    });
  }, [name, setName]);

  const commitDesc = useCallback(() => {
    setDescDraft((draft) => {
      if (draft === null) return null;
      const next = resolveDescriptionEdit(draft, description);
      if (next !== null) setDescription(next);
      return null;
    });
  }, [description, setDescription]);

  return (
    <section className="p-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="board-name" className="text-xs">
          Board name
        </Label>
        <Input
          id="board-name"
          value={nameDraft ?? name}
          maxLength={NAME_MAX}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setNameDraft(null);
            }
          }}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="board-description" className="text-xs">
          Description
        </Label>
        <Textarea
          id="board-description"
          value={descDraft ?? description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          placeholder="What this board is for, and anything you want to remember about it."
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={commitDesc}
          onKeyDown={(e) => {
            // No Enter-to-commit here: newlines are legal in a description.
            if (e.key === 'Escape') {
              e.preventDefault();
              setDescDraft(null);
            }
          }}
          className="text-sm resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          Shown on the dashboard. Saved with the board.
        </p>
      </div>
    </section>
  );
}
