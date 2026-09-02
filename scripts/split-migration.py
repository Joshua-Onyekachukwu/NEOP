#!/usr/bin/env python3
"""
Split the INEC migration into smaller files that fit in the SQL Editor.
Each file handles one table.
"""

import re
import os

INPUT_FILE = "supabase/migrations/110_LOAD_INEC_POLLING_UNITS.sql"
OUTPUT_DIR = "supabase/migrations/inec_chunks"

def split_by_insert(sql):
    """Split SQL into sections by INSERT statement."""
    sections = []
    current = ""
    
    for line in sql.split('\n'):
        current += line + '\n'
        
        # Check for major section breaks
        if line.strip().startswith('-- Step'):
            if current.strip() and not current.strip().startswith('-- Step'):
                sections.append(current)
            current = line + '\n'
    
    if current.strip():
        sections.append(current)
    
    return sections

def extract_insert_values(insert_sql):
    """Extract VALUES from an INSERT statement."""
    values_start = insert_sql.find('VALUES\n')
    if values_start == -1:
        values_start = insert_sql.find('VALUES ')
    
    header = insert_sql[:values_start + 7]
    values_str = insert_sql[values_start + 7:]
    
    # Parse tuples - handle different column counts
    # States: 3 columns (id, name, code)
    # LGAs: 4 columns (id, name, code, state_id)
    # Wards: 4 columns (id, name, code, lga_id)
    # PUs: 6 columns (id, name, official_code, ward_id, state_id, status)
    
    # Generic tuple parser
    tuples = []
    depth = 0
    current_tuple = ""
    in_tuple = False
    
    for char in values_str:
        if char == '(' and not in_tuple:
            in_tuple = True
            current_tuple = '('
        elif in_tuple:
            current_tuple += char
            if char == '(':
                depth += 1
            elif char == ')':
                if depth == 0:
                    tuples.append(current_tuple)
                    in_tuple = False
                    current_tuple = ""
                else:
                    depth -= 1
    
    return header, tuples

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print(f"Reading {INPUT_FILE}...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print(f"Total size: {len(sql):,} bytes")
    
    # Step 1: Extract the setup section (BEGIN, ALTER, TRUNCATE)
    setup_match = re.search(r'(BEGIN;.*?-- Step 3:)', sql, re.DOTALL)
    if setup_match:
        setup_sql = setup_match.group(1)
        with open(f"{OUTPUT_DIR}/01_setup.sql", 'w') as f:
            f.write(setup_sql)
        print(f"01_setup.sql: {len(setup_sql):,} bytes")
    
    # Step 2: Extract states INSERT
    states_match = re.search(r'(INSERT INTO states.*?;)', sql, re.DOTALL)
    if states_match:
        with open(f"{OUTPUT_DIR}/02_states.sql", 'w') as f:
            f.write("-- Step 3: Insert states\n")
            f.write(states_match.group(1))
            f.write("\n")
        print(f"02_states.sql: {len(states_match.group(1)):,} bytes")
    
    # Step 3: Extract LGAs INSERT and split into chunks
    lgas_match = re.search(r'(INSERT INTO lgas.*?;)', sql, re.DOTALL)
    if lgas_match:
        header, tuples = extract_insert_values(lgas_match.group(1))
        print(f"LGAs: {len(tuples)} tuples")
        
        BATCH = 500
        for i in range(0, len(tuples), BATCH):
            batch = tuples[i:i+BATCH]
            chunk_num = i // BATCH + 1
            filename = f"{OUTPUT_DIR}/03_lgas_{chunk_num:02d}.sql"
            with open(filename, 'w') as f:
                f.write(f"-- Step 4: Insert LGAs (batch {chunk_num})\n")
                f.write(header)
                f.write(",\n".join(batch))
                f.write(";\n")
            print(f"  {filename}: {len(batch)} LGAs")
    
    # Step 4: Extract Wards INSERT and split into chunks
    wards_match = re.search(r'(INSERT INTO wards.*?;)', sql, re.DOTALL)
    if wards_match:
        header, tuples = extract_insert_values(wards_match.group(1))
        print(f"Wards: {len(tuples)} tuples")
        
        BATCH = 2000
        for i in range(0, len(tuples), BATCH):
            batch = tuples[i:i+BATCH]
            chunk_num = i // BATCH + 1
            filename = f"{OUTPUT_DIR}/04_wards_{chunk_num:02d}.sql"
            with open(filename, 'w') as f:
                f.write(f"-- Step 5: Insert Wards (batch {chunk_num})\n")
                f.write(header)
                f.write(",\n".join(batch))
                f.write(";\n")
            size_kb = len(",\n".join(batch)) // 1024
            print(f"  {filename}: {len(batch)} wards ({size_kb} KB)")
    
    # Step 5: Extract Polling Units INSERT and split into chunks
    pu_match = re.search(r'(INSERT INTO polling_units.*?;)', sql, re.DOTALL)
    if pu_match:
        header, tuples = extract_insert_values(pu_match.group(1))
        print(f"PUs: {len(tuples)} tuples")
        
        BATCH = 1000
        for i in range(0, len(tuples), BATCH):
            batch = tuples[i:i+BATCH]
            chunk_num = i // BATCH + 1
            filename = f"{OUTPUT_DIR}/05_pus_{chunk_num:03d}.sql"
            with open(filename, 'w') as f:
                f.write(f"-- Step 6: Insert PUs (batch {chunk_num})\n")
                f.write(header)
                f.write(",\n".join(batch))
                f.write(";\n")
            size_kb = len(",\n".join(batch)) // 1024
            print(f"  {filename}: {len(batch)} PUs ({size_kb} KB)")
    
    # Step 6: Extract the remaining sections (indexes, triggers, verification)
    remaining = sql
    # Remove the INSERT sections
    for pattern in [r'INSERT INTO states.*?;', r'INSERT INTO lgas.*?;', 
                    r'INSERT INTO wards.*?;', r'INSERT INTO polling_units.*?;']:
        remaining = re.sub(pattern, '-- INSERT REMOVED', remaining, flags=re.DOTALL)
    
    # Extract from Step 7 onwards
    step7_match = re.search(r'(-- Step 7:.*?)$', remaining, re.DOTALL | re.MULTILINE)
    if step7_match:
        finish_sql = step7_match.group(1)
        with open(f"{OUTPUT_DIR}/06_finish.sql", 'w') as f:
            f.write(finish_sql)
        print(f"06_finish.sql: {len(finish_sql):,} bytes")
    
    # Create a manifest file
    files = sorted(os.listdir(OUTPUT_DIR))
    with open(f"{OUTPUT_DIR}/MANIFEST.txt", 'w') as f:
        f.write("Run these files in order via Supabase SQL Editor:\n\n")
        for fn in files:
            if fn.endswith('.sql'):
                size = os.path.getsize(f"{OUTPUT_DIR}/{fn}")
                f.write(f"  {fn} ({size//1024} KB)\n")
    
    print(f"\nSplit complete! Files in {OUTPUT_DIR}/")
    print("Run each .sql file in order via Supabase Dashboard SQL Editor")

if __name__ == "__main__":
    main()
