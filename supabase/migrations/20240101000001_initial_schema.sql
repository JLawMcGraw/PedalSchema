-- PedalSchema Initial Schema
-- Run this migration in your Supabase SQL editor

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE pedal_category AS ENUM (
  'tuner',
  'filter',
  'compressor',
  'pitch',
  'boost',
  'overdrive',
  'distortion',
  'fuzz',
  'noise_gate',
  'eq',
  'modulation',
  'tremolo',
  'delay',
  'reverb',
  'looper',
  'volume',
  'utility',
  'multi_fx'
);

CREATE TYPE jack_side AS ENUM ('top', 'bottom', 'left', 'right');

CREATE TYPE power_polarity AS ENUM ('center_negative', 'center_positive');

CREATE TYPE loop_type AS ENUM ('series', 'parallel', 'switchable', 'none');

CREATE TYPE chain_location AS ENUM (
  'front_of_amp',
  'effects_loop',
  'four_cable_hub',
  'flexible'
);

-- ============================================
-- CORE TABLES
-- ============================================

-- Pedalboards (system + custom)
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manufacturer TEXT,
  width_inches DECIMAL(5,2) NOT NULL,
  depth_inches DECIMAL(5,2) NOT NULL,
  rail_width_inches DECIMAL(4,2) DEFAULT 0.6,
  clearance_under_inches DECIMAL(4,2),
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  image_url TEXT,
  CONSTRAINT valid_dimensions CHECK (width_inches > 0 AND depth_inches > 0)
);

-- Board rail positions
CREATE TABLE board_rails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  position_from_back_inches DECIMAL(5,2) NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(board_id, sort_order)
);

-- Pedals database
CREATE TABLE pedals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  category pedal_category NOT NULL,
  width_inches DECIMAL(4,2) NOT NULL,
  depth_inches DECIMAL(4,2) NOT NULL,
  height_inches DECIMAL(4,2) NOT NULL,
  voltage INTEGER DEFAULT 9,
  current_ma INTEGER,
  polarity power_polarity DEFAULT 'center_negative',
  default_chain_position INTEGER,
  preferred_location chain_location DEFAULT 'front_of_amp',
  supports_4_cable BOOLEAN DEFAULT false,
  needs_buffer_before BOOLEAN DEFAULT false,
  needs_direct_pickup BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  image_url TEXT,
  notes TEXT,
  CONSTRAINT valid_pedal_dimensions CHECK (
    width_inches > 0 AND depth_inches > 0 AND height_inches > 0
  )
);

-- Pedal jack positions
CREATE TABLE pedal_jacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedal_id UUID NOT NULL REFERENCES pedals(id) ON DELETE CASCADE,
  jack_type TEXT NOT NULL,
  side jack_side NOT NULL,
  position_percent INTEGER NOT NULL,
  label TEXT,
  CONSTRAINT valid_position CHECK (position_percent >= 0 AND position_percent <= 100)
);

-- Amplifiers
CREATE TABLE amps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  has_effects_loop BOOLEAN DEFAULT false,
  loop_type loop_type DEFAULT 'none',
  loop_level TEXT,
  send_jack_label TEXT DEFAULT 'SEND',
  return_jack_label TEXT DEFAULT 'RETURN',
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- User configurations
CREATE TABLE configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  board_id UUID NOT NULL REFERENCES boards(id),
  amp_id UUID REFERENCES amps(id),
  use_effects_loop BOOLEAN DEFAULT false,
  use_4_cable_method BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_public BOOLEAN DEFAULT false,
  share_slug TEXT UNIQUE
);

-- Pedals placed on a configuration
CREATE TABLE configuration_pedals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  pedal_id UUID NOT NULL REFERENCES pedals(id),
  x_inches DECIMAL(5,2) NOT NULL,
  y_inches DECIMAL(5,2) NOT NULL,
  rotation_degrees INTEGER DEFAULT 0,
  chain_position INTEGER NOT NULL,
  location chain_location NOT NULL DEFAULT 'front_of_amp',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(configuration_id, chain_position)
);

-- Cable connections
CREATE TABLE configuration_cables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_pedal_id UUID REFERENCES configuration_pedals(id) ON DELETE CASCADE,
  from_jack TEXT,
  to_type TEXT NOT NULL,
  to_pedal_id UUID REFERENCES configuration_pedals(id) ON DELETE CASCADE,
  to_jack TEXT,
  calculated_length_inches DECIMAL(5,2),
  cable_type TEXT DEFAULT 'patch',
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_pedals_category ON pedals(category);
CREATE INDEX idx_pedals_manufacturer ON pedals(manufacturer);
CREATE INDEX idx_pedals_is_system ON pedals(is_system);
CREATE INDEX idx_pedals_name ON pedals(name);
CREATE INDEX idx_boards_is_system ON boards(is_system);
CREATE INDEX idx_configurations_user ON configurations(user_id);
CREATE INDEX idx_configurations_public ON configurations(is_public) WHERE is_public = true;
CREATE INDEX idx_configuration_pedals_config ON configuration_pedals(configuration_id);
CREATE INDEX idx_board_rails_board ON board_rails(board_id);
CREATE INDEX idx_pedal_jacks_pedal ON pedal_jacks(pedal_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_rails ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedal_jacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE amps ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_pedals ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_cables ENABLE ROW LEVEL SECURITY;

-- Boards policies
CREATE POLICY "System boards are viewable by everyone" ON boards
  FOR SELECT USING (is_system = true);

CREATE POLICY "Users can view their own boards" ON boards
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create boards" ON boards
  FOR INSERT WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can update their own boards" ON boards
  FOR UPDATE USING (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can delete their own boards" ON boards
  FOR DELETE USING (auth.uid() = created_by AND is_system = false);

-- Board rails policies (follow board access)
CREATE POLICY "Rails follow board access" ON board_rails
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM boards b
      WHERE b.id = board_id
      AND (b.is_system = true OR b.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can manage rails for their boards" ON board_rails
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM boards b
      WHERE b.id = board_id
      AND b.created_by = auth.uid()
      AND b.is_system = false
    )
  );

-- Pedals policies
CREATE POLICY "System pedals are viewable by everyone" ON pedals
  FOR SELECT USING (is_system = true);

CREATE POLICY "Users can view their own pedals" ON pedals
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create pedals" ON pedals
  FOR INSERT WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can update their own pedals" ON pedals
  FOR UPDATE USING (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can delete their own pedals" ON pedals
  FOR DELETE USING (auth.uid() = created_by AND is_system = false);

-- Pedal jacks policies (follow pedal access)
CREATE POLICY "Jacks follow pedal access" ON pedal_jacks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pedals p
      WHERE p.id = pedal_id
      AND (p.is_system = true OR p.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can manage jacks for their pedals" ON pedal_jacks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM pedals p
      WHERE p.id = pedal_id
      AND p.created_by = auth.uid()
      AND p.is_system = false
    )
  );

-- Amps policies
CREATE POLICY "System amps are viewable by everyone" ON amps
  FOR SELECT USING (is_system = true);

CREATE POLICY "Users can view their own amps" ON amps
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create amps" ON amps
  FOR INSERT WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can update their own amps" ON amps
  FOR UPDATE USING (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can delete their own amps" ON amps
  FOR DELETE USING (auth.uid() = created_by AND is_system = false);

-- Configurations policies
CREATE POLICY "Users can view their own configurations" ON configurations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Public configurations are viewable" ON configurations
  FOR SELECT USING (is_public = true);

CREATE POLICY "Users can create configurations" ON configurations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own configurations" ON configurations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own configurations" ON configurations
  FOR DELETE USING (auth.uid() = user_id);

-- Configuration pedals policies
CREATE POLICY "Access configuration pedals through configuration" ON configuration_pedals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM configurations c
      WHERE c.id = configuration_id
      AND (c.user_id = auth.uid() OR c.is_public = true)
    )
  );

CREATE POLICY "Users can manage their configuration pedals" ON configuration_pedals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM configurations c
      WHERE c.id = configuration_id
      AND c.user_id = auth.uid()
    )
  );

-- Configuration cables policies
CREATE POLICY "Access configuration cables through configuration" ON configuration_cables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM configurations c
      WHERE c.id = configuration_id
      AND (c.user_id = auth.uid() OR c.is_public = true)
    )
  );

CREATE POLICY "Users can manage their configuration cables" ON configuration_cables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM configurations c
      WHERE c.id = configuration_id
      AND c.user_id = auth.uid()
    )
  );

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_boards_updated_at
  BEFORE UPDATE ON boards
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pedals_updated_at
  BEFORE UPDATE ON pedals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configurations_updated_at
  BEFORE UPDATE ON configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
