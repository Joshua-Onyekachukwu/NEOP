-- Simulation configuration table
-- Stores the state of a running election simulation

CREATE TABLE IF NOT EXISTS simulation_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Election type: PRESIDENTIAL, HOUSE_OF_REPS, GOVERNORSHIP
  election_type TEXT NOT NULL DEFAULT 'PRESIDENTIAL',
  
  -- Status: IDLE, RUNNING, PAUSED, COMPLETED
  status TEXT NOT NULL DEFAULT 'IDLE',
  
  -- Speed: results per tick (every 5 seconds)
  speed INT NOT NULL DEFAULT 3,
  
  -- Which states to simulate (empty = all with data)
  target_states TEXT[] DEFAULT '{}',
  
  -- Progress tracking
  total_results_submitted INT NOT NULL DEFAULT 0,
  total_incidents_submitted INT NOT NULL DEFAULT 0,
  total_assignments_created INT NOT NULL DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ,
  last_tick_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active simulation at a time
-- (We enforce this in the API, not as a DB constraint)

-- Index for quick status lookups
CREATE INDEX IF NOT EXISTS idx_simulation_config_status ON simulation_config(status);
