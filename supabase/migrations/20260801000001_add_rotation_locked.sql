-- Add rotation_locked column to configuration_pedals
-- When true, Optimize will not turn this pedal, even where turning it would
-- route better. The app defaults it on for large pedals as they are added;
-- false is the right default for existing rows, which were laid out under the
-- old rule where nothing was ever turned anyway.

ALTER TABLE configuration_pedals
ADD COLUMN rotation_locked BOOLEAN DEFAULT false;

COMMENT ON COLUMN configuration_pedals.rotation_locked IS
  'When true, the layout optimizer will not rotate this pedal. Per board, not per pedal model - manual rotation ignores it.';
