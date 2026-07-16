-- Add routing_type and routing_config columns to pedals table
-- Supports complex routing pedals like AB switches and loop switchers

-- Add routing_type column with constraint
ALTER TABLE pedals
ADD COLUMN routing_type TEXT DEFAULT 'simple'
CHECK (routing_type IN ('simple', 'ab_switch', 'loop_switcher', 'mixer'));

-- Add routing_config column for complex routing configuration
-- Examples:
--   AB switch: {"outputCount": 2}
--   Loop switcher: {"loopCount": 4}
--   Mixer: {"inputCount": 4}
ALTER TABLE pedals
ADD COLUMN routing_config JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN pedals.routing_type IS
  'Type of routing behavior: simple (default), ab_switch, loop_switcher, or mixer';

COMMENT ON COLUMN pedals.routing_config IS
  'JSON configuration for complex routing pedals (outputCount, loopCount, inputCount)';
