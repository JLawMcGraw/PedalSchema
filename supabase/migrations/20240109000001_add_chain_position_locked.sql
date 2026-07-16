-- Add chain_position_locked column to configuration_pedals
-- When true, signal chain rules won't change this pedal's chain position

ALTER TABLE configuration_pedals
ADD COLUMN chain_position_locked BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN configuration_pedals.chain_position_locked IS
  'When true, signal chain rules will not reorder this pedal. User has locked its position.';
