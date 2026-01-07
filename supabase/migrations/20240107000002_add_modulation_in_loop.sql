-- Add modulation_in_loop column to configurations table
-- When true, modulation pedals (chorus, flanger, phaser, tremolo) are placed in the effects loop
-- When false (default), modulation stays in front of the amp ("dirty modulation")

ALTER TABLE configurations
ADD COLUMN IF NOT EXISTS modulation_in_loop BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN configurations.modulation_in_loop IS 'When true, modulation effects go in FX loop for cleaner sound';
