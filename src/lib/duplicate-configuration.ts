import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Copying a board.
 *
 * THE COLUMNS ARE STRIPPED, NOT LISTED, AND THAT IS THE WHOLE DESIGN.
 *
 * The obvious implementation names the columns to copy. It is also the one
 * that rots: `configuration_pedals` has gained `use_loop`, `chain_position_locked`,
 * `rotation_locked` and `power_output_id` across four separate migrations, and
 * a hand-written column list would have silently dropped each one on the day it
 * landed - producing a duplicate that looks right and has quietly lost the
 * rotation locks. Nothing would fail; the copy would just be subtly wrong.
 *
 * So this reads the row with `select('*')` and removes only the columns that
 * MUST NOT be carried. A column added tomorrow is copied tomorrow, with no
 * edit here. The cost is that a future column which must not be copied has to
 * be added to a list below - which is a decision someone has to make anyway,
 * and failing loudly (a UNIQUE violation) beats copying silently.
 */

/**
 * Identity and publication state. None of these may cross to a copy.
 *
 * `share_slug` is UNIQUE, so copying it fails the insert outright. `is_public`
 * is the dangerous one: it would fail nothing at all. Publishing is a
 * deliberate act, and a duplicate that inherits "published" puts a board the
 * user believes is private behind a live URL.
 */
export const CONFIG_COLUMNS_NOT_COPIED = [
  'id',
  'created_at',
  'updated_at',
  'share_slug',
  'is_public',
] as const;

/** Identity only: a placed pedal's parent and its own key are re-assigned. */
export const PLACED_PEDAL_COLUMNS_NOT_COPIED = [
  'id',
  'configuration_id',
  'created_at',
] as const;

type Row = Record<string, unknown>;

/** Everything except the named columns. */
export function withoutColumns(row: Row, columns: readonly string[]): Row {
  const drop = new Set<string>(columns);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !drop.has(key)));
}

/**
 * "test" -> "test (copy)" -> "test (copy 2)" -> "test (copy 3)".
 *
 * Duplicating a duplicate is the common case - it is how someone tries three
 * variants of a layout - and "test (copy) (copy)" is what that looks like when
 * nobody thought about the second one.
 */
export function copyName(name: string): string {
  const match = name.match(/^(.*) \(copy(?: (\d+))?\)$/);
  if (!match) return `${name} (copy)`;
  const [, base, n] = match;
  return `${base} (copy ${n ? Number(n) + 1 : 2})`;
}

export type DuplicateResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

/**
 * Duplicate a configuration and everything placed on it.
 *
 * NO TRANSACTION IS AVAILABLE HERE. supabase-js cannot open one, so the
 * configuration row and its pedals are two round trips, and a failure between
 * them would leave an empty board the user did not ask for. The second step
 * therefore cleans up after itself: if the pedals cannot be written, the new
 * configuration is deleted and the original error is reported. That is a
 * compensating delete, not a rollback - if the cleanup ALSO fails we say so
 * rather than pretending the board is not there.
 */
export async function duplicateConfiguration(
  supabase: SupabaseClient,
  configurationId: string,
  userId: string
): Promise<DuplicateResult> {
  const { data: original, error: readError } = await supabase
    .from('configurations')
    .select('*')
    .eq('id', configurationId)
    .single();

  if (readError || !original) {
    return { ok: false, error: readError?.message ?? 'That board could not be read.' };
  }

  const name = copyName(String(original.name ?? 'Untitled'));
  const { data: created, error: createError } = await supabase
    .from('configurations')
    .insert({
      ...withoutColumns(original as Row, CONFIG_COLUMNS_NOT_COPIED),
      name,
      // Set rather than carried. The copy belongs to whoever made it, which
      // is what makes this safe to point at a board the user does not own.
      user_id: userId,
    })
    .select('id')
    .single();

  if (createError || !created) {
    return { ok: false, error: createError?.message ?? 'The copy could not be created.' };
  }

  const { data: placed, error: placedReadError } = await supabase
    .from('configuration_pedals')
    .select('*')
    .eq('configuration_id', configurationId);

  if (placedReadError) {
    await supabase.from('configurations').delete().eq('id', created.id);
    return { ok: false, error: placedReadError.message };
  }

  if (placed && placed.length > 0) {
    const { error: insertError } = await supabase.from('configuration_pedals').insert(
      placed.map((row) => ({
        ...withoutColumns(row as Row, PLACED_PEDAL_COLUMNS_NOT_COPIED),
        configuration_id: created.id,
      }))
    );

    if (insertError) {
      const { error: cleanupError } = await supabase
        .from('configurations')
        .delete()
        .eq('id', created.id);
      return {
        ok: false,
        error: cleanupError
          ? `${insertError.message} (and "${name}" could not be cleaned up - delete it by hand)`
          : insertError.message,
      };
    }
  }

  return { ok: true, id: created.id, name };
}
