#!/bin/bash
CONVEX_URL="https://curious-echidna-372.convex.cloud"
DEPLOY_KEY='preview:joshua-onyekachukwu:neop|eyJ2MiI6ImMyNmQ1NWE4M2QzNDQ3ODNhYTYxNmIzNDQ1OTZjYmY3In0='

echo "=== Step 1: Running simulation (100M voters, all 46,560 PUs) ==="
curl -s -m 900 "${CONVEX_URL}/api/action" \
  -H "Content-Type: application/json" \
  -H "Authorization: Convex ${DEPLOY_KEY}" \
  -d '{"path":"runSimulation:runSimulation","args":{"scenario":"landslide","electionType":"PRESIDENTIAL","totalVoters":100000000}}' 2>&1

echo ""
echo "=== Step 2: Query global stats ==="
curl -s -m 30 "${CONVEX_URL}/api/query" \
  -H "Content-Type: application/json" \
  -d '{"path":"stats:getGlobalStats","args":{}}' 2>&1

echo ""
echo "=== Step 3: Query sim config ==="
curl -s -m 30 "${CONVEX_URL}/api/query" \
  -H "Content-Type: application/json" \
  -d '{"path":"stats:getSimConfig","args":{}}' 2>&1

echo ""
echo "=== Step 4: Query party totals ==="
curl -s -m 30 "${CONVEX_URL}/api/query" \
  -H "Content-Type: application/json" \
  -d '{"path":"stats:getPartyTotals","args":{}}' 2>&1

echo ""
echo "=== Done ==="
