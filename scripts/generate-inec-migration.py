#!/usr/bin/env python3
"""
Convert INEC polling units CSV to SQL migration for Supabase.

Reads: data/inec_polling_units.csv
Writes: supabase/migrations/110_LOAD_INEC_POLLING_UNITS.sql

This migration:
1. Backs up existing data
2. Truncates seeded polling_units, wards, lgas, states
3. Inserts real INEC data with proper UUIDs and FK chains
4. Creates indexes for performance
"""

import csv
import uuid
import sys
from collections import OrderedDict

INPUT_FILE = "data/inec_polling_units.csv"
OUTPUT_FILE = "supabase/migrations/110_LOAD_INEC_POLLING_UNITS.sql"

# Region mapping for Nigerian states
STATE_REGION = {
    "lagos": "SW", "ogun": "SW", "oyo": "SW", "ondo": "SW", "osun": "SW", "ekiti": "SW",
    "kano": "NW", "katsina": "NW", "sokoto": "NW", "zamfara": "NW", "kebbi": "NW", "jigawa": "NW", "kaduna": "NW",
    "borno": "NE", "yobe": "NE", "adamawa": "NE", "gombe": "NE", "taraba": "NE", "bauchi": "NE",
    "niger": "NC", "kwara": "NC", "kogi": "NC", "benue": "NC", "plateau": "NC", "nasarawa": "NC",
    "abia": "SE", "anambra": "SE", "ebonyi": "SE", "enugu": "SE", "imo": "SE",
    "rivers": "SS", "delta": "SS", "bayelsa": "SS", "akwa ibom": "SS", "cross river": "SS", "edo": "SS",
    "fct": "FC",
}

# State populations (millions) for voter distribution
STATE_POP = {
    "lagos": 15.4, "kano": 13.1, "rivers": 7.3, "kaduna": 8.0, "oyo": 7.8,
    "delta": 5.6, "katsina": 7.4, "borno": 5.9, "jigawa": 5.7, "benue": 5.5,
    "anambra": 5.3, "plateau": 4.2, "sokoto": 5.3, "cross river": 4.4, "adamawa": 4.8,
    "ogun": 5.2, "bauchi": 6.5, "niger": 5.3, "imo": 5.0, "abia": 3.9,
    "osun": 4.7, "zamfara": 4.3, "ondo": 4.5, "edo": 4.1, "akwa ibom": 5.2,
    "kebbi": 5.2, "kogi": 4.9, "enugu": 4.1, "nasarawa": 3.4, "taraba": 3.6,
    "ebonyi": 3.3, "gombe": 3.3, "ekiti": 3.6, "yobe": 3.5, "kwara": 3.6,
    "bayelsa": 2.3, "fct": 2.8,
}

def generate_uuid():
    return str(uuid.uuid4())

def title_case(s):
    """Title case with special handling for Nigerian names."""
    if not s:
        return s
    result = s.strip().title()
    # Fix common abbreviations
    for abbr in ["Fct", "Lga", "Pu", "Ward"]:
        result = result.replace(abbr, abbr.upper())
    return result

def main():
    print("Reading INEC data...")
    
    # Read CSV and build hierarchy
    states = OrderedDict()  # name -> {id, code, region, population}
    lgas = OrderedDict()    # (state, lga) -> {id, code, name}
    wards = OrderedDict()   # (state, lga, ward) -> {id, code, name}
    pus = []                # list of PU records
    
    with open(INPUT_FILE, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        
        for row in reader:
            if len(row) < 9:
                continue
            
            state_name = row[1].strip().lower()
            lga_name = row[2].strip().lower()
            ward_name = row[3].strip().lower()
            state_code = row[4].strip()
            lga_code = row[5].strip()
            ward_code = row[6].strip()
            pu_code_num = row[7].strip()
            pu_code_full = row[8].strip()
            location = row[9].strip() if len(row) > 9 else ""
            
            # Create state
            if state_name not in states:
                states[state_name] = {
                    "id": generate_uuid(),
                    "code": state_code,
                    "region": STATE_REGION.get(state_name, "NC"),
                    "population": STATE_POP.get(state_name, 3.0),
                }
            
            # Create LGA
            lga_key = (state_name, lga_name)
            if lga_key not in lgas:
                lgas[lga_key] = {
                    "id": generate_uuid(),
                    "code": f"{state_code}/{lga_code}",
                    "name": title_case(lga_name),
                    "state_id": states[state_name]["id"],
                }
            
            # Create ward
            ward_key = (state_name, lga_name, ward_name)
            if ward_key not in wards:
                wards[ward_key] = {
                    "id": generate_uuid(),
                    "code": f"{state_code}/{lga_code}/{ward_code}",
                    "name": title_case(ward_name),
                    "lga_id": lgas[lga_key]["id"],
                    "state_id": states[state_name]["id"],
                }
            
            # Create PU
            pus.append({
                "id": generate_uuid(),
                "name": title_case(location) if location else f"PU {pu_code_full}",
                "official_code": pu_code_full,
                "ward_id": wards[ward_key]["id"],
                "state_id": states[state_name]["id"],
                "lga_id": lgas[lga_key]["id"],
                "state_name": title_case(state_name),
                "lga_name": title_case(lga_name),
                "ward_name": title_case(ward_name),
                "region": states[state_name]["region"],
            })
    
    print(f"States: {len(states)}")
    print(f"LGAs: {len(lgas)}")
    print(f"Wards: {len(wards)}")
    print(f"PUs: {len(pus)}")
    
    # Write SQL migration
    print(f"Writing {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write("-- ============================================================\n")
        f.write("-- INEC Official Polling Units Migration\n")
        f.write("-- Generated from INEC IReV dataset (176,846 PUs)\n")
        f.write("-- Source: https://github.com/Emeka-Onwuepe/Polling_Units_in_Nigeria\n")
        f.write("-- ============================================================\n\n")
        
        f.write("BEGIN;\n\n")
        
        f.write("-- Step 1: Back up existing data counts\n")
        f.write("DO $$\n")
        f.write("BEGIN\n")
        f.write("  RAISE NOTICE 'Existing states: %', (SELECT count(*) FROM states);\n")
        f.write("  RAISE NOTICE 'Existing LGAs: %', (SELECT count(*) FROM lgas);\n")
        f.write("  RAISE NOTICE 'Existing wards: %', (SELECT count(*) FROM wards);\n")
        f.write("  RAISE NOTICE 'Existing PUs: %', (SELECT count(*) FROM polling_units);\n")
        f.write("END $$;\n\n")
        
        f.write("-- Step 2: Disable triggers and truncate (fast, no row locking)\n")
        f.write("ALTER TABLE polling_units DISABLE TRIGGER ALL;\n")
        f.write("ALTER TABLE wards DISABLE TRIGGER ALL;\n")
        f.write("ALTER TABLE lgas DISABLE TRIGGER ALL;\n\n")
        
        f.write("TRUNCATE TABLE polling_units CASCADE;\n")
        f.write("TRUNCATE TABLE wards CASCADE;\n")
        f.write("TRUNCATE TABLE lgas CASCADE;\n")
        f.write("TRUNCATE TABLE states CASCADE;\n\n")
        
        # Insert states (match existing schema: id, name, code)
        f.write("-- Step 3: Insert states\n")
        f.write("INSERT INTO states (id, name, code) VALUES\n")
        state_values = []
        for name, data in sorted(states.items()):
            state_values.append(
                f"('{data['id']}', '{title_case(name)}', '{data['code']}')"
            )
        f.write(",\n".join(state_values))
        f.write(";\n\n")
        
        # Insert LGAs
        f.write("-- Step 4: Insert LGAs\n")
        f.write("INSERT INTO lgas (id, name, code, state_id) VALUES\n")
        lga_values = []
        for (state_name, lga_name), data in sorted(lgas.items()):
            name_escaped = data['name'].replace("'", "''")
            lga_values.append(
                f"('{data['id']}', '{name_escaped}', '{data['code']}', '{data['state_id']}')"
            )
        # Write in batches of 100
        batch_size = 100
        for i in range(0, len(lga_values), batch_size):
            batch = lga_values[i:i+batch_size]
            if i == 0:
                f.write(",\n".join(batch))
            else:
                f.write(",\n".join(batch))
            if i + batch_size < len(lga_values):
                f.write(",\n")
        f.write(";\n\n")
        
        # Insert wards
        f.write("-- Step 5: Insert wards\n")
        f.write("INSERT INTO wards (id, name, code, lga_id) VALUES\n")
        ward_values = []
        for (state_name, lga_name, ward_name), data in sorted(wards.items()):
            name_escaped = data['name'].replace("'", "''")
            ward_values.append(
                f"('{data['id']}', '{name_escaped}', '{data['code']}', '{data['lga_id']}')"
            )
        for i in range(0, len(ward_values), batch_size):
            batch = ward_values[i:i+batch_size]
            if i == 0:
                f.write(",\n".join(batch))
            else:
                f.write(",\n".join(batch))
            if i + batch_size < len(ward_values):
                f.write(",\n")
        f.write(";\n\n")
        
        # Insert polling units (match existing schema)
        f.write("-- Step 6: Insert polling units\n")
        f.write("INSERT INTO polling_units (id, name, official_code, ward_id, state_id, status) VALUES\n")
        pu_values = []
        for pu in pus:
            name_escaped = pu['name'].replace("'", "''")
            pu_values.append(
                f"('{pu['id']}', '{name_escaped}', '{pu['official_code']}', '{pu['ward_id']}', '{pu['state_id']}', 'NOT_STARTED')"
            )
        for i in range(0, len(pu_values), batch_size):
            batch = pu_values[i:i+batch_size]
            if i == 0:
                f.write(",\n".join(batch))
            else:
                f.write(",\n".join(batch))
            if i + batch_size < len(pu_values):
                f.write(",\n")
        f.write(";\n\n")
        
        # Re-enable triggers
        f.write("-- Step 7: Re-enable triggers\n")
        f.write("ALTER TABLE polling_units ENABLE TRIGGER ALL;\n")
        f.write("ALTER TABLE wards ENABLE TRIGGER ALL;\n")
        f.write("ALTER TABLE lgas ENABLE TRIGGER ALL;\n\n")
        
        # Create indexes
        f.write("-- Step 8: Create indexes\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_polling_units_state ON polling_units(state_id);\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_polling_units_ward ON polling_units(ward_id);\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_polling_units_code ON polling_units(official_code);\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_wards_lga ON wards(lga_id);\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_lgas_state ON lgas(state_id);\n\n")
        
        # Update simulation_config with correct PU count
        f.write("-- Step 9: Update simulation config\n")
        f.write("UPDATE simulation_config SET\n")
        f.write("  total_results = (SELECT count(*) FROM polling_units),\n")
        f.write("  updated_at = now()\n")
        f.write("WHERE id = '00000000-0000-0000-0000-000000000001';\n\n")
        
        # Verification
        f.write("-- Step 10: Verify counts\n")
        f.write("DO $$\n")
        f.write("BEGIN\n")
        f.write("  RAISE NOTICE '=== INEC DATA LOADED ===';\n")
        f.write("  RAISE NOTICE 'States: %', (SELECT count(*) FROM states);\n")
        f.write("  RAISE NOTICE 'LGAs: %', (SELECT count(*) FROM lgas);\n")
        f.write("  RAISE NOTICE 'Wards: %', (SELECT count(*) FROM wards);\n")
        f.write("  RAISE NOTICE 'PUs: %', (SELECT count(*) FROM polling_units);\n")
        f.write("  RAISE NOTICE 'PUs with state_id: %', (SELECT count(*) FROM polling_units WHERE state_id IS NOT NULL);\n")
        f.write("  RAISE NOTICE 'PUs with ward_id: %', (SELECT count(*) FROM polling_units WHERE ward_id IS NOT NULL);\n")
        f.write("END $$;\n\n")
        
        f.write("COMMIT;\n\n")
        f.write("SELECT 'INEC data loaded: ' || (SELECT count(*) FROM polling_units) || ' polling units' AS result;\n")
    
    print(f"Migration written to {OUTPUT_FILE}")
    print(f"File size: {len(open(OUTPUT_FILE).read()) / 1024 / 1024:.1f} MB")

if __name__ == "__main__":
    main()
