-- Processing state for pedal images.
--
-- Provenance answers WHERE an image came from. These columns answer whether
-- the bytes are safe to draw directly on a pedalboard, which version of the
-- pipeline produced them, and what geometry was measured at the time.
--
-- Existing images are deliberately `unreviewed`: many have been inspected by
-- eye, but no persisted, reproducible review decision exists yet. A later
-- catalogue pass can promote them to `approved` after generating the canonical
-- contact sheet. Existing rows with provenance but no mirrored image are
-- intentional fallbacks; rows with neither are simply pedals without photos.

ALTER TABLE pedals
  ADD COLUMN image_processing_status TEXT,
  ADD COLUMN image_processing_result TEXT,
  ADD COLUMN image_processing_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN image_source_width INTEGER,
  ADD COLUMN image_source_height INTEGER,
  ADD COLUMN image_output_width INTEGER,
  ADD COLUMN image_output_height INTEGER,
  ADD COLUMN image_footprint_ratio NUMERIC,
  ADD COLUMN image_rotation_quarter_turns SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN image_perspective_top NUMERIC NOT NULL DEFAULT 0;

UPDATE pedals
SET image_processing_status = CASE
  WHEN image_url IS NOT NULL THEN 'unreviewed'
  WHEN image_source_url IS NOT NULL THEN 'fallback'
  ELSE 'not-provided'
END;

ALTER TABLE pedals
  ALTER COLUMN image_processing_status SET DEFAULT 'not-provided',
  ALTER COLUMN image_processing_status SET NOT NULL,
  ADD CONSTRAINT pedal_image_processing_status_valid CHECK (
    image_processing_status IN ('not-provided', 'unreviewed', 'approved', 'fallback', 'failed')
  ),
  ADD CONSTRAINT pedal_image_processing_result_valid CHECK (
    image_processing_result IS NULL OR image_processing_result IN (
      'knocked-out',
      'already-cutout',
      'no-background',
      'ragged-background',
      'subject-eaten',
      'reverted'
    )
  ),
  ADD CONSTRAINT pedal_image_processing_version_valid CHECK (image_processing_version >= 0),
  ADD CONSTRAINT pedal_image_source_dimensions_valid CHECK (
    (image_source_width IS NULL AND image_source_height IS NULL) OR
    (image_source_width > 0 AND image_source_height > 0)
  ),
  ADD CONSTRAINT pedal_image_output_dimensions_valid CHECK (
    (image_output_width IS NULL AND image_output_height IS NULL) OR
    (image_output_width > 0 AND image_output_height > 0)
  ),
  ADD CONSTRAINT pedal_image_footprint_ratio_valid CHECK (
    image_footprint_ratio IS NULL OR image_footprint_ratio > 0
  ),
  ADD CONSTRAINT pedal_image_rotation_valid CHECK (
    image_rotation_quarter_turns BETWEEN 0 AND 3
  ),
  ADD CONSTRAINT pedal_image_perspective_valid CHECK (
    image_perspective_top BETWEEN -0.35 AND 0.35
  ),
  ADD CONSTRAINT approved_pedal_image_has_output CHECK (
    image_processing_status <> 'approved' OR (
      image_url IS NOT NULL AND
      image_processing_result IN ('knocked-out', 'already-cutout') AND
      image_processing_version > 0 AND
      image_output_width > 0 AND
      image_output_height > 0
    )
  );

COMMENT ON COLUMN pedals.image_processing_status IS
  'Product decision for the board image: not-provided, unreviewed, approved, fallback, or failed.';
COMMENT ON COLUMN pedals.image_processing_result IS
  'Exact detector result from the image pipeline, retained separately from the product decision.';
COMMENT ON COLUMN pedals.image_processing_version IS
  'Version of the image-processing pipeline that produced the stored board asset; 0 means legacy or none.';
COMMENT ON COLUMN pedals.image_source_width IS
  'Decoded source width in pixels before downscaling and background removal.';
COMMENT ON COLUMN pedals.image_source_height IS
  'Decoded source height in pixels before downscaling and background removal.';
COMMENT ON COLUMN pedals.image_output_width IS
  'Stored board asset width in pixels after processing.';
COMMENT ON COLUMN pedals.image_output_height IS
  'Stored board asset height in pixels after processing.';
COMMENT ON COLUMN pedals.image_footprint_ratio IS
  'Output aspect divided by declared physical width/depth aspect; 1 is an exact match.';
COMMENT ON COLUMN pedals.image_rotation_quarter_turns IS
  'Clockwise quarter turns applied to the accepted cutout; 0 means the source orientation was retained.';
COMMENT ON COLUMN pedals.image_perspective_top IS
  'Top-edge perspective correction applied to the accepted cutout, in the range -0.35 to 0.35.';
