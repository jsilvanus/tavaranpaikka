CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_images_org_owner
  ON images (organization_id, owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS image_overlays (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  image_id TEXT NOT NULL REFERENCES images(id),
  target_kind TEXT NOT NULL,
  target_id TEXT,
  shape TEXT NOT NULL DEFAULT 'rect',
  coords JSONB NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#dc2626',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_image_overlays_org_image
  ON image_overlays (organization_id, image_id);
