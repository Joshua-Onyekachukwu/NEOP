-- Add is_active flag to elections and set the active election
-- Without this, auto-assign can never find an active election

ALTER TABLE elections ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Set the first Presidential election as active
UPDATE elections SET is_active = true 
WHERE type = 'PRESIDENTIAL' 
AND id = (
  SELECT id FROM elections WHERE type = 'PRESIDENTIAL' 
  ORDER BY created_at ASC LIMIT 1
);

-- Set all other elections as inactive
UPDATE elections SET is_active = false 
WHERE is_active IS DISTINCT FROM true 
AND NOT (type = 'PRESIDENTIAL' AND id = (
  SELECT id FROM elections WHERE type = 'PRESIDENTIAL' 
  ORDER BY created_at ASC LIMIT 1
));
