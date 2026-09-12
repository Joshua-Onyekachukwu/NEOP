#!/usr/bin/env python3
"""
Generate split SQL files directly from INEC CSV.
Each file is small enough for the Supabase SQL Editor.
"""

import csv
import uuid
import os
from collections import OrderedDict

INPUT_FILE = "data/inec_polling_units.csv"
OUTPUT_DIR = "supabase/migrations/inec_chunks"

# Clear and recreate output dir
if os.path.exists(OUTPUT_DIR):
    import shutil
    shutil.rmtree(OUTPUT_DIR)
os.makedirs(OUTPUT_DIR)

def title_case(s):
    if not s: return s
    return s.strip().title()

def esc(s):
    """Escape single quotes and remove non-ASCII for SQL."""
    # Remove non-ASCII characters that cause encoding issues
    s = ''.join(c for c in s if ord(c) < 128)
    return s.replace("'", "''")

# Read CSV
print("Reading INEC data...")
states = OrderedDict()
lgas = OrderedDict()
wards = OrderedDict()
pus = []

with open(INPUT_FILE, 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if len(row) < 9: continue
        state_name = row[1].strip().lower()
        lga_name = row[2].strip().lower()
        ward_name = row[3].strip().lower()
        state_code = row[4].strip()
        lga_code = row[5].strip()
        ward_code = row[6].strip()
        pu_code = row[8].strip()
        location = row[9].strip() if len(row) > 9 else ""

        if state_name not in states:
            states[state_name] = {"id": str(uuid.uuid4()), "name": title_case(state_name), "code": state_code}
        lga_key = (state_name, lga_name)
        if lga_key not in lgas:
            lgas[lga_key] = {"id": str(uuid.uuid4()), "name": title_case(lga_name), "code": f"{state_code}/{lga_code}", "state_id": states[state_name]["id"]}
        ward_key = (state_name, lga_name, ward_name)
        if ward_key not in wards:
            wards[ward_key] = {"id": str(uuid.uuid4()), "name": title_case(ward_name), "code": f"{state_code}/{lga_code}/{ward_code}", "lga_id": lgas[lga_key]["id"]}
        pus.append({"id": str(uuid.uuid4()), "name": esc(title_case(location) if location else f"PU {pu_code}"), "official_code": pu_code, "ward_id": wards[ward_key]["id"], "state_id": states[state_name]["id"], "lga_id": lgas[lga_key]["id"]})

print(f"States: {len(states)}, LGAs: {len(lgas)}, Wards: {len(wards)}, PUs: {len(pus)}")

# File 01: Setup (TRUNCATE) - no DISABLE TRIGGER (permission denied on system triggers)
with open(f"{OUTPUT_DIR}/01_setup.sql", 'w', encoding='utf-8') as f:
    f.write("""-- INEC Migration Step 1: Setup
-- Tables are already truncated via exec_sql TRUNCATE commands
-- This file is just a placeholder; run 02_states.sql next
SELECT 'Ready to load INEC data' AS result;
""")
print("01_setup.sql: placeholder (tables already truncated)")

# File 02: States
with open(f"{OUTPUT_DIR}/02_states.sql", 'w', encoding='utf-8') as f:
    f.write("-- INEC Migration Step 2: States (37 rows)\nINSERT INTO states (id, name, code) VALUES\n")
    vals = [f"('{s['id']}', '{esc(s['name'])}', '{s['code']}')" for s in states.values()]
    f.write(",\n".join(vals))
    f.write(";\nSELECT 'States inserted: ' || count(*) FROM states;\n")
print("02_states.sql: 37 states")

# File 03: LGAs (in batches of 400)
lga_list = list(lgas.values())
for i in range(0, len(lga_list), 400):
    batch = lga_list[i:i+400]
    chunk_num = i // 400 + 1
    with open(f"{OUTPUT_DIR}/03_lgas_{chunk_num:02d}.sql", 'w', encoding='utf-8') as f:
        f.write(f"-- INEC Migration Step 3: LGAs (batch {chunk_num}, {len(batch)} rows)\nINSERT INTO lgas (id, name, code, state_id) VALUES\n")
        vals = [f"('{l['id']}', '{esc(l['name'])}', '{l['code']}', '{l['state_id']}')" for l in batch]
        f.write(",\n".join(vals))
        f.write(";\n")
    print(f"03_lgas_{chunk_num:02d}.sql: {len(batch)} LGAs")

# File 04: Wards (in batches of 1500)
ward_list = list(wards.values())
for i in range(0, len(ward_list), 1500):
    batch = ward_list[i:i+1500]
    chunk_num = i // 1500 + 1
    with open(f"{OUTPUT_DIR}/04_wards_{chunk_num:02d}.sql", 'w', encoding='utf-8') as f:
        f.write(f"-- INEC Migration Step 4: Wards (batch {chunk_num}, {len(batch)} rows)\nINSERT INTO wards (id, name, code, lga_id) VALUES\n")
        vals = [f"('{w['id']}', '{esc(w['name'])}', '{w['code']}', '{w['lga_id']}')" for w in batch]
        f.write(",\n".join(vals))
        f.write(";\n")
    size_kb = os.path.getsize(f"{OUTPUT_DIR}/04_wards_{chunk_num:02d}.sql") // 1024
    print(f"04_wards_{chunk_num:02d}.sql: {len(batch)} wards ({size_kb} KB)")

# File 05: Polling Units (in batches of 500)
for i in range(0, len(pus), 2000):
    batch = pus[i:i+2000]
    chunk_num = i // 2000 + 1
    with open(f"{OUTPUT_DIR}/05_pus_{chunk_num:02d}.sql", 'w', encoding='utf-8') as f:
        f.write(f"-- INEC Migration Step 5: PUs (batch {chunk_num}, {len(batch)} rows)\nINSERT INTO polling_units (id, name, official_code, ward_id, state_id, lga_id, status) VALUES\n")
        vals = [f"('{p['id']}', '{p['name']}', '{p['official_code']}', '{p['ward_id']}', '{p['state_id']}', '{p['lga_id']}', 'NOT_STARTED')" for p in batch]
        f.write(",\n".join(vals))
        f.write(";\n")
    size_kb = os.path.getsize(f"{OUTPUT_DIR}/05_pus_{chunk_num:02d}.sql") // 1024
    print(f"05_pus_{chunk_num:02d}.sql: {len(batch)} PUs ({size_kb} KB)")

# File 06: Finish
with open(f"{OUTPUT_DIR}/06_finish.sql", 'w', encoding='utf-8') as f:
    f.write("""-- INEC Migration Step 6: Finish
CREATE INDEX IF NOT EXISTS idx_polling_units_state ON polling_units(state_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_lga ON polling_units(lga_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_ward ON polling_units(ward_id);
CREATE INDEX IF NOT EXISTS idx_polling_units_code ON polling_units(official_code);
CREATE INDEX IF NOT EXISTS idx_wards_lga ON wards(lga_id);
CREATE INDEX IF NOT EXISTS idx_lgas_state ON lgas(state_id);
SELECT 'States: ' || (SELECT count(*) FROM states) || ', LGAs: ' || (SELECT count(*) FROM lgas) || ', Wards: ' || (SELECT count(*) FROM wards) || ', PUs: ' || (SELECT count(*) FROM polling_units) AS result;
""")
print("06_finish.sql: indexes + verification")

# Manifest
files = sorted([f for f in os.listdir(OUTPUT_DIR) if f.endswith('.sql')])
with open(f"{OUTPUT_DIR}/MANIFEST.txt", 'w', encoding='utf-8') as f:
    f.write("INEC Data Migration — Run these files in order via Supabase SQL Editor\n")
    f.write("=" * 70 + "\n\n")
    for fn in files:
        size = os.path.getsize(f"{OUTPUT_DIR}/{fn}")
        f.write(f"  {fn:30s} {size//1024:4d} KB\n")
    f.write(f"\nTotal files: {len(files)}\n")
    f.write(f"Total PUs: {len(pus)}\n")
print(f"\n{len(files)} files generated in {OUTPUT_DIR}/")
print("Run each file in order via Supabase Dashboard SQL Editor")
