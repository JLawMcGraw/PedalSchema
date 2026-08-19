/**
 * What a board is CALLED - the rules for committing an edit to its name or
 * description.
 *
 * This is a separate pure module for one reason: the interesting cases are all
 * about when an edit should be DISCARDED, and that is invisible in the UI. A
 * user who clicks the title, changes nothing, and clicks away must not end up
 * with a board marked Unsaved - but the component cannot tell you whether it
 * gets that right, because the wrong behaviour looks identical until you read
 * the badge. So the decision lives here, where it can be asserted.
 *
 * Both functions return `null` for "discard this edit, change nothing".
 */

/** Fits the toolbar without truncating, and is far under any DB limit. */
export const NAME_MAX = 80;

/** The description is a note to yourself, not prose. */
export const DESCRIPTION_MAX = 500;

/**
 * The value to commit for a name edit, or null to leave the name alone.
 *
 * A name is NOT NULL in the schema and is the only handle a board has on the
 * dashboard, so an empty draft reverts rather than committing - blanking the
 * title is far more likely to be a stray select-all than an intention.
 */
export function resolveNameEdit(draft: string, current: string): string | null {
  const next = draft.trim().slice(0, NAME_MAX);
  if (!next) return null;
  if (next === current) return null;
  return next;
}

/**
 * The value to commit for a description edit, or null to leave it alone.
 *
 * Unlike the name, empty IS a legal value here: clearing a description is a
 * thing people mean to do. So the only discarded edit is one that changes
 * nothing.
 */
export function resolveDescriptionEdit(draft: string, current: string): string | null {
  const next = draft.trim().slice(0, DESCRIPTION_MAX);
  if (next === current) return null;
  return next;
}
