-- Provenance for pedal jack layouts.
--
-- Jack data drives two visible things: where a cable physically attaches, and
-- whether the optimizer may rotate a pedal at all (rotation is only considered
-- for pedals with a signal jack on the top or bottom edge - see
-- src/lib/engine/layout/rotation-eligibility.ts). Both deserve better than a
-- guess, and until now there was no way to tell a researched layout from an
-- assumed one, or from one nobody has looked at yet.
--
-- Deliberately parallel to the image provenance contract
-- (20260730000001_add_image_provenance.sql), which states:
--   image_url IS NOT NULL => image_source_url IS NOT NULL
--
-- The jack contract is:
--   * a pedal with jack rows => jacks_source_url IS NOT NULL. We never serve a
--     jack layout whose origin we cannot name.
--   * jacks_confidence = 'confirmed' => the layout was read off the named
--     source (a manufacturer panel diagram or manual).
--   * jacks_confidence = 'unknown'   => researched and NOT confirmable. The
--     pedal keeps no jack rows and routing falls back to its default
--     assumption. This is a deliberate, recorded absence.
--   * jacks_verified_at IS NULL      => never researched. Different from
--     'unknown', and the distinction is the whole point: one is a finished
--     piece of work, the other is outstanding.
--
-- No CHECK constraint here, for the same reason the image migration gave: a
-- CHECK fires on UPDATE as well as INSERT, and scraper/import-pedals.js updates
-- spec fields on rows that predate this. Sequence is: this migration, then the
-- research passes, then a follow-up CHECK once no row violates it.

ALTER TABLE pedals
  ADD COLUMN jacks_source_url  TEXT,
  ADD COLUMN jacks_verified_at TIMESTAMPTZ,
  ADD COLUMN jacks_confidence  TEXT,
  ADD COLUMN jacks_notes       TEXT;

COMMENT ON COLUMN pedals.jacks_source_url IS
  'Where the jack layout was read from - manufacturer panel diagram or manual. Required whenever the pedal has pedal_jacks rows.';
COMMENT ON COLUMN pedals.jacks_verified_at IS
  'When the layout was last confirmed against the source. NULL means never researched, which is NOT the same as researched-and-unknown.';
COMMENT ON COLUMN pedals.jacks_confidence IS
  'confirmed = read off the named source. unknown = researched, could not confirm; no jack rows recorded and routing uses its default.';
COMMENT ON COLUMN pedals.jacks_notes IS
  'What the source actually showed, and anything odd about it - stereo pairs, jacks shared between functions, a layout that contradicts its series.';
