-- The supply side of the power budget.
--
-- The demand half shipped 2026-08-01: derivePowerSummary answers "this board
-- wants at least 986mA". It cannot answer "output 3 is over", because there
-- was no supply entity anywhere in the schema - no output count, no per-output
-- rating, no assignment. TYPICAL_OUTPUT_MA = 100 in engine/power is documented
-- as "not a limit this module enforces", and that was literally true.
--
-- THREE THINGS, and the split matters:
--
--   power_supplies         the product (Voodoo Lab Pentavox, CIOKS DC7, ...)
--   power_supply_outputs   one row per physical output, each with its own
--                          rating and voltage
--   configuration_pedals.power_output_id
--                          which output a pedal is plugged into, on THIS board
--
-- Outputs are rows, not a count plus a rating. Real supplies are not uniform:
-- a Voodoo Lab Pedal Power 2 Plus has eight outputs where two are switchable
-- to 12V/18V and one is a 250mA digital output. Storing "8 x 100mA" would be a
-- lie about every supply worth modelling, and the lie would be invisible until
-- someone trusted it.
--
-- THE TRI-STATE TRAP REACHES HERE TOO. Pedal.current_ma is nullable and null
-- is not zero - see engine/power for why that rule exists. current_ma on an
-- OUTPUT is different: an output whose rating we do not know cannot be summed
-- against, so rated_ma is NOT NULL. If a supply's rating is unknown, the
-- honest record is no supply, not a supply of zero.

CREATE TABLE power_supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  is_isolated BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE power_supply_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id UUID NOT NULL REFERENCES power_supplies(id) ON DELETE CASCADE,
  -- What the supply's own panel calls it, so the UI can say "output 3" the
  -- way the label on the brick says it rather than by array index.
  label TEXT NOT NULL,
  voltage INTEGER NOT NULL,
  rated_ma INTEGER NOT NULL CHECK (rated_ma > 0),
  -- Some outputs are switchable (9V/12V/18V). Recorded as the alternates this
  -- output can also be set to; empty means fixed.
  alternate_voltages INTEGER[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL,
  UNIQUE(supply_id, sort_order)
);

-- Which supply this board is planned against. Nullable: a configuration with
-- no supply chosen is the normal state, and is exactly the demand-only
-- reporting that shipped first.
ALTER TABLE configurations
ADD COLUMN power_supply_id UUID REFERENCES power_supplies(id) ON DELETE SET NULL;

-- Which output each pedal is plugged into. Nullable and ON DELETE SET NULL: an
-- unassigned pedal is a real state the UI must show ("3 pedals not assigned"),
-- and swapping the supply must not silently delete the board's pedals.
ALTER TABLE configuration_pedals
ADD COLUMN power_output_id UUID REFERENCES power_supply_outputs(id) ON DELETE SET NULL;

CREATE INDEX idx_power_supply_outputs_supply ON power_supply_outputs(supply_id);
CREATE INDEX idx_configuration_pedals_power_output ON configuration_pedals(power_output_id);

COMMENT ON TABLE power_supplies IS
  'A power supply product. Outputs live in power_supply_outputs, one row each - real supplies are not uniform, so a count plus a rating would misdescribe most of them.';
COMMENT ON COLUMN power_supply_outputs.rated_ma IS
  'NOT NULL on purpose. Pedal.current_ma is nullable because "we do not know this pedal draw" is a real and important state; an output with an unknown rating is not - it cannot be summed against, so the honest record is no supply rather than a supply of zero.';
COMMENT ON COLUMN configurations.power_supply_id IS
  'The supply this board is planned against. NULL means demand-only reporting, which is the state every board was in before this migration.';
COMMENT ON COLUMN configuration_pedals.power_output_id IS
  'Which supply output this pedal is plugged into. NULL means unassigned, which the UI must surface rather than treat as powered.';

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE power_supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE power_supply_outputs ENABLE ROW LEVEL SECURITY;

-- Same shape as boards/pedals: system rows readable by everyone, user rows by
-- their owner, and a user may never create or edit a system row.
CREATE POLICY "System supplies are viewable by everyone" ON power_supplies
  FOR SELECT USING (is_system = true);

CREATE POLICY "Users can view their own supplies" ON power_supplies
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create supplies" ON power_supplies
  FOR INSERT WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can update their own supplies" ON power_supplies
  FOR UPDATE USING (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can delete their own supplies" ON power_supplies
  FOR DELETE USING (auth.uid() = created_by AND is_system = false);

-- Outputs follow their supply, exactly as board_rails follow their board.
CREATE POLICY "Outputs follow supply access" ON power_supply_outputs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM power_supplies s
      WHERE s.id = supply_id
        AND (s.is_system = true OR s.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can manage outputs for their supplies" ON power_supply_outputs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM power_supplies s
      WHERE s.id = supply_id
        AND s.created_by = auth.uid()
        AND s.is_system = false
    )
  );
