#!/usr/bin/env python3
"""
Update polling_units table with generated coordinates.
Uses exec_sql for batch updates.
"""

import json
import time
import urllib.request
import urllib.parse

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"

# Load coordinates
print("Loading coordinates...")
with open("data/pu-coordinates.json", "r") as f:
    coords = json.load(f)

print(f"Loaded {len(coords)} coordinates")

# Build lookup by pu_code
coord_map = {c["pu_code"]: (c["latitude"], c["longitude"]) for c in coords}

# Fetch all PUs with their codes
print("Fetching PUs from Supabase...")
offset = 0
batch_size = 1000
all_pus = []

while True:
    url = f"{SUPABASE_URL}/rest/v1/polling_units?select=id,official_code&offset={offset}&limit={batch_size}"
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if not data:
                break
            all_pus.extend(data)
            offset += batch_size
            if len(data) < batch_size:
                break
    except Exception as e:
        print(f"Error at offset {offset}: {e}")
        break

print(f"Fetched {len(all_pus)} PUs")

# Prepare updates
updates = []
for pu in all_pus:
    code = pu.get("official_code", "")
    if code in coord_map:
        lat, lng = coord_map[code]
        updates.append({
            "id": pu["id"],
            "latitude": lat,
            "longitude": lng,
        })

print(f"Prepared {len(updates)} updates")

# Execute updates in batches via exec_sql
def exec_sql(query):
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    data = json.dumps({"query": query}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return f"ERROR: {e}"

# Update in batches of 50 PUs
batch_size = 50
success = 0
failed = 0

for i in range(0, len(updates), batch_size):
    batch = updates[i:i+batch_size]
    
    # Build CASE statement for batch update
    cases = []
    ids = []
    for u in batch:
        cases.append(f"WHEN id = '{u['id']}' THEN {u['latitude']}")
        ids.append(f"'{u['id']}'")
    
    if cases:
        query = f"""
        UPDATE polling_units 
        SET latitude = CASE 
            {' '.join(cases)} 
            ELSE latitude 
        END,
        longitude = CASE 
            {' '.join([f"WHEN id = '{u['id']}' THEN {u['longitude']}" for u in batch])} 
            ELSE longitude 
        END
        WHERE id IN ({', '.join(ids)})
        """
        
        result = exec_sql(query)
        if result == "OK":
            success += len(batch)
        else:
            failed += len(batch)
            if failed <= 3:
                print(f"Error: {result}")
        
        if (i // batch_size) % 20 == 0:
            print(f"Progress: {i}/{len(updates)} ({success} success, {failed} failed)")
        
        time.sleep(0.1)  # Rate limiting

print(f"\n=== COMPLETE ===")
print(f"Success: {success}")
print(f"Failed: {failed}")
print(f"Total: {len(updates)}")
