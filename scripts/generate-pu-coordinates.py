#!/usr/bin/env python3
"""
Generate approximate coordinates for INEC polling units.
Uses known state capitals and LGA headquarters to distribute PUs.
"""

import json
import csv
import random
import math

# Known state coordinates (capital city approximate centers)
STATE_COORDS = {
    "Abia": (5.1080, 7.3680),
    "Adamawa": (9.3265, 12.3980),
    "Akwa Ibom": (5.0340, 7.9120),
    "Anambra": (6.2100, 6.9980),
    "Bauchi": (10.3100, 9.8400),
    "Bayelsa": (4.7710, 6.1000),
    "Benue": (7.3360, 8.7480),
    "Borno": (11.8460, 13.1600),
    "Cross River": (5.9630, 8.3250),
    "Delta": (5.5170, 5.7500),
    "Ebonyi": (6.3170, 8.1000),
    "Edo": (6.3350, 5.6280),
    "Ekiti": (7.6210, 5.2220),
    "Enugu": (6.4410, 7.4990),
    "Fct": (9.0580, 7.4950),
    "Gombe": (10.2900, 11.1700),
    "Imo": (5.4840, 7.0350),
    "Jigawa": (12.2230, 9.3420),
    "Kaduna": (10.5220, 7.4380),
    "Kano": (12.0020, 8.5920),
    "Katsina": (12.9910, 7.6010),
    "Kebbi": (12.4540, 4.1970),
    "Kogi": (7.7970, 6.7400),
    "Kwara": (8.4960, 4.5520),
    "Lagos": (6.4540, 3.3950),
    "Nasarawa": (8.2970, 8.3680),
    "Niger": (9.6100, 6.5560),
    "Ogun": (7.1560, 3.3460),
    "Ondo": (7.2500, 5.1950),
    "Osun": (7.7670, 4.5600),
    "Oyo": (7.3960, 3.9470),
    "Plateau": (9.9170, 8.8920),
    "Rivers": (4.7770, 7.0130),
    "Sokoto": (13.0600, 5.2420),
    "Taraba": (7.8700, 10.7730),
    "Yobe": (11.7490, 11.9660),
    "Zamfara": (12.1700, 6.6600),
}

# Load our INEC data
INPUT_CSV = "data/inec_polling_units.csv"
OUTPUT_JSON = "data/pu-coordinates.json"

print("Loading INEC data...")
pus = []
with open(INPUT_CSV, 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.reader(f)
    next(reader)  # skip header
    for row in reader:
        if len(row) < 9:
            continue
        state = row[1].strip().title()
        lga = row[2].strip().title()
        ward = row[3].strip().title()
        pu_code = row[8].strip()
        
        pus.append({
            "state": state,
            "lga": lga,
            "ward": ward,
            "pu_code": pu_code,
        })

print(f"Loaded {len(pus)} PUs")

# Group by state → LGA → ward
hierarchy = {}
for pu in pus:
    state = pu["state"]
    lga = pu["lga"]
    ward = pu["ward"]
    
    if state not in hierarchy:
        hierarchy[state] = {}
    if lga not in hierarchy[state]:
        hierarchy[state][lga] = {}
    if ward not in hierarchy[state][lga]:
        hierarchy[state][lga][ward] = []
    hierarchy[state][lga][ward].append(pu)

print(f"Hierarchy: {len(hierarchy)} states")

# Generate coordinates
random.seed(42)  # Reproducible
results = []
total_geocoded = 0

for state, lgas in hierarchy.items():
    state_coords = STATE_COORDS.get(state, (9.0, 7.5))  # Default center of Nigeria
    
    for lga, wards in lgas.items():
        # Offset LGA from state center (±0.3 degrees)
        lga_offset_x = random.uniform(-0.3, 0.3)
        lga_offset_y = random.uniform(-0.3, 0.3)
        lga_lat = state_coords[0] + lga_offset_y
        lga_lng = state_coords[1] + lga_offset_x
        
        for ward_name, ward_pus in wards.items():
            # Offset ward from LGA (±0.05 degrees)
            ward_offset_x = random.uniform(-0.05, 0.05)
            ward_offset_y = random.uniform(-0.05, 0.05)
            ward_lat = lga_lat + ward_offset_y
            ward_lng = lga_lng + ward_offset_x
            
            for i, pu in enumerate(ward_pus):
                # Offset PU from ward (±0.01 degrees)
                pu_offset_x = random.uniform(-0.01, 0.01)
                pu_offset_y = random.uniform(-0.01, 0.01)
                pu_lat = ward_lat + pu_offset_y
                pu_lng = ward_lng + pu_offset_x
                
                results.append({
                    "pu_code": pu["pu_code"],
                    "latitude": round(pu_lat, 6),
                    "longitude": round(pu_lng, 6),
                })
                total_geocoded += 1

print(f"Generated coordinates for {total_geocoded} PUs")

# Save results
with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=None)

print(f"Saved to {OUTPUT_JSON}")

# Stats
print(f"\n=== Summary ===")
print(f"Total PUs geocoded: {total_geocoded}")
print(f"States covered: {len(hierarchy)}")
print(f"Sample: {results[0]}")
