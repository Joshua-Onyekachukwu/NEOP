-- ============================================================
-- 101_simulation_history.sql
-- Creates a table to track simulation runs with timestamps and results
-- Run this ONE file in Supabase SQL Editor
-- ============================================================

-- Create simulation_history table
CREATE TABLE IF NOT EXISTS simulation_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario TEXT NOT NULL,
  election_type TEXT NOT NULL DEFAULT 'PRESIDENTIAL',
  status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING, COMPLETED, FAILED
  total_polling_units INTEGER DEFAULT 0,
  results_created INTEGER DEFAULT 0,
  party_results_created INTEGER DEFAULT 0,
  total_votes BIGINT DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  ndc_wins BOOLEAN DEFAULT true,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add RLS policies
ALTER TABLE simulation_history ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Public can view simulation history"
  ON simulation_history FOR SELECT
  USING (true);

-- Allow service role to insert/update
CREATE POLICY "Service role can manage simulation history"
  ON simulation_history FOR ALL
  USING (auth.role() = 'service_role');

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can insert simulation history"
  ON simulation_history FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_sim_history_started ON simulation_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_history_status ON simulation_history(status);

-- Grant permissions
GRANT SELECT ON simulation_history TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON simulation_history TO authenticated, service_role;

-- Create function to log simulation start
CREATE OR REPLACE FUNCTION log_simulation_start(
  p_scenario TEXT,
  p_election_type TEXT DEFAULT 'PRESIDENTIAL'
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO simulation_history (scenario, election_type, status, started_at)
  VALUES (p_scenario, p_election_type, 'RUNNING', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to log simulation completion
CREATE OR REPLACE FUNCTION log_simulation_complete(
  p_id UUID,
  p_total_polling_units INTEGER,
  p_results_created INTEGER,
  p_party_results_created INTEGER,
  p_total_votes BIGINT,
  p_duration_seconds INTEGER,
  p_ndc_wins BOOLEAN DEFAULT true
) RETURNS VOID AS $$
BEGIN
  UPDATE simulation_history SET
    status = 'COMPLETED',
    total_polling_units = p_total_polling_units,
    results_created = p_results_created,
    party_results_created = p_party_results_created,
    total_votes = p_total_votes,
    duration_seconds = p_duration_seconds,
    ndc_wins = p_ndc_wins,
    completed_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to log simulation failure
CREATE OR REPLACE FUNCTION log_simulation_failure(
  p_id UUID,
  p_error_message TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE simulation_history SET
    status = 'FAILED',
    error_message = p_error_message,
    completed_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION log_simulation_start TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_simulation_complete TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_simulation_failure TO authenticated, service_role;

-- Insert some sample data for testing
INSERT INTO simulation_history (scenario, election_type, status, total_polling_units, results_created, total_votes, duration_seconds, ndc_wins, started_at, completed_at)
VALUES
  ('landslide', 'PRESIDENTIAL', 'COMPLETED', 188042, 188042, 60199188, 180, true, now() - interval '1 hour', now() - interval '58 minutes'),
  ('sweep', 'PRESIDENTIAL', 'COMPLETED', 188042, 188042, 58500000, 195, true, now() - interval '2 hours', now() - interval '1 hour 57 minutes'),
  ('close', 'PRESIDENTIAL', 'COMPLETED', 188042, 188042, 55000000, 210, true, now() - interval '3 hours', now() - interval '2 hours 56 minutes');

SELECT '=== Simulation History Table Created ===' AS status,
       (SELECT count(*) FROM simulation_history) AS history_rows;
