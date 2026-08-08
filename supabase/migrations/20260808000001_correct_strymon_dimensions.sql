-- Correct the Timeline and BigSky dimensions to Strymon's published spec.
--
-- Both were seeded in 20240101000002 as 6.5 x 5.1 x 1.6 inches. strymon.net
-- publishes identical wording on both product pages:
--
--     "6.75" wide (17.15 cm) x 5.1" deep (12.95 cm) x 2.7" tall (6.86 cm)"
--
-- So depth was right, width was 0.25in short, and HEIGHT was 1.1in short - an
-- error two-thirds larger than the width one that was actually noticed. The
-- session log had carried this as a width discrepancy only.
--
-- WHAT IT COSTS. The reason this sat deferred is that changing a pedal's
-- dimensions moves any saved board layout containing it. It does:
--
--     configuration_pedals rows referencing Timeline or BigSky:  2
--       both on "test" (22 pedals, Classic Pro 32x16)
--     "J$ Home" contains no Strymon and is byte-identical.
--
-- Measured on the saved-board fingerprint, before and after. Every displaced
-- pedal moved by exactly 0.25in - the width delta propagating through the
-- packed run:
--
--                       SAVED layout        after Optimize
--     totalScore        623.39 -> 758.88    622.07 -> 622.11
--     spacing              237 -> 274.13    235.69 -> 235.69
--     routingFailures      100 -> 200       100 -> 100
--                        (1 -> 2 cables)    (1 cable, unchanged)
--
-- Two pedals really are 0.25in wider, so the SAVED test layout is now more
-- crowded and one more cable cannot route cleanly. Re-running Optimize fully
-- recovers it (622.11 against 622.07). The cost is real, bounded, and
-- self-healing; the owner chose the published spec over the stored one with
-- that trade in hand.
--
-- A NOTE ON HOW THIS WAS NEARLY MISREPORTED. The first blast-radius check
-- reported 0 affected rows. It had selected position_x/position_y/rotation -
-- columns that do not exist here (x_inches/y_inches/rotation_degrees) - and the
-- script read `data` without checking `error`, so a FAILED QUERY printed as a
-- measured zero via `rows?.length ?? 0`. Same tri-state trap the power budget
-- documents for currentMa: null is not zero. The fingerprint gate is what
-- caught it, because it predicted byte-identical and was allowed to be wrong.
--
-- BEHAVIOURALLY NEUTRAL, deliberately. isLargePedal() in
-- src/lib/engine/layout/rotation-eligibility.ts locks a pedal's rotation by
-- default above 4.5in wide or 6.5in deep. Both pedals were already over that on
-- width and still are (6.5 -> 6.75), so both continue to arrive rotationLocked,
-- which is the intended treatment for a 6.75in reverb. height_inches is not read
-- by the engine at all - only displayed, in properties-panel and pedal-card - so
-- correcting it changes what a user is told and no geometry.
--
-- The band list in rotation-eligibility.ts:69, which justifies the 4.5in
-- threshold by the catalogue having no width near it, is updated in the same
-- commit. That comment names 6.5 explicitly and would otherwise be describing a
-- catalogue that no longer exists.
--
-- PROVENANCE. The pedals table has provenance columns for images
-- (image_source_url) and jacks (jacks_source_url) but NONE for measurements,
-- which is exactly how a wrong dimension sat unquestioned for seven months. The
-- Strymon Flint records its measurement source in `notes`; both rows here had
-- notes NULL. This follows the Flint's pattern until there is a real column.

UPDATE pedals
SET width_inches  = 6.75,
    height_inches = 2.7,
    notes = 'Dimensions quoted from https://www.strymon.net/product/timeline/ - '
         || '"6.75" wide (17.15 cm) x 5.1" deep (12.95 cm) x 2.7" tall (6.86 cm)". '
         || 'Seeded as 6.5 x 5.1 x 1.6; width and height were both wrong. '
         || 'Power ("maximum 9 volts DC center-negative, with a minimum of 300mA") '
         || 'already matched and is unchanged.'
WHERE manufacturer = 'Strymon' AND name = 'Timeline';

UPDATE pedals
SET width_inches  = 6.75,
    height_inches = 2.7,
    notes = 'Dimensions quoted from https://www.strymon.net/product/bigsky/ - '
         || '"6.75" wide (17.15 cm) x 5.1" deep (12.95 cm) x 2.7" tall (6.86 cm)". '
         || 'Seeded as 6.5 x 5.1 x 1.6; width and height were both wrong. '
         || 'Power ("maximum 9 volts DC center-negative, with a minimum of 300mA") '
         || 'already matched and is unchanged.'
WHERE manufacturer = 'Strymon' AND name = 'BigSky';
