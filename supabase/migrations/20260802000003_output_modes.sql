-- A switchable output's rating depends on the voltage it is switched to.
--
-- 20260802000002 stored one rated_ma plus a bare list of alternate voltages.
-- That is wrong for every supply worth modelling, and wrong in the optimistic
-- direction - which is the one direction this module is not allowed to be
-- wrong in.
--
-- Strymon Zuma, from strymon.net's own specs: outputs 8 and 9 give 500mA at
-- 9V, 375mA at 12V and 250mA at 18V. Under the old shape an 18V pedal on
-- output 8 would have been judged against 500mA - reporting exactly twice the
-- headroom that output actually has, and calling a supply adequate that is
-- not. The whole power module exists to not do that with unknown draws; doing
-- it with known ratings instead would be no better.
--
-- voltage/rated_ma stay as the DEFAULT mode, so the common fixed output needs
-- no JSON at all. alternate_modes carries the rest as {voltage, ratedMa}
-- pairs, because the two facts are inseparable and storing them apart is what
-- caused this.
--
-- Applied before any supply rows exist, so there is nothing to backfill.

ALTER TABLE power_supply_outputs
DROP COLUMN alternate_voltages;

ALTER TABLE power_supply_outputs
ADD COLUMN alternate_modes JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN power_supply_outputs.alternate_modes IS
  'Other voltages this output can be switched to, each with ITS OWN rating: [{"voltage":12,"ratedMa":375}]. Never a bare voltage list - a switchable output derates as voltage rises, and pairing them apart reports headroom the output does not have.';
