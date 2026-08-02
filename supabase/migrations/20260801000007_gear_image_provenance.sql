-- Photos for amps and boards, on the same terms as pedals.
--
-- The library lists twelve amps and eight boards as text-only cards, while
-- pedals have had photos since 2026-07-17. Extending the mirror pipeline to
-- cover them means extending the CONTRACT to cover them, because the reason
-- pedal provenance exists applies unchanged: once the mirror re-hosts a
-- manufacturer photo into our bucket, the origin is gone unless it was
-- recorded - and with it the ability to answer "where did this come from?",
-- honour an attribution requirement, or respond to a takedown.
--
-- Same contract, stated identically in README.md and scraper/README.md:
--   * image_url IS NOT NULL => image_source_url IS NOT NULL. We never serve an
--     image whose origin we cannot name.
--   * image_url IS NULL + provenance present => deliberately referenced, not
--     mirrored (the Klon Centaur case among pedals).
--
-- `boards` ALREADY had image_url - unused, NULL on all eight rows - and no way
-- to say where a picture came from. That is the exact state pedals were in
-- before 20260730000001, so it gets the same four columns rather than a
-- different shape. `amps` had no image column at all.
--
-- No CHECK here, for the reason the pedal migration gives: a CHECK fires on
-- UPDATE as well as INSERT, so it would break importers that touch spec fields
-- on rows predating the columns. Sequence is columns, then the mirror run,
-- then a CHECK once nothing violates it.

ALTER TABLE amps
  ADD COLUMN image_url         TEXT,
  ADD COLUMN image_source_url  TEXT,
  ADD COLUMN image_license     TEXT,
  ADD COLUMN image_attribution TEXT,
  ADD COLUMN image_fetched_at  TIMESTAMPTZ;

ALTER TABLE boards
  ADD COLUMN image_source_url  TEXT,
  ADD COLUMN image_license     TEXT,
  ADD COLUMN image_attribution TEXT,
  ADD COLUMN image_fetched_at  TIMESTAMPTZ;

COMMENT ON COLUMN amps.image_url IS
  'Public URL of the mirrored photo in the pedal-images bucket, or NULL when none is served.';
COMMENT ON COLUMN amps.image_source_url IS
  'Origin URL the bytes were fetched from. Required whenever image_url is set.';
COMMENT ON COLUMN amps.image_license IS
  'Terms as known for the source image, e.g. manufacturer-proprietary.';
COMMENT ON COLUMN amps.image_attribution IS
  'Credit line to display where the licence requires one. NULL when none is required.';
COMMENT ON COLUMN amps.image_fetched_at IS
  'When the source was last fetched - drives staleness checks and takedown response.';

COMMENT ON COLUMN boards.image_source_url IS
  'Origin URL the bytes were fetched from. Required whenever image_url is set.';
COMMENT ON COLUMN boards.image_license IS
  'Terms as known for the source image, e.g. manufacturer-proprietary.';
COMMENT ON COLUMN boards.image_attribution IS
  'Credit line to display where the licence requires one. NULL when none is required.';
COMMENT ON COLUMN boards.image_fetched_at IS
  'When the source was last fetched - drives staleness checks and takedown response.';
