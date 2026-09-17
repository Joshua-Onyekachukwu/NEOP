-- ============================================================
-- NEOP 257 — SIMULATION STATEMENT TIMEOUTS FOR FULL COVERAGE
--
-- Problem
--   The full-coverage lifecycle (migration 245) makes every one of
--   the 176,846 polling units a ledger row. The heavy simulation
--   functions were capped at 60–120s back when a run only touched a
--   slice of the universe:
--
--     assign_simulation_outcomes   60s   -> exceeds on 176,846 rows
--     materialize_ledger_hash_chunk 60s
--     neop_sim_wave               120s   -> exceeded per data chunk
--     sync_simulation_progress     60s
--
--   With 100% coverage these caps abort legitimate work with
--   "canceling statement due to statement timeout", which the queue
--   surfaces as a failed step and the run stalls at 0 published.
--
-- Fix
--   Raise the caps to values that let a full-coverage step finish,
--   while still bounding runaway queries:
--
--     assign_simulation_outcomes    300s   (whole universe, one call)
--     materialize_ledger_hash_chunk 300s   (one ledger slice)
--     neop_sim_wave                 300s   (one wave x one data chunk)
--     sync_simulation_progress      180s
--
--   service_role's role-level timeout is raised to 600s for the same
--   reason: it is the ceiling the queue's step execution runs under.
--
-- NOTE ON SERVERLESS
--   These caps only help where the caller may run long. Vercel caps a
--   serverless invocation at ~60s, so production runs must either use
--   small steps (many chunks) or be driven by a long-lived worker
--   (see docs/ARCHITECTURE_RUNBOOK.md — "Running a simulation").
-- ============================================================

-- Both overloads exist; the 6-arg one is still reachable from older callers.
ALTER FUNCTION public.assign_simulation_outcomes(uuid, numeric, numeric, numeric, numeric, numeric, integer)
  SET statement_timeout = '300s';
ALTER FUNCTION public.assign_simulation_outcomes(uuid, numeric, numeric, numeric, numeric, numeric)
  SET statement_timeout = '300s';

ALTER FUNCTION public.materialize_ledger_hash_chunk(uuid, integer, integer)
  SET statement_timeout = '300s';

ALTER FUNCTION public.neop_sim_wave(
  text, bigint, integer, integer, integer, numeric, uuid, uuid,
  integer, integer, integer, integer, integer
) SET statement_timeout = '300s';

ALTER FUNCTION public.sync_simulation_progress(uuid)
  SET statement_timeout = '180s';

-- Role-level ceiling for service_role (the role the engine executes as).
ALTER ROLE service_role SET statement_timeout = '600s';
