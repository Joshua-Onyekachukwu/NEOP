#!/usr/bin/env python3
"""
Update polling_units coordinates via exec_sql in large batches.
Uses UPDATE ... FROM (VALUES ...) to avoid 1000-row REST limit.
"""
import json
import time
import urllib.request

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"

def exec_sql(query):
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    data = json.dumps({"query": query}).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return f"ERROR: {e}"

# Load coordinates
with open("data/pu-coordinates.json", "r") as f:
    coords = json.load(f)
coord_map = {c["pu_code"]: (c["latitude"], c["longitude"]) for c in coords}

print(f"Loaded {len(coord_map)} coordinate entries")

# Build VALUES for all PUs at once
# Use official_code as the join key
values = []
for code, (lat, lng) in coord_map.items():
    # Escape single quotes in code
    safe_code = code.replace("'", "''")
    values.append(f"('{safe_code}', {lat}, {lng})")

print(f"Built {len(values)} value tuples")

# Update in batches of 2000
batch_size = 2000
total = 0

for i in range(0, len(values), batch_size):
    batch = values[i:i+batch_size]
    
    values_str = ",\n".join(batch)
    
    query = f"""
    UPDATE polling_units 
    SET latitude = v.lat, longitude = v.lng
    FROM (VALUES {values_str}) AS v(code, lat, lng)
    WHERE polling_units.official_code = v.code
    """
    
    result = exec_sql(query)
    if result == "OK":
        total += len(batch)
    else:
        print(f"Error at batch {i}: {result}")
    
    if (i // batch_size) % 10 == 0:
        print(f"Progress: {i}/{len(values)} ({total} updated)")
    
    time.sleep(0.1)

print(f"\n=== COMPLETE ===")
print(f"Updated: {total}/{len(values)} PUs")
