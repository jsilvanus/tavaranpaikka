ALTER TABLE items ADD COLUMN IF NOT EXISTS leaseable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS leased_to TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS leased_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS item_leases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  borrower_name TEXT NOT NULL,
  leased_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at TIMESTAMPTZ,
  actor_sub TEXT
);

CREATE INDEX IF NOT EXISTS idx_item_leases_org_item
  ON item_leases (organization_id, item_id, leased_at DESC);
