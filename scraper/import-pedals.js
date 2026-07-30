#!/usr/bin/env node
/**
 * Import scraped pedals into Supabase
 *
 * Usage: node import-pedals.js boss_pedals.json
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env from parent directory
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Map scraper pedal types to our PedalCategory
const categoryMap = {
  'distortion': 'distortion',
  'overdrive': 'overdrive',
  'fuzz': 'fuzz',
  'boost': 'boost',
  'preamp': 'boost',
  'compressor': 'compressor',
  'noise-gate': 'noise_gate',
  'eq': 'eq',
  'wah': 'filter',
  'volume': 'volume',
  'delay': 'delay',
  'reverb': 'reverb',
  'chorus': 'modulation',
  'flanger': 'modulation',
  'phaser': 'modulation',
  'tremolo': 'tremolo',
  'vibrato': 'modulation',
  'rotary': 'modulation',
  'pitch': 'pitch',
  'harmonizer': 'pitch',
  'octave': 'pitch',
  'synth': 'multi_fx',
  'looper': 'looper',
  'tuner': 'tuner',
  'buffer': 'utility',
  'switcher': 'utility',
  'multi-fx': 'multi_fx',
  'other': 'utility',
};

// Guess category from model name if not provided
function guessCategory(model, tagline) {
  const text = `${model} ${tagline || ''}`.toLowerCase();

  if (text.includes('tuner') || model.startsWith('TU-')) return 'tuner';
  if (text.includes('distortion') || model.startsWith('DS-') || model.startsWith('MT-') || model.startsWith('HM-')) return 'distortion';
  if (text.includes('overdrive') || model.startsWith('OD-') || model.startsWith('SD-') || model.startsWith('BD-')) return 'overdrive';
  if (text.includes('fuzz') || model.startsWith('FZ-')) return 'fuzz';
  if (text.includes('compressor') || model.startsWith('CS-') || model.startsWith('CP-')) return 'compressor';
  if (text.includes('delay') || model.startsWith('DD-') || model.startsWith('DM-') || model.startsWith('SDE-')) return 'delay';
  if (text.includes('reverb') || model.startsWith('RV-')) return 'reverb';
  if (text.includes('chorus') || model.startsWith('CE-') || model.startsWith('CH-')) return 'modulation';
  if (text.includes('flanger') || model.startsWith('BF-')) return 'modulation';
  if (text.includes('phaser') || model.startsWith('PH-')) return 'modulation';
  if (text.includes('tremolo') || model.startsWith('TR-')) return 'tremolo';
  if (text.includes('vibrato') || model.startsWith('VB-')) return 'modulation';
  if (text.includes('wah') || model.startsWith('AW-') || model.startsWith('PW-')) return 'filter';
  if (text.includes('octave') || model.startsWith('OC-')) return 'pitch';
  if (text.includes('pitch') || model.startsWith('PS-')) return 'pitch';
  if (text.includes('synth') || model.startsWith('SY-')) return 'multi_fx';
  if (text.includes('eq') || model.startsWith('GE-') || model.startsWith('EQ-')) return 'eq';
  if (text.includes('boost') || model.startsWith('BP-')) return 'boost';
  if (text.includes('looper') || model.startsWith('RC-')) return 'looper';
  if (text.includes('noise') || model.startsWith('NS-')) return 'noise_gate';
  if (text.includes('slicer') || model.startsWith('SL-')) return 'modulation';
  if (text.includes('rotary') || model.startsWith('RT-')) return 'modulation';
  if (text.includes('dimension') || model.startsWith('DC-')) return 'modulation';
  if (text.includes('modulation') || model.startsWith('MD-') || model.startsWith('MO-')) return 'modulation';
  if (text.includes('amp') || model.startsWith('IR-')) return 'utility';

  return 'utility';
}

// Transform scraped pedal to database format
function transformPedal(scraped) {
  const category = scraped.type
    ? (categoryMap[scraped.type] || guessCategory(scraped.model, scraped.tagline))
    : guessCategory(scraped.model, scraped.tagline);

  return {
    // Let Supabase generate UUID, we'll match on name+manufacturer for duplicates
    name: scraped.name || scraped.model,
    manufacturer: scraped.manufacturer,
    category: category,
    width_inches: scraped.dimensions?.width_in || (scraped.dimensions?.width_mm ? scraped.dimensions.width_mm / 25.4 : 2.9),
    depth_inches: scraped.dimensions?.depth_in || (scraped.dimensions?.depth_mm ? scraped.dimensions.depth_mm / 25.4 : 5.1),
    height_inches: scraped.dimensions?.height_mm ? scraped.dimensions.height_mm / 25.4 : 2.3,
    voltage: scraped.power?.voltage || 9,
    current_ma: scraped.power?.current_ma || null,
    polarity: scraped.power?.polarity === 'center-positive' ? 'center_positive' : 'center_negative',
    default_chain_position: null,
    preferred_location: 'flexible',
    supports_4_cable: false,
    needs_buffer_before: false,
    needs_direct_pickup: false,
    is_system: true,
    created_by: null,
    image_url: scraped.image_url || null,
    notes: scraped.tagline || null,
  };
}

async function importPedals(jsonFile) {
  console.log('Reading', jsonFile);

  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const pedals = data.pedals || data;

  console.log(`Found ${pedals.length} pedals to import`);

  // Transform all pedals
  const transformed = pedals.map(transformPedal);

  // Check which pedals already exist by name + manufacturer
  const { data: existing } = await supabase
    .from('pedals')
    .select('id, name, manufacturer')
    .eq('manufacturer', 'BOSS');

  const existingMap = new Map();
  (existing || []).forEach(p => {
    existingMap.set(`${p.manufacturer}|${p.name}`, p.id);
  });

  const newPedals = [];
  const updatePedals = [];

  for (const pedal of transformed) {
    const key = `${pedal.manufacturer}|${pedal.name}`;
    if (existingMap.has(key)) {
      updatePedals.push({ ...pedal, id: existingMap.get(key) });
    } else {
      newPedals.push(pedal);
    }
  }

  console.log(`${updatePedals.length} already exist, ${newPedals.length} new`);

  // Insert new pedals
  if (newPedals.length > 0) {
    console.log('\nInserting new pedals...');
    const { data: inserted, error } = await supabase
      .from('pedals')
      .insert(newPedals)
      .select();

    if (error) {
      console.error('Insert error:', error);
    } else {
      console.log(`Inserted ${inserted.length} pedals`);
    }
  }

  // Update existing pedals
  if (updatePedals.length > 0) {
    console.log('\nUpdating existing pedals...');
    let updateCount = 0;
    for (const pedal of updatePedals) {
      const id = pedal.id;
      delete pedal.id;  // Don't update the ID
      const { error } = await supabase
        .from('pedals')
        .update(pedal)
        .eq('id', id);

      if (error) {
        console.error(`Error updating ${pedal.name}:`, error.message);
      } else {
        updateCount++;
      }
    }
    console.log(`Updated ${updateCount} pedals`);
  }

  console.log('\nDone!');
}

// Run
const jsonFile = process.argv[2] || path.join(__dirname, '../boss_pedals.json');
importPedals(jsonFile).catch(console.error);
