-- Log store (AGT web app spec §13): the server log and the audit log, kept in
-- their own SQLite file so backups and restores never touch them.
-- `seq` orders entries (newest first) and backs the paging cursors; AUTOINCREMENT
-- keeps it from being reused after a clear, so the "seen" marker stays valid.

CREATE TABLE log_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE server_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'fatal')),
  level_value INTEGER NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  request_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX server_log_at ON server_log (at);
CREATE INDEX server_log_level ON server_log (level_value);
CREATE INDEX server_log_source ON server_log (source);
CREATE INDEX server_log_request_id ON server_log (request_id);

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'anonymous')),
  actor TEXT,
  ip_hash TEXT,
  client TEXT NOT NULL CHECK (client IN ('web', 'api')),
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'rate_limited', 'failure')),
  status_code INTEGER NOT NULL,
  request_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_at ON audit_log (at);
CREATE INDEX audit_log_actor_type ON audit_log (actor_type);
CREATE INDEX audit_log_action ON audit_log (action);
CREATE INDEX audit_log_outcome ON audit_log (outcome);
CREATE INDEX audit_log_target ON audit_log (target_type, target_id);
CREATE INDEX audit_log_target_id ON audit_log (target_id);
CREATE INDEX audit_log_request_id ON audit_log (request_id);
CREATE INDEX audit_log_coalesce ON audit_log (action, outcome, status_code, ip_hash, last_at);
