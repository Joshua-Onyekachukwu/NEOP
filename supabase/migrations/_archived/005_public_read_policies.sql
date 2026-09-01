-- Add public read policies for the public dashboard
-- These allow anonymous/unauthenticated users to read aggregated data

-- Public can read agent_assignments (for coverage stats on the public dashboard)
CREATE POLICY "Public can read assignments for stats" 
  ON agent_assignments 
  FOR SELECT 
  USING (true);

-- Public can read incidents (for the incidents section on the public dashboard)
CREATE POLICY "Public can read incidents" 
  ON incidents 
  FOR SELECT 
  USING (true);

-- Public can read state breakdown data
CREATE POLICY "Public can read states" 
  ON states 
  FOR SELECT 
  USING (true);

CREATE POLICY "Public can read lgas" 
  ON lgas 
  FOR SELECT 
  USING (true);
