-- Field Commander operations schema.
CREATE TABLE IF NOT EXISTS fc_events (
  workspace TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  operation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace,entity_id,revision),
  UNIQUE(workspace,operation_id)
);
CREATE INDEX IF NOT EXISTS fc_events_latest ON fc_events(workspace,entity_id,revision DESC);
CREATE TABLE IF NOT EXISTS fc_members (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('dispatcher','field','viewer')),
  key_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  PRIMARY KEY(workspace,id),
  UNIQUE(workspace,key_hash)
);
CREATE TABLE IF NOT EXISTS fc_cache (
  workspace TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(workspace,key)
);
CREATE TABLE IF NOT EXISTS fc_quota (
  workspace TEXT NOT NULL,
  key TEXT NOT NULL,
  used INTEGER NOT NULL,
  minute INTEGER NOT NULL DEFAULT 0,
  minute_used INTEGER NOT NULL DEFAULT 0,
  second INTEGER NOT NULL DEFAULT 0,
  second_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace,key)
);
