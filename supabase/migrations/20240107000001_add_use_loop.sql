-- Add use_loop column to configuration_pedals
-- This controls whether pedals with send/return (like NS-2) use their loop routing

ALTER TABLE configuration_pedals
ADD COLUMN use_loop BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN configuration_pedals.use_loop IS 'For pedals with send/return jacks (like NS-2), whether to route drive pedals through the loop';
