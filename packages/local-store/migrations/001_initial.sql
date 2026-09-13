PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workstream_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended', 'interrupted')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (project_id, workstream_id) REFERENCES workstreams(project_id, id),
  UNIQUE (project_id, workstream_id, id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workstream_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  occurred_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (project_id, workstream_id, session_id) REFERENCES sessions(project_id, workstream_id, id),
  UNIQUE (session_id, sequence)
);

CREATE TABLE sync_outbox (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT
);

CREATE TABLE sync_cursors (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  cursor TEXT NOT NULL
);

CREATE INDEX workstreams_recent ON workstreams(project_id, updated_at DESC);
CREATE INDEX events_workstream ON events(project_id, workstream_id, occurred_at);
