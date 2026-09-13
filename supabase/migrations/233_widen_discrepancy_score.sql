-- NEOP 233 — verifications.discrepancy_score holds the max absolute
-- party-vote difference between paired submissions (the admin
-- verification queue maps it directly to max_diff). numeric(5,4)
-- capped it at 9.9999, so any paired discrepancy of >= 10 votes (or a
-- plain 5, once the scale shift is hit) raised "numeric field overflow"
-- and rolled back the whole sim wave. Widen to numeric(12,4).
ALTER TABLE public.verifications
  ALTER COLUMN discrepancy_score TYPE numeric(12,4);
