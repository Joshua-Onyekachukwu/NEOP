#!/usr/bin/env bash
# Local simulation pump (serial).
#
# Drives the DB checkpoint queue via the tick endpoint on the LOCAL
# server, which has no Vercel 60s function cap — so heavy steps finish.
# The run lives in the shared Supabase DB, so everything it publishes is
# immediately visible on the live production site.
#
# IMPORTANT: one step per tick. Claiming many heavy wave steps in
# parallel saturates the database and makes neop_sim_wave hit the
# statement timeout ("upstream request timeout").
#
# Usage: bash _scripts/local-pump.sh [base_url] [steps_per_tick]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/_logs/local-pump.log"
BASE="${1:-http://localhost:3000}"
STEPS="${2:-1}"

SECRET="$(grep -oE '^CRON_SECRET=.*' "$ROOT/.env.local" | cut -d= -f2- | tr -d '\r')"
if [ -z "$SECRET" ]; then echo "CRON_SECRET missing from .env.local" >&2; exit 1; fi

mkdir -p "$ROOT/_logs"
echo "PUMP_START $(date +%H:%M:%S) base=$BASE steps=$STEPS" >> "$LOG"

idle=0
for _ in $(seq 1 2000); do
  R="$(curl -s -m 300 -X POST "$BASE/api/admin/simulate/tick?max=$STEPS" \
        -H "Authorization: Bearer $SECRET")"
  echo "$(date +%H:%M:%S) $(echo "$R" | head -c 400)" >> "$LOG"

  if echo "$R" | grep -qE '"run_finished":true'; then
    echo "PUMP_FINISHED_RUN $(date +%H:%M:%S)" >> "$LOG"; break
  fi
  if echo "$R" | grep -qE '"processed":0'; then
    idle=$((idle + 1))
    # Several consecutive empty claims => the queue is empty (or a step
    # is stuck mid-flight); stop rather than spin.
    if [ "$idle" -ge 3 ]; then echo "PUMP_IDLE_STOP $(date +%H:%M:%S)" >> "$LOG"; break; fi
    sleep 10
  else
    idle=0
    sleep 1
  fi
done

echo "PUMP_EXIT $(date +%H:%M:%S)" >> "$LOG"
