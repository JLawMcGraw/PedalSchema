-- The pinned board.
--
-- The dashboard's hero is the board you keep coming back to, and recency alone
-- is the wrong answer for a user with a main board and two situational ones:
-- one evening of fiddling with the fly rig would demote the board they
-- actually play. So the hero is the PINNED board, falling back to
-- most-recently-edited when nothing is pinned.
--
-- NOTE ON THE TABLE. The design handoff calls this `boards.pinned`. `boards`
-- is the catalogue of physical board models (Pedaltrain Classic Pro and so
-- on) and is shared system data, so a pin there would be one user pinning a
-- product for everybody. The saved boards a user owns are `configurations`,
-- which is what the dashboard lists and what this column belongs on.
ALTER TABLE configurations
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;

-- At most one pinned board per user, enforced by the database rather than by
-- the client remembering to unpin.
--
-- A PARTIAL index, on `WHERE pinned`: a plain UNIQUE(user_id, pinned) would
-- also make "false" unique per user, which would let a user own exactly one
-- unpinned board. The partial index constrains only the true rows, which is
-- the actual rule.
--
-- Because of it, pinning is unpin-then-pin and NOT the reverse: setting the
-- new pin while the old one still holds violates this index.
CREATE UNIQUE INDEX idx_configurations_one_pinned
  ON configurations(user_id)
  WHERE pinned;
