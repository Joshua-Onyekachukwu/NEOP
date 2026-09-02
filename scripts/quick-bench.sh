#!/bin/bash
CONVEX_URL="https://rosy-crocodile-952.convex.cloud"
DEPLOY_KEY='preview:joshua-onyekachukwu:neop|eyJ2MiI6ImMyNmQ1NWE4M2QzNDQ3ODNhYTYxNmIzNDQ1OTZjYmY3In0='
SUPABASE_URL="https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"

echo "=== Quick Benchmark: Clear + 1M Simulation ==="

# Step 1: Clear
echo "Step 1: Clearing..."
START=$(date +%s)
curl -s -m 300 "${CONVEX_URL}/api/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Convex ${DEPLOY_KEY}" \
  -d '{"path":"clearData:clearAllData","args":{}}' > /dev/null 2>&1 &
CLEAR_PID=$!

# Wait for clear with timeout
for i in $(seq 1 30); do
  sleep 10
  if ! kill -0 $CLEAR_PID 2>/dev/null; then
    END=$(date +%s)
    echo "  Clear completed in $((END - START))s"
    break
  fi
  echo "  Clearing... ($((i * 10))s elapsed)"
done

if kill -0 $CLEAR_PID 2>/dev/null; then
  echo "  Clear still running after 300s (will continue in background)"
fi

sleep 5

# Step 2: Run 1M simulation
echo "Step 2: Running 1M simulation..."
START=$(date +%s)
nohup curl -s -m 600 "${CONVEX_URL}/api/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Convex ${DEPLOY_KEY}" \
  -d "{\"path\":\"simEngineV2:runSimulationV2\",\"args\":{\"config\":{\"scenario\":\"landslide\",\"election_type\":\"PRESIDENTIAL\",\"target_voters\":1000000,\"random_seed\":42,\"batch_size\":2000,\"pu_failure_rate\":0.03,\"turnout_min\":0.3,\"turnout_max\":0.8,\"geographic_scope\":\"national\",\"simulation_speed\":1},\"supabaseUrl\":\"${SUPABASE_URL}\",\"supabaseKey\":\"${SUPABASE_KEY}\"}}" \
  > /tmp/sim-result.json 2>&1 &
SIM_PID=$!

for i in $(seq 1 30); do
  sleep 10
  if ! kill -0 $SIM_PID 2>/dev/null; then
    END=$(date +%s)
    echo "  Simulation completed in $((END - START))s"
    break
  fi
  PROGRESS=$(curl -s -m 5 "${CONVEX_URL}/api/query" \
    -H "Content-Type: application/json" \
    -d '{"path":"stats:getSimConfig","args":{}}' 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin).get('value',{}); print(f\"{d.get('progress_percent',0)}% | {d.get('processing_rate',0)} PUs/s\")" 2>/dev/null)
  echo "  [$((i * 10))s] $PROGRESS"
done

# Final results
echo ""
echo "=== Results ==="
cat /tmp/sim-result.json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'success':
        v = d.get('value', {})
        print(f\"PUs: {v.get('covered_pus',0)}\")
        print(f\"Votes: {v.get('total_votes',0):,.0f}\")
        print(f\"Duration: {v.get('duration_seconds',0)}s\")
        print(f\"Rate: {v.get('processing_rate',0)} PUs/s\")
    else:
        print(f\"Error: {d.get('errorMessage','unknown')[:200]}\")
except:
    print('Parse error')
" 2>/dev/null

echo ""
echo "=== Done ==="
