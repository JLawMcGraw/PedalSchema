-- Enforce the provenance contract on amps and boards, now that every row
-- satisfies it.
--
-- Step 3 of the sequence promised in 20260801000007, and the exact counterpart
-- of what 20260730000002 did for `pedals`. That migration added the columns
-- without this constraint because a CHECK fires on UPDATE as well as INSERT,
-- so declaring it before the mirror run would have rejected any unrelated
-- write to a row that had no recorded origin yet.
--
-- `node scraper/mirror-gear-images.js` has since run: 19 of the 20 rows carry
-- an image with provenance, and the twentieth (Marshall JCM2000 DSL) carries
-- neither. Verified 2026-08-02 by fetching every image_url from storage -
-- 20/20 rows conform, 0 rows have an image_url with a null image_source_url.
--
-- What it guarantees: we never serve an image whose origin we cannot name.
-- As with pedals, provenance WITHOUT an image stays legal - that is the
-- "referenced, not mirrored" case - but an image without provenance does not.

ALTER TABLE amps
  ADD CONSTRAINT image_url_requires_source
  CHECK (image_url IS NULL OR image_source_url IS NOT NULL);

ALTER TABLE boards
  ADD CONSTRAINT image_url_requires_source
  CHECK (image_url IS NULL OR image_source_url IS NOT NULL);
