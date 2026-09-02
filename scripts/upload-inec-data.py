#!/usr/bin/env python3
"""
Upload INEC polling unit data to Supabase via REST API.
No exec_sql function needed — uses standard PostgREST inserts.

This script:
1. Reads the INEC CSV
2. Uploads states, LGAs, wards, PUs via batch REST inserts
3. Handles the hierarchy correctly
"""

import csv
import uuid
import requests
import time
import sys
from collections import OrderedDict

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"
INPUT_FILE = "data/inec_polling_units.csv"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

def title_case(s):
    if not s:
        return s
    return s.strip().title()

def batch_insert(table, records, batch_size=500):
    """Insert records in batches via PostgREST."""
    total = len(records)
    inserted = 0
    
    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        
        resp = requests.post(url, json=batch, headers=HEADERS, timeout=60)
        
        if resp.status_code in (200, 201):
            inserted += len(batch)
            pct = (inserted / total) * 100
            print(f"  [{table}] {inserted}/{total} ({pct:.0f}%)", end="\r")
        else:
            print(f"\n  [{table}] ERROR at offset {i}: HTTP {resp.status_code}")
            print(f"    {resp.text[:200]}")
            # Try smaller batches
            if batch_size > 100:
                print(f"    Retrying with batch_size=100...")
                batch_insert(table, batch, batch_size=100)
                inserted += len(batch)
            else:
                print(f"    SKIPPING batch")
        
        time.sleep(0.1)  # Rate limiting
    
    print(f"\n  [{table}] Done: {inserted}/{total}")
    return inserted

def main():
    print("Reading INEC data...")
    
    states = OrderedDict()
    lgas = OrderedDict()
    wards = OrderedDict()
    pus = []
    
    with open(INPUT_FILE, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        next(reader)
        
        for row in reader:
            if len(row) < 9:
                continue
            
            state_name = row[1].strip().lower()
            lga_name = row[2].strip().lower()
            ward_name = row[3].strip().lower()
            state_code = row[4].strip()
            lga_code = row[5].strip()
            ward_code = row[6].strip()
            pu_code_full = row[8].strip()
            location = row[9].strip() if len(row) > 9 else ""
            
            if state_name not in states:
                states[state_name] = {
                    "id": str(uuid.uuid4()),
                    "name": title_case(state_name),
                    "code": state_code,
                }
            
            lga_key = (state_name, lga_name)
            if lga_key not in lgas:
                lgas[lga_key] = {
                    "id": str(uuid.uuid4()),
                    "name": title_case(lga_name),
                    "code": f"{state_code}/{lga_code}",
                    "state_id": states[state_name]["id"],
                }
            
            ward_key = (state_name, lga_name, ward_name)
            if ward_key not in wards:
                wards[ward_key] = {
                    "id": str(uuid.uuid4()),
                    "name": title_case(ward_name),
                    "code": f"{state_code}/{lga_code}/{ward_code}",
                    "lga_id": lgas[lga_key]["id"],
                }
            
            pus.append({
                "id": str(uuid.uuid4()),
                "name": title_case(location) if location else f"PU {pu_code_full}",
                "official_code": pu_code_full,
                "ward_id": wards[ward_key]["id"],
                "state_id": states[state_name]["id"],
                "status": "NOT_STARTED",
            })
    
    print(f"States: {len(states)}")
    print(f"LGAs: {len(lgas)}")
    print(f"Wards: {len(wards)}")
    print(f"PUs: {len(pus)}")
    
    # Step 1: Clear existing data
    print("\n=== Step 1: Clearing existing data ===")
    for table in ["polling_units", "wards", "lgas", "states"]:
        url = f"{SUPABASE_URL}/rest/v1/{table}?id=not.is.null"
        resp = requests.delete(url, headers=HEADERS, timeout=30)
        print(f"  Cleared {table}: HTTP {resp.status_code}")
    
    # Step 2: Insert states
    print("\n=== Step 2: Inserting states ===")
    state_records = list(states.values())
    batch_insert("states", state_records)
    
    # Step 3: Insert LGAs
    print("\n=== Step 3: Inserting LGAs ===")
    lga_records = list(lgas.values())
    batch_insert("lgas", lga_records, batch_size=1000)
    
    # Step 4: Insert wards
    print("\n=== Step 4: Inserting wards ===")
    ward_records = list(wards.values())
    batch_insert("wards", ward_records, batch_size=1000)
    
    # Step 5: Insert polling units
    print("\n=== Step 5: Inserting polling units ===")
    batch_insert("polling_units", pus, batch_size=500)
    
    # Step 6: Verify
    print("\n=== Step 6: Verifying ===")
    for table in ["states", "lgas", "wards", "polling_units"]:
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=id"
        resp = requests.get(url, headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"}, timeout=10)
        content_range = resp.headers.get("content-range", "?")
        print(f"  {table}: {content_range}")
    
    print("\n=== DONE ===")

if __name__ == "__main__":
    main()
