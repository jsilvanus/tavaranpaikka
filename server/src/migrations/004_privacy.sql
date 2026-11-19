ALTER TABLE organizations ADD COLUMN IF NOT EXISTS controller_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS controller_contact TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS processors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS privacy_extra TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS lease_retention_days INTEGER NOT NULL DEFAULT 365;
