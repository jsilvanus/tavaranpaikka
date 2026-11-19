CREATE INDEX IF NOT EXISTS idx_reports_org_hash_created
  ON reports (organization_id, reporter_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_reports_org_place_created
  ON reports (organization_id, place_id, created_at);

CREATE INDEX IF NOT EXISTS idx_item_history_org_item
  ON item_history (organization_id, item_id);
