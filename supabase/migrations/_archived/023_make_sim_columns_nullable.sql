-- Make volunteer_id and assignment_id nullable in result_submissions
-- Simulation results are synthetic and don't have real volunteer/assignment IDs

ALTER TABLE result_submissions ALTER COLUMN volunteer_id DROP NOT NULL;
ALTER TABLE result_submissions ALTER COLUMN assignment_id DROP NOT NULL;

-- Also ensure the simulation function works with the existing schema
-- The TRUNCATE in the simulation clears old data so no conflicts
