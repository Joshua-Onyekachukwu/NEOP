#!/usr/bin/env python3
"""
Load INEC data directly via Supabase REST API.
Handles 176,846 PUs with proper batching and error recovery.
"""

import csv
import uuid
import requests
import time
import sys
import json
from collections import OrderedDict

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"
INPUT_FILE = "data/inec_polling_units.csv"
PROGRESS_FILE = "/tmp/inec-load-progress.json"

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

def batch_upsert(table, records, batch_size=500, id_field="id"):
    """Insert records in batches with retry."""
    total = len(records)
    inserted = 0
    failed = 0
    
    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        
        for attempt in range(3):
            try:
                resp = requests.post(url, json=batch, headers=HEADERS, timeout=60)
                
                if resp.status_code in (200, 201, 204):
                    inserted += len(batch)
                    break
                elif resp.status_code == 409:
                    # Conflict - try upsert
                    resp2 = requests.post(
                        url + "?on_conflict=" + id_field,
                        json=batch,
                        headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
                        timeout=60
                    )
                    if resp2.status_code in (200, 201, 204):
                        inserted += len(batch)
                        break
                    else:
                        print(f"\n    Upsert failed: {resp2.status_code} {resp2.text[:100]}")
                elif resp.status_code == 400 and "duplicate" in resp.text.lower():
                    # Skip duplicates
                    inserted += len(batch)
                    break
                else:
                    if attempt < 2:
                        time.sleep(1)
                    else:
                        print(f"\n    Batch failed at offset {i}: HTTP {resp.status_code}")
                        print(f"    {resp.text[:200]}")
                        failed += len(batch)
            except requests.exceptions.Timeout:
                if attempt < 2:
                    time.sleep(2)
                else:
                    failed += len(batch)
            except Exception as e:
                if attempt < 2:
                    time.sleep(1)
                else:
                    print(f"\n    Error at offset {i}: {str(e)[:100]}")
                    failed += len(batch)
        
        pct = (inserted + failed) / total * 100
        print(f"\r  [{table}] {inserted}/{total} ({pct:.0f}%) failed:{failed}", end="", flush=True)
        
        time.sleep(0.05)  # Rate limiting
    
    print(f"\n  [{table}] Done: {inserted} inserted, {failed} failed")
    return inserted, failed

def main():
    # Load progress if resuming
    progress = {}
    try:
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)
    except:
        pass
    
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
                states[state_name] = {"id": str(uuid.uuid4()), "name": title_case(state_name), "code": state_code}
            
            lga_key = (state_name, lga_name)
            if lga_key not in lgas:
                lgas[lga_key] = {"id": str(uuid.uuid4()), "name": title_case(lga_name), "code": f"{state_code}/{lga_code}", "state_id": states[state_name]["id"]}
            
            ward_key = (state_name, lga_name, ward_name)
            if ward_key not in wards:
                wards[ward_key] = {"id": str(uuid.uuid4()), "name": title_case(ward_name), "code": f"{state_code}/{lga_code}/{ward_code}", "lga_id": lgas[lga_key]["id"]}
            
            pus.append({
                "id": str(uuid.uuid4()),
                "name": title_case(location) if location else f"PU {pu_code_full}",
                "official_code": pu_code_full,
                "ward_id": wards[ward_key]["id"],
                "state_id": states[state_name]["id"],
                "status": "NOT_STARTED",
            })
    
    print(f"States: {len(states)}, LGAs: {len(lgas)}, Wards: {len(wards)}, PUs: {len(pus)}")
    
    # Step 1: Clear existing data
    if progress.get("step") is None:
        print("\n=== Step 1: Clear existing data ===")
        for table in ["polling_units", "wards", "lgas", "states"]:
            # Delete in batches
            while True:
                url = f"{SUPABASE_URL}/rest/v1/{table}?id=not.is.null&limit=10000"
                resp = requests.delete(url, headers=HEADERS, timeout=60)
                if resp.status_code in (200, 204):
                    print(f"  Deleted batch from {table}: HTTP {resp.status_code}")
                    # Check if more rows exist
                    check = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?select=id&limit=1", headers=HEADERS, timeout=10)
                    if check.status_code == 200 and len(check.json()) > 0:
                        continue
                    else:
                        break
                else:
                    print(f"  Delete from {table}: HTTP {resp.status_code} {resp.text[:100]}")
                    break
        progress["step"] = "cleared"
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f)
    
    # Step 2: Insert states
    if progress.get("step") == "cleared":
        print("\n=== Step 2: Insert states ===")
        batch_upsert("states", list(states.values()), batch_size=50)
        progress["step"] = "states"
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f)
    
    # Step 3: Insert LGAs
    if progress.get("step") == "states":
        print("\n=== Step 3: Insert LGAs ===")
        batch_upsert("lgas", list(lgas.values()), batch_size=200)
        progress["step"] = "lgas"
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f)
    
    # Step 4: Insert wards
    if progress.get("step") == "lgas":
        print("\n=== Step 4: Insert wards ===")
        batch_upsert("wards", list(wards.values()), batch_size=500)
        progress["step"] = "wards"
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f)
    
    # Step 5: Insert polling units
    if progress.get("step") == "wards":
        print("\n=== Step 5: Insert polling units ===")
        batch_upsert("polling_units", pus, batch_size=500)
        progress["step"] = "pus"
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress, f)
    
    # Step 6: Verify
    print("\n=== Step 6: Verify ===")
    for table in ["states", "lgas", "wards", "polling_units"]:
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=id"
        resp = requests.get(url, headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"}, timeout=10)
        cr = resp.headers.get("content-range", "?")
        print(f"  {table}: {cr}")
    
    print("\n=== DONE ===")

if __name__ == "__main__":
    main()
