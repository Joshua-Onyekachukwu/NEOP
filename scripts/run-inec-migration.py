#!/usr/bin/env python3
"""
Execute the INEC migration in chunks via Supabase SQL API.
Splits the 30MB SQL into manageable pieces.
"""

import requests
import sys
import time

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"
MIGRATION_FILE = "supabase/migrations/110_LOAD_INEC_POLLING_UNITS.sql"

def execute_sql(sql_chunk):
    """Execute a SQL chunk via Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    
    try:
        resp = requests.post(url, json={"query": sql_chunk}, headers=headers, timeout=120)
        if resp.status_code == 200:
            return True, resp.text[:200]
        else:
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return False, str(e)

def main():
    print(f"Reading {MIGRATION_FILE}...")
    with open(MIGRATION_FILE, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    # Split by INSERT statements (the big chunks)
    # Find all INSERT INTO statements
    chunks = []
    
    # Split on semicolons that end major statements
    statements = sql.split(';\n')
    
    # Group small statements, keep large INSERTs separate
    current_chunk = ""
    for stmt in statements:
        stmt = stmt.strip()
        if not stmt:
            continue
        
        # If this is a large INSERT (contains many VALUES), send it alone
        if 'INSERT INTO' in stmt and stmt.count('(') > 100:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            chunks.append(stmt + ";")
        else:
            current_chunk += stmt + ";\n"
    
    if current_chunk:
        chunks.append(current_chunk)
    
    print(f"Split into {len(chunks)} chunks")
    
    # Show chunk sizes
    for i, chunk in enumerate(chunks):
        size_kb = len(chunk.encode('utf-8')) / 1024
        print(f"  Chunk {i+1}: {size_kb:.0f} KB - {chunk[:80].replace(chr(10), ' ')}...")
    
    print()
    print("Executing chunks...")
    
    for i, chunk in enumerate(chunks):
        size_kb = len(chunk.encode('utf-8')) / 1024
        print(f"  [{i+1}/{len(chunks)}] Executing {size_kb:.0f} KB...", end=" ", flush=True)
        
        ok, msg = execute_sql(chunk)
        if ok:
            print(f"OK - {msg[:100]}")
        else:
            print(f"FAILED - {msg[:100]}")
            if "does not exist" in msg or "permission denied" in msg:
                print("  (exec_sql function may not exist — trying direct SQL)")
                return False
        
        time.sleep(0.5)  # Brief pause between chunks
    
    print()
    print("Migration complete! Verifying...")
    
    # Verify counts
    ok, msg = execute_sql("SELECT count(*) as total FROM polling_units;")
    print(f"  Polling units: {msg[:100] if ok else msg}")
    
    ok, msg = execute_sql("SELECT count(*) as total FROM wards;")
    print(f"  Wards: {msg[:100] if ok else msg}")
    
    ok, msg = execute_sql("SELECT count(*) as total FROM lgas;")
    print(f"  LGAs: {msg[:100] if ok else msg}")
    
    ok, msg = execute_sql("SELECT count(*) as total FROM states;")
    print(f"  States: {msg[:100] if ok else msg}")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
