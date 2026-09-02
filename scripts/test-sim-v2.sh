#!/bin/bash
CONVEX_URL="https://rosy-crocodile-952.convex.cloud"
DEPLOY_KEY='preview:joshua-onyekachukwu:neop|eyJ2MiI6ImMyNmQ1NWE4M2QzNDQ3ODNhYTYxNmIzNDQ1OTZjYmY3In0='
SUPABASE_URL="https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"

TARGET_VOTERS=${1:-1000000}
SEED=${2:-42}

echo "=== Simulation V2: ${TARGET_VOTERS} voters, seed=${SEED} ==="
echo "Time: $(date)"

# Fire the action (fire-and-forget)
nohup curl -s -m 900 "${CONVEX_URL}/api/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Convex ${DEPLOY_KEY}" \
  -d "{\"path\":\"simEngineV2:runSimulationV2\",\"args\":{\"config\":{\"scenario\":\"landslide\",\"election_type\":\"PRESIDENTIAL\",\"target_voters\":${TARGET_VOTERS},\"random_seed\":${SEED},\"batch_size\":2000,\"pu_failure_rate\":0.03,\"turnout_min\":0.3,\"turnout_max\":0.8,\"geographic_scope\":\"national\",\"simulation_speed\":1},\"supabaseUrl\":\"${SUPABASE_URL}\",\"supabaseKey\":\"${SUPABASE_KEY}\"}}" \
  > /tmp/sim-v2-result.json 2>&1 &

SIM_PID=$!
echo "Action fired (PID: $SIM_PID). Polling progress..."

for i in $(seq 1 60); do
  sleep 10
  
  if ! kill -0 $SIM_PID 2>/dev/null; then
    echo ""
    echo "=== Action completed ==="
    cat /tmp/sim-v2-result.json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'success':
        v = d.get('value', {})
        print(f\"Success: {v.get('covered_pus',0)} PUs, {v.get('total_votes',0):,.0f} votes, {v.get('duration_seconds',0)}s, {v.get('processing_rate',0)} PUs/s\")
    else:
        print(f\"Error: {d.get('errorMessage','unknown')[:200]}\")
except:
    print(sys.stdin.read()[:300])
" 2>/dev/null
    break
  fi
  
  # Query progress
  PROGRESS=$(curl -s -m 10 "${CONVEX_URL}/api/query" \
    -H "Content-Type: application/json" \
    -d '{"path":"stats:getSimConfig","args":{}}' 2>/dev/null)
  
  STATUS=$(echo "$PROGRESS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin).get('value',{})
    status = d.get('status','?')
    pct = d.get('progress_percent',0)
    done = d.get('results_processed',0)
    total = d.get('total_results',0)
    rate = d.get('processing_rate',0)
    eta = d.get('estimated_completion_ms',0)//1000
    votes = d.get('total_votes',0)
    print(f'{status} | {pct}% | {done:.0f}/{total:.0f} | {votes:,.0f} votes | {rate} PUs/s | ETA {eta}s')
except:
    print('parsing error')
" 2>/dev/null)
  
  echo "[$(date +%H:%M:%S)] $STATUS"
done

echo ""
echo "=== Party Totals ==="
curl -s -m 10 "${CONVEX_URL}/api/query" \
  -H "Content-Type: application/json" \
  -d '{"path":"stats:getPartyTotals","args":{}}' 2>&1 | python3 -c "
import sys, json
data = json.load(sys.stdin).get('value', [])
for p in data:
    print(f\"  {p['abbreviation']:5s} {p['total_votes']:>12,.0f} votes ({p['percentage']}%)\")
" 2>/dev/null

echo ""
echo "=== Done ==="
