ALTER TABLE storages ADD COLUMN IF NOT EXISTS notify_before_days INTEGER;

CREATE TABLE IF NOT EXISTS inbox_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  min_role TEXT NOT NULL DEFAULT 'keeper',
  dedup_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inbox_notifications_org_created
  ON inbox_notifications (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_notifications_dedup
  ON inbox_notifications (organization_id, dedup_key);
