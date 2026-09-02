#!/bin/bash
# Progressive benchmark for NEOP simulation engine v2
# Tests at increasing voter scales to find maximum capacity

CONVEX_URL="https://friendly-retriever-385.convex.cloud"
DEPLOY_KEY='preview:joshua-onyekachukwu:neop|eyJ2MiI6ImMyNmQ1NWE4M2QzNDQ3ODNhYTYxNmIzNDQ1OTZjYmY3In0='
SUPABASE_URL="https://lvtfrfrnqxqwjuematum.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dGZyZnJucXhxd2p1ZW1hdHVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI5MTA4OCwiZXhwIjoyMTAzODY3MDg4fQ.rJHjdLQidywOxL28ayn51DBEcwh5hmhzJk0bn7vSuE0"

SCALES="1000000 5000000 10000000 25000000 50000000 100000000"
RESULTS_FILE="/tmp/benchmark-results.csv"

echo "voters,duration_s,pus_processed,total_votes,throughput_pus_per_s,ndc_pct,apc_pct" > "$RESULTS_FILE"

for SCALE in $SCALES; do
  echo ""
  echo "============================================"
  echo "  BENCHMARK: $(printf "%'d" $SCALE) voters"
  echo "============================================"
  
  SEED=$((RANDOM * 1000))
  
  # Clear old data
  echo "Clearing old data..."
  curl -s -m 120 "${CONVEX_URL}/api/action" \
    -H "Content-Type: application/json" \
    -H "Authorization: Convex ${DEPLOY_KEY}" \
    -d '{"path":"clearData:clearAllData","args":{}}' > /dev/null 2>&1
  
  sleep 2
  
  # Fire simulation
  START_TIME=$(date +%s)
  nohup curl -s -m 600 "${CONVEX_URL}/api/action" \
    -H "Content-Type: application/json" \
    -H "Authorization: Convex ${DEPLOY_KEY}" \
    -d "{\"path\":\"simEngineV2:runSimulationV2\",\"args\":{\"config\":{\"scenario\":\"landslide\",\"election_type\":\"PRESIDENTIAL\",\"target_voters\":${SCALE},\"random_seed\":${SEED},\"batch_size\":2000,\"pu_failure_rate\":0.03,\"turnout_min\":0.3,\"turnout_max\":0.8,\"geographic_scope\":\"national\",\"simulation_speed\":1},\"supabaseUrl\":\"${SUPABASE_URL}\",\"supabaseKey\":\"${SUPABASE_KEY}\"}}" \
    > /tmp/sim-result.json 2>&1 &
  
  SIM_PID=$!
  
  # Poll progress
  COMPLETED=false
  for i in $(seq 1 60); do
    sleep 10
    if ! kill -0 $SIM_PID 2>/dev/null; then
      COMPLETED=true
      break
    fi
    PROGRESS=$(curl -s -m 5 "${CONVEX_URL}/api/query" \
      -H "Content-Type: application/json" \
      -d '{"path":"stats:getSimConfig","args":{}}' 2>/dev/null | \
      python3 -c "import sys,json; d=json.load(sys.stdin).get('value',{}); print(f\"{d.get('progress_percent',0)}% | {d.get('results_processed',0):.0f}/{d.get('total_results',0):.0f} | {d.get('processing_rate',0)} PUs/s\")" 2>/dev/null)
    echo "  [$i] $PROGRESS"
  done
  
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  # Get final results
  RESULT=$(cat /tmp/sim-result.json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'success':
        v = d.get('value', {})
        print(f\"{v.get('duration_seconds',0)}|{v.get('covered_pus',0)}|{v.get('total_votes',0)}|{v.get('processing_rate',0)}\")
    else:
        print(f\"ERROR|0|0|0\")
except:
    print(f\"PARSE_ERROR|0|0|0\")
" 2>/dev/null)
  
  # Get party totals
  PARTIES=$(curl -s -m 10 "${CONVEX_URL}/api/query" \
    -H "Content-Type: application/json" \
    -d '{"path":"stats:getPartyTotals","args":{}}' 2>/dev/null | \
    python3 -c "
import sys, json
data = json.load(sys.stdin).get('value', [])
ndc = next((p['percentage'] for p in data if p['abbreviation'] == 'NDC'), 0)
apc = next((p['percentage'] for p in data if p['abbreviation'] == 'APC'), 0)
print(f'{ndc}|{apc}')
" 2>/dev/null)
  
  IFS='|' read -r DUR PUS VOTES RATE <<< "$RESULT"
  IFS='|' read -r NDC_PCT APC_PCT <<< "$PARTIES"
  
  echo ""
  echo "  RESULT: ${PUS} PUs, ${VOTES} votes, ${DUR}s, ${RATE} PUs/s"
  echo "  PARTIES: NDC ${NDC_PCT}%, APC ${APC_PCT}%"
  
  echo "${SCALE},${DUR},${PUS},${VOTES},${RATE},${NDC_PCT},${APC_PCT}" >> "$RESULTS_FILE"
  
  echo ""
  echo "  Waiting 5s before next test..."
  sleep 5
done

echo ""
echo "============================================"
echo "  BENCHMARK SUMMARY"
echo "============================================"
cat "$RESULTS_FILE" | column -t -s ','
echo ""
echo "Results saved to $RESULTS_FILE"
