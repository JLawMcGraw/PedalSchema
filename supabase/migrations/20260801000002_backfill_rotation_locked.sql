-- Backfill rotation_locked on pedals placed BEFORE the column existed.
--
-- 20260801000001 added the column defaulting to false, which left existing
-- boards inconsistent with new ones: add a BigSky today and it arrives locked,
-- but a BigSky already on a board was unlocked, so the same pedal behaved
-- differently by age. Apply the same size default retroactively.
--
-- Thresholds must match isLargePedal() in
-- src/lib/engine/layout/rotation-eligibility.ts (4.5in wide, 6.5in deep).
-- They are placed in empty bands of the catalogue, so nothing sits near a line.
--
-- Only ever LOCKS - a row already true is left alone, so re-running is safe and
-- no deliberate unlock can be undone by it.

UPDATE configuration_pedals cp
SET rotation_locked = true
FROM pedals p
WHERE cp.pedal_id = p.id
  AND cp.rotation_locked IS DISTINCT FROM true
  AND (p.width_inches > 4.5 OR p.depth_inches > 6.5);
