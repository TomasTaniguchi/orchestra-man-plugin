-- orchestra-man schema. Applied by `wrangler d1 migrations apply` (Worker)
-- and by src/core/migrations.ts (local SQLite mode). Keep it portable SQLite.

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  machine TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('codespace', 'local')),
  codespace_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX agents_by_repo ON agents (repo, last_seen_at);

CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  source_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE (repo, source_id)
);

CREATE VIRTUAL TABLE memories_fts USING fts5 (
  title, content, content = 'memories', content_rowid = 'id'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO memories_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX checkpoints_by_repo ON checkpoints (repo, created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  repos TEXT NOT NULL,
  orchestrator TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  from_agent TEXT NOT NULL,
  from_repo TEXT NOT NULL,
  to_repo TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acked_at TEXT,
  acked_by TEXT
);
CREATE INDEX messages_inbox ON messages (to_repo, acked_at, created_at);
