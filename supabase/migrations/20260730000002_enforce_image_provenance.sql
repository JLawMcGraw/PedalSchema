-- Enforce the provenance contract now that every row satisfies it.
--
-- Step 3 of the sequence in 20260730000001. That migration deliberately added
-- the columns WITHOUT this constraint, because a CHECK fires on UPDATE as well
-- as INSERT - even declared NOT VALID - and the 64 already-mirrored rows had no
-- recorded origin at the time, so any spec update from scraper/import-pedals.js
-- would have been rejected.
--
-- `FORCE=1 node scraper/mirror-pedal-images.js` has since backfilled all 64
-- (verified 2026-07-30: 65/65 rows carry provenance, 0 rows have an image_url
-- with a null image_source_url), so the constraint can now be added and
-- validated against existing data rather than deferred.
--
-- What it guarantees: we never serve an image whose origin we cannot name.
-- A row may have provenance without an image - that is the "referenced, not
-- mirrored" case (Klon Centaur) - but never an image without provenance.

ALTER TABLE pedals
  ADD CONSTRAINT image_url_requires_source
  CHECK (image_url IS NULL OR image_source_url IS NOT NULL);
