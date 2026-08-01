-- Widen the jack provenance contract to admit direct inspection.
--
-- 20260731000001 assumed every jack layout comes from a document: "Where the
-- jack layout was read from - manufacturer panel diagram or manual." That
-- covered the BOSS catalogue, whose manuals are all online, and it is why 17
-- pedals are still outstanding - several of them made by people who simply do
-- not publish jack placement.
--
-- But the board's owner has the pedal in their hands, and looking at it is
-- BETTER evidence than a panel drawing: it cannot be a rendering of a
-- different revision, and it cannot fall foul of the mirroring trap (a manual
-- drawing the rear panel face-on shows it from behind, so its left and right
-- are flipped relative to the top-down view this app uses).
--
-- What the contract actually protects is ATTRIBUTION - "we never serve a jack
-- layout whose origin we cannot name" - and "the owner looked at it" is a
-- nameable origin. So jacks_source_url may now hold either a URL or a
-- provenance token, and `owner-inspection` is the first such token.
--
-- Nothing parses this column as a URL: only scraper/import-pedal-jacks.js and
-- .claude/scripts/verify-pedal-jacks.js read it, and both test presence.
--
-- The rule that does NOT change: a recorded jack's edge must have been
-- observed, from whichever source is named. An unobserved jack is omitted, not
-- guessed - which is why the entries added alongside this migration carry no
-- power jacks. The owner reported the signal jacks and was not asked about DC.

COMMENT ON COLUMN pedals.jacks_source_url IS
  'Where the jack layout was read from. Either a URL (manufacturer panel diagram or manual) or a provenance token - currently only ''owner-inspection'', meaning the edges were read off the physical pedal by its owner. Required whenever the pedal has pedal_jacks rows.';

COMMENT ON COLUMN pedals.jacks_confidence IS
  'confirmed = every recorded jack''s edge was observed at the named source, document or physical unit. unknown = researched, could not confirm; no jack rows recorded and routing uses its default.';
