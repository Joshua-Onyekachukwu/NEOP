#!/usr/bin/env python3
"""
Execute the INEC migration in chunks via the exec_sql function.
Prerequisites: Run 109_create_exec_sql.sql first in Supabase Dashboard.
"""

import requests
import time
import re
import sys

SUPABASE_URL = "https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"
MIGRATION_FILE = "supabase/migrations/110_LOAD_INEC_POLLING_UNITS.sql"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def exec_sql(sql_text):
    """Execute SQL via exec_sql function."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    try:
        resp = requests.post(url, json={"query": sql_text}, headers=HEADERS, timeout=120)
        if resp.status_code == 200:
            result = resp.text
            if "ERROR" in result:
                return False, result[:300]
            return True, result[:200]
        else:
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return False, str(e)[:200]

def split_sql(sql_content):
    """Split SQL into chunks that can be executed individually."""
    # Remove comments and blank lines for size estimation
    chunks = []
    current_chunk = ""
    
    # Split on semicolons that end statements
    lines = sql_content.split('\n')
    
    for line in lines:
        stripped = line.strip()
        
        # Skip comments
        if stripped.startswith('--'):
            continue
        
        current_chunk += line + '\n'
        
        # If chunk is getting large (500KB), split here
        if len(current_chunk.encode('utf-8')) > 500_000:
            # Find a good break point (end of a VALUES list)
            if ');' in current_chunk:
                # Split at the last ');'
                parts = current_chunk.rsplit(');', 1)
                if len(parts) == 2:
                    chunks.append(parts[0] + ');')
                    current_chunk = parts[1]
                else:
                    chunks.append(current_chunk)
                    current_chunk = ""
            elif 'INSERT INTO' in current_chunk:
                # We're in the middle of an INSERT - need to be smarter
                # Find all complete value tuples
                chunks.append(current_chunk)
                current_chunk = ""
            else:
                chunks.append(current_chunk)
                current_chunk = ""
    
    if current_chunk.strip():
        chunks.append(current_chunk)
    
    return chunks

def main():
    print(f"Reading {MIGRATION_FILE}...")
    with open(MIGRATION_FILE, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print(f"SQL size: {len(sql):,} bytes ({len(sql)//1024} KB)")
    
    # First, check if exec_sql function exists
    print("\nChecking exec_sql function...")
    ok, msg = exec_sql("SELECT 1 as test")
    if not ok:
        print(f"ERROR: exec_sql function not found or not working: {msg}")
        print("\nPlease run this SQL first in the Supabase Dashboard SQL Editor:")
        print("  File: supabase/migrations/109_create_exec_sql.sql")
        print("  (It's only ~15 lines, well under the size limit)")
        return False
    
    print(f"exec_sql works: {msg}")
    
    # Extract individual statements from the SQL
    # The migration has these sections:
    # 1. BEGIN
    # 2. DO blocks (logging)
    # 3. ALTER TABLE ... DISABLE TRIGGER ALL
    # 4. TRUNCATE statements
    # 5. INSERT INTO states (small - 37 rows)
    # 6. INSERT INTO lgas (774 rows)
    # 7. INSERT INTO wards (8,793 rows)
    # 8. INSERT INTO polling_units (176,846 rows - THE BIG ONE)
    # 9. ALTER TABLE ... ENABLE TRIGGER ALL
    # 10. CREATE INDEX statements
    # 11. UPDATE simulation_config
    # 12. DO block (verification)
    # 13. COMMIT
    # 14. Final SELECT
    
    # Strategy: Execute the small parts directly, split the large INSERTs
    
    print("\n=== Executing migration in chunks ===\n")
    
    # Extract the polling_units INSERT (the largest part)
    pu_insert_match = re.search(
        r'(INSERT INTO polling_units.*?;)',
        sql,
        re.DOTALL
    )
    
    if pu_insert_match:
        pu_insert = pu_insert_match.group(1)
        print(f"Polling units INSERT: {len(pu_insert):,} bytes")
        
        # Extract all VALUES tuples
        values_start = pu_insert.find('VALUES\n')
        if values_start == -1:
            values_start = pu_insert.find('VALUES ')
        
        header = pu_insert[:values_start + 7]  # "INSERT INTO polling_units (...) VALUES\n"
        values_str = pu_insert[values_start + 7:]
        
        # Parse individual value tuples
        tuples = re.findall(r"\('[^']+', '[^']+', '[^']+', '[^']+', '[^']+', '[^']+'\)", values_str)
        print(f"Found {len(tuples):,} PU value tuples")
        
        # Insert in batches of 1000
        batch_size = 1000
        total_batches = (len(tuples) + batch_size - 1) // batch_size
        
        for batch_idx in range(0, len(tuples), batch_size):
            batch = tuples[batch_idx:batch_idx + batch_size]
            batch_num = batch_idx // batch_size + 1
            
            batch_sql = header + ",\n".join(batch) + ";"
            
            print(f"  [{batch_num}/{total_batches}] Inserting {len(batch)} PUs...", end=" ", flush=True)
            ok, msg = exec_sql(batch_sql)
            
            if ok:
                print(f"OK")
            else:
                print(f"FAILED: {msg[:100]}")
                # Try smaller batch
                if batch_size > 100:
                    print(f"    Retrying with batch_size=100...")
                    for sub_idx in range(0, len(batch), 100):
                        sub_batch = batch[sub_idx:sub_idx + 100]
                        sub_sql = header + ",\n".join(sub_batch) + ";"
                        ok2, msg2 = exec_sql(sub_sql)
                        if not ok2:
                            print(f"      Sub-batch failed: {msg2[:100]}")
            
            time.sleep(0.2)
        
        print(f"\n  Polling units complete!")
    
    # Now execute the rest of the migration (without the PU INSERT)
    print("\n=== Executing remaining statements ===")
    
    # Remove the large PU INSERT from the SQL
    remaining_sql = sql
    if pu_insert_match:
        remaining_sql = sql.replace(pu_insert, "-- PU INSERT ALREADY DONE")
    
    # Split into individual statements
    statements = []
    current = ""
    for line in remaining_sql.split('\n'):
        stripped = line.strip()
        if stripped.startswith('--'):
            continue
        current += line + '\n'
        if stripped.endswith(';') and len(current) > 10:
            statements.append(current.strip())
            current = ""
    
    if current.strip():
        statements.append(current.strip())
    
    print(f"  Found {len(statements)} remaining statements")
    
    for i, stmt in enumerate(statements):
        # Skip very small statements
        if len(stmt) < 20:
            continue
        
        # Skip comments-only statements
        lines = [l for l in stmt.split('\n') if not l.strip().startswith('--') and l.strip()]
        if not lines:
            continue
        
        print(f"  [{i+1}/{len(statements)}] {stmt[:60].replace(chr(10), ' ')}...", end=" ", flush=True)
        ok, msg = exec_sql(stmt)
        if ok:
            print(f"OK")
        else:
            print(f"FAILED: {msg[:100]}")
    
    print("\n=== Verifying ===")
    ok, msg = exec_sql("SELECT count(*) FROM polling_units;")
    print(f"  Polling units: {msg}")
    
    ok, msg = exec_sql("SELECT count(*) FROM wards;")
    print(f"  Wards: {msg}")
    
    ok, msg = exec_sql("SELECT count(*) FROM lgas;")
    print(f"  LGAs: {msg}")
    
    ok, msg = exec_sql("SELECT count(*) FROM states;")
    print(f"  States: {msg}")
    
    print("\n=== DONE ===")
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
