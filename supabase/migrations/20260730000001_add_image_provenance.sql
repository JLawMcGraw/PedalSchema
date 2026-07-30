-- Image provenance for pedal photos.
--
-- `pedals.image_url` used to be the only image column, so once the mirror
-- script re-hosted a manufacturer photo into our storage bucket the origin was
-- gone: no way to answer "where did this come from?", to honour an attribution
-- requirement, or to respond to a takedown without re-running candidate search.
--
-- Provenance now travels with every image. The contract, stated identically in
-- README.md and scraper/README.md:
--   * image_url IS NOT NULL  => image_source_url IS NOT NULL. We never serve an
--     image whose origin we cannot name.
--   * image_url IS NULL + provenance present => deliberately referenced, not
--     mirrored. The Klon Centaur is the first such row: a photo exists upstream
--     but we do not redistribute it, so the board renders the category-rect
--     fallback and these columns record why.
--
-- The CHECK enforcing the first rule is deliberately NOT added here. Existing
-- mirrored rows have image_url with no recorded origin, and their origins are
-- only recoverable by re-running the mirror script (which knows the candidate
-- URLs). A CHECK fires on UPDATE as well as INSERT - even when declared NOT
-- VALID - so adding it now would break scraper/import-pedals.js, which updates
-- spec fields on those same legacy rows. Sequence is:
--   1. this migration (columns)
--   2. FORCE=1 node scraper/mirror-pedal-images.js  (populates every mirrored row)
--   3. a follow-up migration adding the CHECK, once no row violates it

ALTER TABLE pedals
  ADD COLUMN image_source_url  TEXT,
  ADD COLUMN image_license     TEXT,
  ADD COLUMN image_attribution TEXT,
  ADD COLUMN image_fetched_at  TIMESTAMPTZ;

COMMENT ON COLUMN pedals.image_source_url IS
  'Origin URL the bytes were fetched from, or ''user-upload'' for a photo the owner supplied. Required whenever image_url is set.';
COMMENT ON COLUMN pedals.image_license IS
  'Terms as known for the source image, e.g. manufacturer-proprietary, cc-by-sa-4.0, user-provided.';
COMMENT ON COLUMN pedals.image_attribution IS
  'Credit line to display where the licence requires one. NULL when none is required.';
COMMENT ON COLUMN pedals.image_fetched_at IS
  'When the source was last fetched - drives staleness checks and takedown response.';

-- User uploads are the one class of existing row whose provenance is knowable
-- from the data itself: the storage path encodes it (user/{uid}/...).
UPDATE pedals
SET image_source_url = 'user-upload',
    image_license    = 'user-provided',
    image_fetched_at = COALESCE(updated_at, created_at)
WHERE image_url IS NOT NULL
  AND image_source_url IS NULL
  AND image_url LIKE '%/pedal-images/user/%';

-- Klon Centaur: referenced, deliberately not mirrored.
--
-- The pedal is discontinued and has no manufacturer site, so it has been the
-- one gap in photo coverage (64/65) with the decision parked as "Wikimedia CC
-- needs an attribution decision". This is that decision, and it resolves to
-- NOT mirroring: the only good source is CC BY-SA 2.0, and our mirror pipeline
-- knocks out the background - which makes our copy a *derivative*, and
-- share-alike would then reach our output. Pointing at the file avoids
-- creating the derivative at all, and the board keeps rendering the clean
-- category-rect fallback.
--
-- Verified 2026-07-30 against the Commons file page.
UPDATE pedals
SET image_url        = NULL,
    image_source_url = 'https://commons.wikimedia.org/wiki/File:Klon_Centaur.jpg',
    image_license    = 'cc-by-sa-2.0',
    image_attribution = 'Klon Centaur photo by ArtBrom (Art Bromage), Seattle - CC BY-SA 2.0'
WHERE name = 'Klon Centaur' AND manufacturer = 'Klon';
