import type { Migration } from "../core/migrations";

/**
 * Local memory store schema (node:sqlite only, never sent to D1). It lives in the same local
 * file as the local backend; table names do not overlap with migrations/*.sql.
 */
export const MEMORY_MIGRATIONS: Migration[] = [
  {
    name: "memory_0001_init",
    sql: `
CREATE TABLE mem_sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  directory TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);
CREATE INDEX mem_sessions_by_project ON mem_sessions (project, started_at);

CREATE TABLE mem_observations (
  id INTEGER PRIMARY KEY,
  sync_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  project TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'personal')),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  normalized_hash TEXT NOT NULL,
  revision_count INTEGER NOT NULL DEFAULT 1,
  duplicate_count INTEGER NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  -- Monotonic per database: set to max+1 on every replicated change, inside the write transaction.
  change_seq INTEGER NOT NULL
);
CREATE INDEX mem_obs_recent ON mem_observations (project, scope, deleted_at, updated_at);
CREATE INDEX mem_obs_topic ON mem_observations (project, scope, topic_key);
CREATE INDEX mem_obs_dedupe ON mem_observations (normalized_hash, project, scope);
CREATE INDEX mem_obs_changes ON mem_observations (project, change_seq);

CREATE TABLE mem_observation_versions (
  id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX mem_versions_by_obs ON mem_observation_versions (observation_id, revision);

CREATE VIRTUAL TABLE mem_observations_fts USING fts5 (
  title, content, content = 'mem_observations', content_rowid = 'id'
);
CREATE TRIGGER mem_obs_ai AFTER INSERT ON mem_observations BEGIN
  INSERT INTO mem_observations_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER mem_obs_ad AFTER DELETE ON mem_observations BEGIN
  INSERT INTO mem_observations_fts (mem_observations_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER mem_obs_au AFTER UPDATE OF title, content ON mem_observations BEGIN
  INSERT INTO mem_observations_fts (mem_observations_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO mem_observations_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;

-- Incremental replication cursor per backend: the last change_seq acknowledged by that backend.
CREATE TABLE mem_sync_cursors (
  target TEXT NOT NULL,
  project TEXT NOT NULL,
  change_seq INTEGER NOT NULL,
  PRIMARY KEY (target, project)
);
`,
  },
];
