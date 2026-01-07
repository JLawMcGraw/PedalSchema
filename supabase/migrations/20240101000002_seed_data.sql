-- PedalSchema Seed Data
-- Run this after 001_initial_schema.sql

-- ============================================
-- PEDALBOARDS (Pedaltrain models)
-- ============================================

-- Pedaltrain Nano
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Nano', 'Pedaltrain', 14, 5.5, 0.6, 1.75, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Nano' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 2.75, 2 FROM boards WHERE name = 'Nano' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Nano+
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Nano+', 'Pedaltrain', 18, 5, 0.6, 1.75, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Nano+' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 2.5, 2 FROM boards WHERE name = 'Nano+' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Metro 16
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Metro 16', 'Pedaltrain', 16, 8, 0.6, 2.5, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Metro 16' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.5, 2 FROM boards WHERE name = 'Metro 16' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Metro 20
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Metro 20', 'Pedaltrain', 20, 8, 0.6, 2.5, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Metro 20' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.5, 2 FROM boards WHERE name = 'Metro 20' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Classic Jr
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Classic Jr', 'Pedaltrain', 18, 12.5, 0.6, 3.5, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Classic Jr' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.1, 2 FROM boards WHERE name = 'Classic Jr' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 6.2, 3 FROM boards WHERE name = 'Classic Jr' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 9.3, 4 FROM boards WHERE name = 'Classic Jr' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Classic 1
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Classic 1', 'Pedaltrain', 22, 12.5, 0.6, 3.5, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Classic 1' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.1, 2 FROM boards WHERE name = 'Classic 1' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 6.2, 3 FROM boards WHERE name = 'Classic 1' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 9.3, 4 FROM boards WHERE name = 'Classic 1' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Classic 2
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Classic 2', 'Pedaltrain', 24, 12.5, 0.6, 3.5, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Classic 2' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.1, 2 FROM boards WHERE name = 'Classic 2' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 6.2, 3 FROM boards WHERE name = 'Classic 2' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 9.3, 4 FROM boards WHERE name = 'Classic 2' AND manufacturer = 'Pedaltrain';

-- Pedaltrain Classic Pro
INSERT INTO boards (name, manufacturer, width_inches, depth_inches, rail_width_inches, clearance_under_inches, is_system)
VALUES ('Classic Pro', 'Pedaltrain', 32, 16, 0.6, 4, true);

INSERT INTO board_rails (board_id, position_from_back_inches, sort_order)
SELECT id, 0, 1 FROM boards WHERE name = 'Classic Pro' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 3.75, 2 FROM boards WHERE name = 'Classic Pro' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 7.5, 3 FROM boards WHERE name = 'Classic Pro' AND manufacturer = 'Pedaltrain'
UNION ALL
SELECT id, 11.25, 4 FROM boards WHERE name = 'Classic Pro' AND manufacturer = 'Pedaltrain';

-- ============================================
-- PEDALS
-- ============================================

-- TUNERS
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('TU-3', 'BOSS', 'tuner', 2.9, 5.1, 2.4, 9, 85, 'center_negative', 10, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'TU-3' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'TU-3' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'TU-3' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Polytune 3', 'TC Electronic', 'tuner', 2.8, 4.4, 2.2, 9, 100, 'center_negative', 10, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Polytune 3' AND manufacturer = 'TC Electronic'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Polytune 3' AND manufacturer = 'TC Electronic'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Polytune 3' AND manufacturer = 'TC Electronic';

-- FILTERS (WAH)
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Cry Baby GCB95', 'Dunlop', 'filter', 4, 10, 3, 9, 1, 'center_negative', 20, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Cry Baby GCB95' AND manufacturer = 'Dunlop'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Cry Baby GCB95' AND manufacturer = 'Dunlop'
UNION ALL
SELECT id, 'power', 'left'::jack_side, 80, 'DC 9V' FROM pedals WHERE name = 'Cry Baby GCB95' AND manufacturer = 'Dunlop';

-- COMPRESSORS
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('CS-3', 'BOSS', 'compressor', 2.9, 5.1, 2.4, 9, 15, 'center_negative', 30, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'CS-3' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'CS-3' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'CS-3' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Dyna Comp', 'MXR', 'compressor', 2.4, 4.4, 2, 9, 2, 'center_negative', 30, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Dyna Comp' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Dyna Comp' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Dyna Comp' AND manufacturer = 'MXR';

-- OVERDRIVES
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('TS9 Tube Screamer', 'Ibanez', 'overdrive', 2.9, 5.1, 2.2, 9, 6, 'center_negative', 60, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'TS9 Tube Screamer' AND manufacturer = 'Ibanez'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'TS9 Tube Screamer' AND manufacturer = 'Ibanez'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'TS9 Tube Screamer' AND manufacturer = 'Ibanez';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('SD-1', 'BOSS', 'overdrive', 2.9, 5.1, 2.4, 9, 7, 'center_negative', 60, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'SD-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'SD-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'SD-1' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Klon Centaur', 'Klon', 'overdrive', 4.8, 5.5, 2.5, 9, 10, 'center_negative', 60, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Klon Centaur' AND manufacturer = 'Klon'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Klon Centaur' AND manufacturer = 'Klon'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Klon Centaur' AND manufacturer = 'Klon';

-- DISTORTION
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('DS-1', 'BOSS', 'distortion', 2.9, 5.1, 2.4, 9, 5, 'center_negative', 70, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'DS-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'DS-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'DS-1' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('RAT 2', 'Pro Co', 'distortion', 3.3, 5.6, 2, 9, 3, 'center_negative', 70, 'front_of_amp', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'RAT 2' AND manufacturer = 'Pro Co'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'RAT 2' AND manufacturer = 'Pro Co'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'RAT 2' AND manufacturer = 'Pro Co';

-- FUZZ
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, needs_direct_pickup, is_system)
VALUES ('Big Muff Pi', 'Electro-Harmonix', 'fuzz', 5.5, 7.3, 2.5, 9, 3, 'center_negative', 80, 'front_of_amp', false, true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Big Muff Pi' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Big Muff Pi' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Big Muff Pi' AND manufacturer = 'Electro-Harmonix';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, needs_direct_pickup, is_system)
VALUES ('Fuzz Face', 'Dunlop', 'fuzz', 5.5, 5.5, 2.5, 9, 1, 'center_negative', 80, 'front_of_amp', true, true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Fuzz Face' AND manufacturer = 'Dunlop'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Fuzz Face' AND manufacturer = 'Dunlop'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Fuzz Face' AND manufacturer = 'Dunlop';

-- NOISE GATE
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, supports_4_cable, is_system)
VALUES ('NS-2', 'BOSS', 'noise_gate', 2.9, 5.1, 2.4, 9, 20, 'center_negative', 90, 'front_of_amp', true, true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 75, 'INPUT' FROM pedals WHERE name = 'NS-2' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 75, 'OUTPUT' FROM pedals WHERE name = 'NS-2' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'send', 'right'::jack_side, 25, 'SEND' FROM pedals WHERE name = 'NS-2' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'return', 'left'::jack_side, 25, 'RETURN' FROM pedals WHERE name = 'NS-2' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'NS-2' AND manufacturer = 'BOSS';

-- MODULATION
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Small Clone', 'Electro-Harmonix', 'modulation', 3.5, 4.7, 2.1, 9, 7, 'center_negative', 110, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Small Clone' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Small Clone' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Small Clone' AND manufacturer = 'Electro-Harmonix';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('CE-2W', 'BOSS', 'modulation', 2.9, 5.1, 2.4, 9, 25, 'center_negative', 110, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'CE-2W' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'CE-2W' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'CE-2W' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Phase 90', 'MXR', 'modulation', 2.4, 4.4, 2, 9, 3, 'center_negative', 110, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Phase 90' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Phase 90' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Phase 90' AND manufacturer = 'MXR';

-- DELAY
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('DD-7', 'BOSS', 'delay', 2.9, 5.1, 2.4, 9, 55, 'center_negative', 130, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'DD-7' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'DD-7' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'DD-7' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Carbon Copy', 'MXR', 'delay', 2.4, 4.4, 2, 9, 25, 'center_negative', 130, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Carbon Copy' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Carbon Copy' AND manufacturer = 'MXR'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Carbon Copy' AND manufacturer = 'MXR';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Timeline', 'Strymon', 'delay', 6.5, 5.1, 1.6, 9, 300, 'center_negative', 130, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'top'::jack_side, 20, 'INPUT' FROM pedals WHERE name = 'Timeline' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'output', 'top'::jack_side, 40, 'OUTPUT' FROM pedals WHERE name = 'Timeline' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 80, 'DC 9V' FROM pedals WHERE name = 'Timeline' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'expression', 'top'::jack_side, 60, 'EXP' FROM pedals WHERE name = 'Timeline' AND manufacturer = 'Strymon';

-- REVERB
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('RV-6', 'BOSS', 'reverb', 2.9, 5.1, 2.4, 9, 75, 'center_negative', 140, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'RV-6' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'RV-6' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'RV-6' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Holy Grail', 'Electro-Harmonix', 'reverb', 3.5, 4.7, 2.1, 9, 50, 'center_negative', 140, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Holy Grail' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Holy Grail' AND manufacturer = 'Electro-Harmonix'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Holy Grail' AND manufacturer = 'Electro-Harmonix';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('BigSky', 'Strymon', 'reverb', 6.5, 5.1, 1.6, 9, 300, 'center_negative', 140, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'top'::jack_side, 20, 'INPUT' FROM pedals WHERE name = 'BigSky' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'output', 'top'::jack_side, 40, 'OUTPUT' FROM pedals WHERE name = 'BigSky' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 80, 'DC 9V' FROM pedals WHERE name = 'BigSky' AND manufacturer = 'Strymon'
UNION ALL
SELECT id, 'expression', 'top'::jack_side, 60, 'EXP' FROM pedals WHERE name = 'BigSky' AND manufacturer = 'Strymon';

-- LOOPER
INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('RC-1', 'BOSS', 'looper', 2.9, 5.1, 2.4, 9, 45, 'center_negative', 160, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'RC-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'RC-1' AND manufacturer = 'BOSS'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'RC-1' AND manufacturer = 'BOSS';

INSERT INTO pedals (name, manufacturer, category, width_inches, depth_inches, height_inches, voltage, current_ma, polarity, default_chain_position, preferred_location, is_system)
VALUES ('Ditto Looper', 'TC Electronic', 'looper', 1.8, 3.7, 2.2, 9, 100, 'center_negative', 160, 'effects_loop', true);

INSERT INTO pedal_jacks (pedal_id, jack_type, side, position_percent, label)
SELECT id, 'input', 'right'::jack_side, 50, 'INPUT' FROM pedals WHERE name = 'Ditto Looper' AND manufacturer = 'TC Electronic'
UNION ALL
SELECT id, 'output', 'left'::jack_side, 50, 'OUTPUT' FROM pedals WHERE name = 'Ditto Looper' AND manufacturer = 'TC Electronic'
UNION ALL
SELECT id, 'power', 'top'::jack_side, 50, 'DC 9V' FROM pedals WHERE name = 'Ditto Looper' AND manufacturer = 'TC Electronic';

-- ============================================
-- AMPLIFIERS
-- ============================================

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Blues Deluxe', 'Fender', true, 'series', 'instrument', 'PREAMP OUT', 'POWER AMP IN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Twin Reverb', 'Fender', false, 'none', NULL, NULL, NULL, true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Deluxe Reverb', 'Fender', false, 'none', NULL, NULL, NULL, true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('JCM800', 'Marshall', true, 'series', 'instrument', 'SEND', 'RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('JCM2000 DSL', 'Marshall', true, 'series', 'instrument', 'SEND', 'RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Plexi', 'Marshall', false, 'none', NULL, NULL, NULL, true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('AC30', 'Vox', true, 'series', 'instrument', 'SEND', 'RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('AC15', 'Vox', false, 'none', NULL, NULL, NULL, true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('5150', 'EVH', true, 'series', 'instrument', 'EFFECTS SEND', 'EFFECTS RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Mark V', 'Mesa/Boogie', true, 'switchable', 'line', 'FX SEND', 'FX RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Dual Rectifier', 'Mesa/Boogie', true, 'parallel', 'line', 'FX SEND', 'FX RETURN', true);

INSERT INTO amps (name, manufacturer, has_effects_loop, loop_type, loop_level, send_jack_label, return_jack_label, is_system)
VALUES ('Katana 100', 'BOSS', true, 'series', 'instrument', 'SEND', 'RETURN', true);
