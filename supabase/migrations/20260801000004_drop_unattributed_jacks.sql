-- Delete jack rows that nobody can attribute.
--
-- Thirteen pedals carried three jack rows each with no jacks_source_url. They
-- came from the original seed and were never researched - and the evidence for
-- that is in the data itself. Every one of the 26 signal rows is:
--
--     input:right  @50
--     output:left  @50
--
-- which is EXACTLY what findJack() in src/lib/engine/cables/endpoints.ts
-- synthesises for a pedal with no jack data at all: `side: isInput ? 'right' :
-- 'left'`, `positionPercent: 50`. These are not measurements. They are the
-- fallback, written into the database as though it were fact, where it outranks
-- the fallback it came from and reports itself as knowledge.
--
-- The twelfth-and-thirteenth rows are power jacks at an invented position,
-- which nothing routes to.
--
-- PROVEN routing-neutral before running: both real boards were routed with and
-- without these rows, at both effects-loop settings - 118 lines of placements
-- and cable paths, byte-identical. Deleting changes no geometry because the
-- fallback produces the same geometry.
--
-- What it does change is honesty. verify-pedal-jacks.js reported 13 contract
-- violations ("has N jack rows but no jacks_source_url - a layout we cannot
-- attribute"); after this it reports none, and these pedals correctly read as
-- NOT RESEARCHED rather than as confirmed data. One of them - the Ibanez TS9 -
-- is on a real board.
--
-- The canvas keeps drawing their input and output, because the renderer now
-- shares the router's fallback via jacksToRender() and draws an assumed jack
-- HOLLOW. A guess should not look like a fact there either.
--
-- Nothing here invents a replacement. Real layouts arrive by research or by
-- owner inspection (20260801000003), pedal by pedal.

DELETE FROM pedal_jacks
WHERE pedal_id IN (
  SELECT id FROM pedals WHERE jacks_source_url IS NULL
);

-- These pedals have never been researched, and jacks_verified_at IS NULL is how
-- that is recorded. Make sure nothing claims otherwise.
UPDATE pedals
SET jacks_confidence = NULL,
    jacks_verified_at = NULL
WHERE jacks_source_url IS NULL;
