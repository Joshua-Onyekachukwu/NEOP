# NEOP Web — Agent Guidance

Supabase-only architecture. PostgreSQL is the single source of truth; Convex was removed (Sep 2026) — do not reintroduce it. The `convex/` directory at repo root is dead code awaiting deletion.

Key rules:

1. **One authoritative aggregation**: `get_election_summary()` (migration 242) drives every results surface (leaderboard, state breakdown, stats, ticker). Never compute national/state/party totals independently in a component or route.
2. **No hard-coded result or geography numbers** in the UI. PU counts come from the DB (`inec_total_polling_units` = 176,846); never paste numeric literals as denominators.
3. **`parties` table has no `name` column** — it's `official_name`, `abbreviation`, `color`.
4. **Supabase Realtime channel names must be unique per component** (`…-map`, `…-feed`); two components sharing a channel name crash on mount order. Wrap subscribes in try/catch.
5. **Ingestion is idempotent by supersede**: `publish_canonical_result` replaces a PU's prior canonical (never add on resubmit). Don't write code paths that could double-count.
6. **Deploy from the repo root** (`npx vercel deploy --prod`), never from `apps/web/` — subdirectory deploys miss the `packages/` workspace.
7. Scheduled jobs run via **pg_cron inside Supabase** (Vercel Hobby forbids crons). See migration 244.
