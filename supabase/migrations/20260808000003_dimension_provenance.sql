-- Provenance for MEASUREMENTS, the one attribute that had none.
--
-- The pedals table records where a photo came from (image_source_url,
-- image_license, image_fetched_at) and where a jack layout came from
-- (jacks_source_url, jacks_verified_at, jacks_confidence). Dimensions - which
-- decide packing, row derivation and rotation eligibility - had nothing. There
-- was no way to ask "who said so?", and no way to see which rows had never been
-- checked.
--
-- WHY NOW. Four dimension errors were found in two days, every one of them
-- while looking at something else, and every one in a row whose notes were null:
--
--     Strymon Timeline    6.5  -> 6.75 wide, 1.6 -> 2.7 tall
--     Strymon BigSky      6.5  -> 6.75 wide, 1.6 -> 2.7 tall
--     Holy Grail (Neo)    3.5  -> 2.75 wide, 4.7 -> 4.5 deep
--     Holy Grail (Neo)    50mA -> 75mA draw
--
-- None was found by a gate, because no gate could look. The Holy Grail's draw
-- was understated by half in the flattering direction, which is the failure the
-- power budget is explicitly built to avoid.
--
-- BACKFILL IS DELIBERATELY THIN. Only six rows carry both a URL and a
-- dimensional claim in `notes`, and only those are filled - by hand, per pedal,
-- not by parsing free text. The other 61 are left NULL, which is the honest
-- record: they came from the original seed and nobody wrote down where.
--
-- That is the same discipline as migration 20260801000004, which DELETED
-- thirteen pedals' invented jack rows rather than leave a guess outranking the
-- fallback it came from. An unattributed measurement is not a worse measurement;
-- it is one we cannot check, and the column exists to say so out loud.
--
-- The retailer URLs (Thomann for the Way Huge) are recorded as-is. A retailer is
-- weaker evidence than a manufacturer page - it can be a different revision -
-- but it is real evidence and far better than the nothing it replaces.
-- verify-pedal-dimensions.js reports the split rather than this schema judging it.

ALTER TABLE pedals ADD COLUMN IF NOT EXISTS dimensions_source_url TEXT;
ALTER TABLE pedals ADD COLUMN IF NOT EXISTS dimensions_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN pedals.dimensions_source_url IS
  'Where width/depth/height were read from. NULL = never researched, which is '
  'not the same as wrong - it means nobody can check it. May be the token '
  'owner-inspection, as jacks_source_url may (20260801000003).';
COMMENT ON COLUMN pedals.dimensions_verified_at IS
  'When the dimensions were last checked against dimensions_source_url.';

UPDATE pedals SET
  dimensions_source_url = 'https://www.strymon.net/product/timeline/',
  dimensions_verified_at = '2026-08-08T00:00:00Z'
WHERE manufacturer = 'Strymon' AND name = 'Timeline';

UPDATE pedals SET
  dimensions_source_url = 'https://www.strymon.net/product/bigsky/',
  dimensions_verified_at = '2026-08-08T00:00:00Z'
WHERE manufacturer = 'Strymon' AND name = 'BigSky';

UPDATE pedals SET
  dimensions_source_url = 'https://www.strymon.net/product/flint/',
  dimensions_verified_at = '2026-08-01T00:00:00Z'
WHERE manufacturer = 'Strymon' AND name = 'Flint';

UPDATE pedals SET
  dimensions_source_url = 'https://www.ehx.com/products/holy-grail-neo/',
  dimensions_verified_at = '2026-08-08T00:00:00Z'
WHERE manufacturer = 'Electro-Harmonix' AND name = 'Holy Grail Neo';

UPDATE pedals SET
  dimensions_source_url = 'https://www.pastfx.com/index.php/effects/chorus-ensembles/chorus-ensemble-deluxe',
  dimensions_verified_at = '2026-08-01T00:00:00Z'
WHERE manufacturer = 'PastFX' AND name = 'Chorus Ensemble Deluxe';

UPDATE pedals SET
  dimensions_source_url = 'https://www.thomannmusic.com/way_huge_conspiracy_theory_overdrive.htm',
  dimensions_verified_at = '2026-08-01T00:00:00Z'
WHERE manufacturer = 'Way Huge' AND name = 'Conspiracy Theory';
