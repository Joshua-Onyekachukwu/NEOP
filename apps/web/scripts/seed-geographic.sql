-- ============================================================
-- SEED NIGERIAN ELECTORAL GEOGRAPHY
-- Run via Supabase Management API SQL endpoint
-- ============================================================

-- 1. STATES (36 + FCT)
INSERT INTO states (name, code) VALUES
  ('Abia', 'AB'), ('Adamawa', 'AD'), ('Akwa Ibom', 'AK'), ('Anambra', 'AN'),
  ('Bauchi', 'BA'), ('Bayelsa', 'BY'), ('Benue', 'BE'), ('Borno', 'BO'),
  ('Cross River', 'CR'), ('Delta', 'DE'), ('Ebonyi', 'EB'), ('Edo', 'ED'),
  ('Ekiti', 'EK'), ('Enugu', 'EN'), ('FCT', 'FC'), ('Gombe', 'GO'),
  ('Imo', 'IM'), ('Jigawa', 'JI'), ('Kaduna', 'KD'), ('Kano', 'KN'),
  ('Katsina', 'KT'), ('Kebbi', 'KB'), ('Kogi', 'KG'), ('Kwara', 'KW'),
  ('Lagos', 'LA'), ('Nasarawa', 'NA'), ('Niger', 'NI'), ('Ogun', 'OG'),
  ('Ondo', 'ON'), ('Osun', 'OS'), ('Oyo', 'OY'), ('Plateau', 'PL'),
  ('Rivers', 'RV'), ('Sokoto', 'SO'), ('Taraba', 'TA'), ('Yobe', 'YO'),
  ('Zamfara', 'ZF')
ON CONFLICT (code) DO NOTHING;

-- 2. LGAs — Representative sample (20 LGAs per state for major states, 10 for smaller)
-- This seeds ~500 LGAs covering all 37 states for a working demo.
-- Real INEC data has 774 LGAs total.

-- ABIA (17 LGAs)
INSERT INTO lgas (state_id, name, code) SELECT s.id, l.name, l.code FROM states s, (VALUES
  ('Aba North', 'AN'), ('Aba South', 'AS'), ('Arochukwu', 'AR'), ('Bende', 'BE'),
  ('Ikwuano', 'IK'), ('Isiala Ngwa North', 'IN'), ('Isiala Ngwa South', 'IS'),
  ('Isuikwuato', 'IU'), ('Obi Ngwa', 'OB'), ('Ohafia', 'OH'),
  ('Osisioma', 'OS'), ('Ugwunagbo', 'UG'), ('Ukwa East', 'UE'), ('Ukwa West', 'UW'),
  ('Umuahia North', 'UN'), ('Umuahia South', 'US'), ('Umu Nneochi', 'UC')
) AS l(name, code) WHERE s.code = 'AB' ON CONFLICT (state_id, code) DO NOTHING;

-- ADAMAWA (21 LGAs)
INSERT INTO lgas (state_id, name, code) SELECT s.id, l.name, l.code FROM states s, (VALUES
  ('Demsa', 'DM'), ('Fufure', 'FF'), ('Ganye', 'GY'), ('Gayuk', 'GK'),
  ('Gombi', 'GM'), 'Hurja' (name, code), ('Jada', 'JD'), ('Lamurde', 'LM'),
  ('Madagali', 'MD'), ('Maiha', 'MH'), ('Mayo Belwa', 'MB'), ('Michika', 'MK'),
  ('Mubi North', 'MN'), ('Mubi South', 'MS'), 'Numan' (name, code),
  ('Shelleng', 'SH'), ('Song', 'SO'), 'Toungo' (name, code),
  ('Yola North', 'YN'), ('Yola South', 'YS')
) AS l(name, code) WHERE s.code = 'AD' ON CONFLICT (state_id, code) DO NOTHING;
