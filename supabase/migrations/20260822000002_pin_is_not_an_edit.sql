-- Pinning a board must not mark it as edited.
--
-- THE BUG THIS FIXES, observed. `update_configurations_updated_at` is an
-- unconditional BEFORE UPDATE trigger that sets updated_at = NOW(), so the
-- pin write - which changes one boolean and nothing a user would call a
-- change - stamped the board as edited. The dashboard's hero then read
--
--     PINNED · EDITED JUST NOW
--
-- on a board that had not been opened in a day. That is a readout stating
-- something false, and it corrupts the column the whole redesign rests on:
-- relative time replaced the absolute date precisely because HOW STALE a
-- board is, is the fact worth carrying. A field that resets when you file
-- something is not carrying it.
--
-- It also breaks the hero rule itself. The hero is the pinned board falling
-- back to most-recently-edited, and with this trigger firing, pinning made a
-- board the most recently edited too - so unpinning could not hand the hero
-- back to whichever board actually deserved it.
--
-- The fix is scoped to `configurations`; `boards` and `pedals` keep the plain
-- trigger, having no column with this property.
CREATE OR REPLACE FUNCTION configurations_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  /*
   * Compare the whole row minus the two columns that are not content:
   * `updated_at` itself (or the comparison would always differ once it had
   * been set) and `pinned` (which is filing, not editing).
   *
   * to_jsonb(row) - 'key' rather than a hand-written column list on purpose:
   * a list has to be updated by whoever adds the next column, and the failure
   * mode of forgetting is silent - an edit to that column would stop
   * refreshing the timestamp, and nothing would ever point at this function.
   */
  IF (to_jsonb(NEW) - 'updated_at' - 'pinned')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'pinned')
  THEN
    NEW.updated_at = NOW();
  ELSE
    -- Explicitly carried over rather than left alone: a caller can pass its
    -- own updated_at, and a pin-only write must not let one through either.
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_configurations_updated_at ON configurations;

CREATE TRIGGER update_configurations_updated_at
  BEFORE UPDATE ON configurations
  FOR EACH ROW
  EXECUTE FUNCTION configurations_touch_updated_at();
