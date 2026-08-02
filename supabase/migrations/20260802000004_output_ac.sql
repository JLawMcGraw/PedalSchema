-- Some outputs are AC, and AC is not a voltage variant of DC.
--
-- The Truetone 1 SPOT Pro CS12's output 12 is 9Vac 800mA - Truetone's manual
-- says it is "for certain older Line 6 or Digitech pedals". Every other output
-- on that supply, and every output on every other supply modelled so far, is
-- DC.
--
-- Without this column that output would be stored as voltage 9, and the plan
-- would cheerfully match a 9V DC pedal to it and report the pairing as within
-- rating. Plenty of current, right number, wrong kind of electricity - and the
-- report would say it was fine. That is the same failure the null-draw rule
-- exists to prevent, arriving through a different door.
--
-- Boolean rather than a voltage-type enum because there are exactly two kinds
-- here and an enum would invite a third that does not exist.

ALTER TABLE power_supply_outputs
ADD COLUMN is_ac BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN power_supply_outputs.is_ac IS
  'True for an AC output (CS12 output 12 is 9Vac, for old Line 6/Digitech pedals). An AC output can never power a DC pedal, whatever the voltage matches - the engine treats it as a mismatch rather than comparing numbers.';
