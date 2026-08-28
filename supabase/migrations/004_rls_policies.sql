-- ============================================================
-- Migration 004: Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_completions ENABLE ROW LEVEL SECURITY;

-- Public read-only tables (no RLS needed, but still enabled for safety)
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgas ENABLE ROW LEVEL SECURITY;
ALTER TABLE wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_modules ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PUBLIC READ POLICIES (Geographic data, elections, parties)
-- ============================================================

CREATE POLICY "Public can read states" ON states FOR SELECT USING (true);
CREATE POLICY "Public can read LGAs" ON lgas FOR SELECT USING (true);
CREATE POLICY "Public can read wards" ON wards FOR SELECT USING (true);
CREATE POLICY "Public can read polling units" ON polling_units FOR SELECT USING (true);
CREATE POLICY "Public can read elections" ON elections FOR SELECT USING (true);
CREATE POLICY "Public can read parties" ON parties FOR SELECT USING (true);
CREATE POLICY "Public can read candidates" ON candidates FOR SELECT USING (true);
CREATE POLICY "Public can read training modules" ON training_modules FOR SELECT USING (true);

-- ============================================================
-- USER ACCOUNT POLICIES
-- ============================================================

-- Users can read/update their own account
CREATE POLICY "Users can read own account" ON user_accounts
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own account" ON user_accounts
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own account" ON user_accounts
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- VOLUNTEER POLICIES
-- ============================================================

-- Volunteers can read/update their own profile
CREATE POLICY "Volunteers can read own profile" ON volunteers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Volunteers can update own profile" ON volunteers
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Volunteers can insert own profile" ON volunteers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can read all volunteers
CREATE POLICY "Admins can read all volunteers" ON volunteers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

-- ============================================================
-- ASSIGNMENT POLICIES
-- ============================================================

-- Volunteers can only see their own assignments
CREATE POLICY "Volunteers can read own assignments" ON agent_assignments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Admins can read all assignments
CREATE POLICY "Admins can read all assignments" ON agent_assignments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

-- ============================================================
-- OBSERVATION POLICIES
-- ============================================================

-- Volunteers can read/write their own observations
CREATE POLICY "Volunteers can insert own observations" ON observations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

CREATE POLICY "Volunteers can read own observations" ON observations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Public can read observations (for dashboard)
CREATE POLICY "Public can read observations" ON observations
  FOR SELECT USING (true);

-- ============================================================
-- RESULT SUBMISSION POLICIES
-- ============================================================

-- Volunteers can only insert results for their assigned polling unit
CREATE POLICY "Volunteers can insert own results" ON result_submissions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_assignments a
      JOIN volunteers v ON v.id = a.volunteer_id
      WHERE v.user_id = auth.uid()
        AND a.id = assignment_id
        AND a.polling_unit_id = result_submissions.polling_unit_id
        AND a.election_id = result_submissions.election_id
        AND a.status IN ('ACTIVATED', 'CHECKED_IN')
    )
  );

-- Volunteers can read their own results
CREATE POLICY "Volunteers can read own results" ON result_submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Public can read results (for dashboard)
CREATE POLICY "Public can read results" ON result_submissions
  FOR SELECT USING (true);

-- ============================================================
-- PARTY RESULTS POLICIES
-- ============================================================

-- Public can read party results
CREATE POLICY "Public can read party results" ON party_results
  FOR SELECT USING (true);

-- ============================================================
-- EVIDENCE POLICIES (CRITICAL - strict access control)
-- ============================================================

-- Volunteers can upload evidence for their own assignments
CREATE POLICY "Volunteers can insert own evidence" ON evidence_records
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Volunteers can read their own evidence
CREATE POLICY "Volunteers can read own evidence" ON evidence_records
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Admins can read evidence based on role
CREATE POLICY "Admins can read evidence" ON evidence_records
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
  );

-- Public can only read public evidence
CREATE POLICY "Public can read public evidence" ON evidence_records
  FOR SELECT USING (is_public = true);

-- ============================================================
-- INCIDENT POLICIES
-- ============================================================

-- Volunteers can insert/read their own incidents
CREATE POLICY "Volunteers can insert own incidents" ON incidents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

CREATE POLICY "Volunteers can read own incidents" ON incidents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Public can read incidents (for dashboard, with limited fields)
CREATE POLICY "Public can read incidents" ON incidents
  FOR SELECT USING (true);

-- ============================================================
-- PAYMENT POLICIES (private - only admins and the volunteer)
-- ============================================================

-- Volunteers can read their own payment records
CREATE POLICY "Volunteers can read own payments" ON volunteer_payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

-- Finance admins can read/manage payments
CREATE POLICY "Finance admins can manage payments" ON volunteer_payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users 
      WHERE user_id = auth.uid() 
        AND is_active = true 
        AND role IN ('SUPER_ADMIN', 'FINANCE_ADMIN')
    )
  );

-- ============================================================
-- AUDIT LOG POLICIES (admin-only read, insert-only for system)
-- ============================================================

CREATE POLICY "System can insert audit logs" ON audit_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can read audit logs" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users 
      WHERE user_id = auth.uid() 
        AND is_active = true 
        AND role IN ('SUPER_ADMIN', 'OPERATIONS_ADMIN')
    )
  );

-- ============================================================
-- TRAINING COMPLETION POLICIES
-- ============================================================

CREATE POLICY "Volunteers can read own training" ON training_completions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );

CREATE POLICY "Volunteers can insert own training" ON training_completions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM volunteers WHERE id = volunteer_id AND user_id = auth.uid())
  );
