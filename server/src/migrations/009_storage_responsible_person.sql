ALTER TABLE storages
  ADD COLUMN IF NOT EXISTS created_by_sub TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person_type TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person_sub TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person_name TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person_email TEXT,
  ADD COLUMN IF NOT EXISTS responsible_person_phone TEXT;

ALTER TABLE storages
  ADD CONSTRAINT storages_responsible_person_type_check
  CHECK (responsible_person_type IS NULL OR responsible_person_type IN ('tunnus', 'external'));
