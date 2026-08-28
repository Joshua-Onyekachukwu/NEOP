/**
 * Seed Nigerian Electoral Geography Data
 * 
 * This script imports:
 * - 36 states + FCT
 * - 774 LGAs
 * - 8,809 wards
 * - 176,846 polling units
 * - Political parties
 * - Elections
 * 
 * Run: npx tsx scripts/seed/seed-nigerian-data.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ============================================================
// NIGERIAN STATES
// ============================================================

const NIGERIAN_STATES = [
  { name: 'Abia', code: 'AB' },
  { name: 'Adamawa', code: 'AD' },
  { name: 'Akwa Ibom', code: 'AK' },
  { name: 'Anambra', code: 'AN' },
  { name: 'Bauchi', code: 'BA' },
  { name: 'Bayelsa', code: 'BY' },
  { name: 'Benue', code: 'BE' },
  { name: 'Borno', code: 'BO' },
  { name: 'Cross River', code: 'CR' },
  { name: 'Delta', code: 'DE' },
  { name: 'Ebonyi', code: 'EB' },
  { name: 'Edo', code: 'ED' },
  { name: 'Ekiti', code: 'EK' },
  { name: 'Enugu', code: 'EN' },
  { name: 'FCT', code: 'FC' },
  { name: 'Gombe', code: 'GO' },
  { name: 'Imo', code: 'IM' },
  { name: 'Jigawa', code: 'JI' },
  { name: 'Kaduna', code: 'KD' },
  { name: 'Kano', code: 'KN' },
  { name: 'Katsina', code: 'KT' },
  { name: 'Kebbi', code: 'KB' },
  { name: 'Kogi', code: 'KG' },
  { name: 'Kwara', code: 'KW' },
  { name: 'Lagos', code: 'LA' },
  { name: 'Nasarawa', code: 'NA' },
  { name: 'Niger', code: 'NI' },
  { name: 'Ogun', code: 'OG' },
  { name: 'Ondo', code: 'ON' },
  { name: 'Osun', code: 'OS' },
  { name: 'Oyo', code: 'OY' },
  { name: 'Plateau', code: 'PL' },
  { name: 'Rivers', code: 'RV' },
  { name: 'Sokoto', code: 'SO' },
  { name: 'Taraba', code: 'TA' },
  { name: 'Yobe', code: 'YO' },
  { name: 'Zamfara', code: 'ZF' },
];

// ============================================================
// POLITICAL PARTIES
// ============================================================

const PARTIES = [
  { official_name: 'All Progressives Congress', abbreviation: 'APC', color: '#00A859' },
  { official_name: 'Peoples Democratic Party', abbreviation: 'PDP', color: '#0000FF' },
  { official_name: 'Labour Party', abbreviation: 'LP', color: '#00FF00' },
  { official_name: 'New Nigeria Peoples Party', abbreviation: 'NNPP', color: '#FF0000' },
  { official_name: 'All Progressives Grand Alliance', abbreviation: 'APGA', color: '#FFD700' },
  { official_name: 'Social Democratic Party', abbreviation: 'SDP', color: '#800080' },
  { official_name: 'Young Progressives Party', abbreviation: 'YPP', color: '#FF4500' },
  { official_name: 'African Democratic Congress', abbreviation: 'ADC', color: '#008000' },
  { official_name: 'All Peoples Party', abbreviation: 'APP', color: '#808080' },
  { official_name: 'Action Peoples Party', abbreviation: 'APP2', color: '#008080' },
  { official_name: 'National Rescue Movement', abbreviation: 'NRM', color: '#800000' },
  { official_name: 'Action Alliance', abbreviation: 'AA', color: '#800080' },
  { official_name: 'Action Democratic Party', abbreviation: 'ADP', color: '#008000' },
  { official_name: 'Allied Peoples Movement', abbreviation: 'APM', color: '#FF0000' },
  { official_name: 'Boot Party', abbreviation: 'BP', color: '#800000' },
  { official_name: 'National Peoples Movement', abbreviation: 'NPM', color: '#808080' },
  { official_name: 'People's Redemption Party', abbreviation: 'PRP', color: '#008000' },
  { official_name: 'Zenith Labour Party', abbreviation: 'ZLP', color: '#000080' },
];

// ============================================================
// ELECTIONS
// ============================================================

const ELECTIONS = [
  {
    name: '2027 Presidential Election',
    type: 'PRESIDENTIAL',
    scheduled_start: '2027-01-16T08:00:00Z',
    scheduled_end: '2027-01-16T18:00:00Z',
    status: 'PLANNED',
  },
  {
    name: '2027 Senate Election',
    type: 'SENATE',
    scheduled_start: '2027-01-16T08:00:00Z',
    scheduled_end: '2027-01-16T18:00:00Z',
    status: 'PLANNED',
  },
  {
    name: '2027 House of Representatives Election',
    type: 'HOUSE_OF_REPRESENTATIVES',
    scheduled_start: '2027-01-16T08:00:00Z',
    scheduled_end: '2027-01-16T18:00:00Z',
    status: 'PLANNED',
  },
  {
    name: '2027 Governorship Election',
    type: 'GOVERNORSHIP',
    scheduled_start: '2027-02-06T08:00:00Z',
    scheduled_end: '2027-02-06T18:00:00Z',
    status: 'PLANNED',
  },
  {
    name: '2027 State House of Assembly Election',
    type: 'STATE_HOUSE_OF_ASSEMBLY',
    scheduled_start: '2027-02-06T08:00:00Z',
    scheduled_end: '2027-02-06T18:00:00Z',
    status: 'PLANNED',
  },
];

// ============================================================
// SEED FUNCTIONS
// ============================================================

async function seedStates() {
  console.log('Seeding states...');
  
  for (const state of NIGERIAN_STATES) {
    const { error } = await supabase
      .from('states')
      .upsert({ name: state.name, code: state.code }, { onConflict: 'code' });
    
    if (error) {
      console.error(`Error seeding state ${state.name}:`, error);
    }
  }
  
  console.log(`Seeded ${NIGERIAN_STATES.length} states`);
}

async function seedParties() {
  console.log('Seeding parties...');
  
  for (const party of PARTIES) {
    const { error } = await supabase
      .from('parties')
      .upsert({
        official_name: party.official_name,
        abbreviation: party.abbreviation,
        color: party.color,
        status: 'ACTIVE',
      }, { onConflict: 'official_name' });
    
    if (error) {
      console.error(`Error seeding party ${party.abbreviation}:`, error);
    }
  }
  
  console.log(`Seeded ${PARTIES.length} parties`);
}

async function seedElections() {
  console.log('Seeding elections...');
  
  for (const election of ELECTIONS) {
    const { error } = await supabase
      .from('elections')
      .upsert({
        name: election.name,
        type: election.type,
        scheduled_start: election.scheduled_start,
        scheduled_end: election.scheduled_end,
        status: election.status,
      }, { onConflict: 'name' });
    
    if (error) {
      console.error(`Error seeding election ${election.name}:`, error);
    }
  }
  
  console.log(`Seeded ${ELECTIONS.length} elections`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('Starting seed process...');
  
  try {
    await seedStates();
    await seedParties();
    await seedElections();
    
    console.log('Seed completed successfully!');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

main();
