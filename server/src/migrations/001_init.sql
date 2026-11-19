CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_locale TEXT NOT NULL DEFAULT 'fi',
  locales JSONB NOT NULL DEFAULT '["fi"]',
  report_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'room',
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  image_width INTEGER,
  image_height INTEGER,
  public_listed BOOLEAN NOT NULL DEFAULT TRUE,
  inspection_interval_days INTEGER,
  last_inspected_at TIMESTAMPTZ,
  last_inspected_by_sub TEXT,
  report_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_storages_org ON storages (organization_id);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  storage_id TEXT NOT NULL REFERENCES storages(id),
  parent_place_id TEXT REFERENCES places(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  pin_label TEXT NOT NULL DEFAULT '',
  report_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_places_org_storage ON places (organization_id, storage_id);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  place_id TEXT REFERENCES places(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  expires_on DATE,
  min_quantity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_items_org_place ON items (organization_id, place_id);

CREATE TABLE IF NOT EXISTS place_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  place_id TEXT NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  quantity_note TEXT NOT NULL DEFAULT '',
  quantity INTEGER,
  min_quantity INTEGER,
  expires_on DATE,
  status TEXT NOT NULL DEFAULT 'ok',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_place_entries_org_place ON place_entries (organization_id, place_id);

CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  printed_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_codes_org_target ON codes (organization_id, kind, target_id);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  place_id TEXT NOT NULL REFERENCES places(id),
  item_id TEXT REFERENCES items(id),
  entry_id TEXT REFERENCES place_entries(id),
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  reporter_name TEXT NOT NULL DEFAULT '',
  reporter_sub TEXT,
  reporter_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'fi',
  status TEXT NOT NULL DEFAULT 'open',
  votes INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_sub TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_sub TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_org_status ON reports (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_place ON reports (place_id);

CREATE TABLE IF NOT EXISTS report_votes (
  report_id TEXT NOT NULL REFERENCES reports(id),
  voter_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id, voter_hash)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  report_id TEXT NOT NULL REFERENCES reports(id),
  channel TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_state ON notifications (state);

CREATE TABLE IF NOT EXISTS users (
  sub TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  user_sub TEXT NOT NULL REFERENCES users(sub),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_sub, organization_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_sub TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  item_id TEXT REFERENCES items(id),
  storage_id TEXT REFERENCES storages(id),
  from_place_id TEXT REFERENCES places(id),
  to_place_id TEXT REFERENCES places(id),
  event_type TEXT NOT NULL,
  actor_sub TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
