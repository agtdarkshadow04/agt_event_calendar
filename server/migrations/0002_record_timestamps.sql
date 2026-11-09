-- Every content and key-value table records when rows were created and last
-- updated (AGT web app spec DATA-8). Existing rows take their best-known time.

ALTER TABLE images ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE images SET updated_at = created_at;

ALTER TABLE settings ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE settings SET created_at = updated_at;

ALTER TABLE app_secrets ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE app_secrets ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE app_secrets SET
  created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
