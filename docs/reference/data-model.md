# Data model

Schema: `migrations/0001_init.sql`. It is portable SQLite: it runs the same on D1 and on `node:sqlite`.

| Table | Key | Contents |
| --- | --- | --- |
| `tokens` | `id` | Machine tokens: `name`, `token_hash` (SHA-256, unique), `created_at`, `revoked_at` |
| `agents` | `id` (`repo#machine`) | `repo`, `machine`, `kind` (`codespace`/`local`), `codespace_name`, `created_at`, `last_seen_at` |
| `memories` | integer `id`; unique `(repo, source_id)` | Memories published by the agents, masked: `type`, `title`, `content`, `topic_key`, dates |
| `memories_fts` | `rowid` = `memories.id` | FTS5 index (external content) over `title` and `content`, maintained by triggers |
| `checkpoints` | `id` | `agent_id`, `repo`, `branch`, `commit_sha`, `summary`, `created_at` |
| `tasks` | `id` | `title`, `repos` (JSON), `orchestrator`, `status`, `state` (graph JSON), `version`, `lease_owner`, `lease_expires_at`, dates |
| `messages` | `id` | `task_id`, `from_agent`, `from_repo`, `to_repo`, `kind`, `body`, `created_at`, `acked_at`, `acked_by` |

Indexes: `agents(repo, last_seen_at)`, `checkpoints(repo, created_at)`, `messages(to_repo, acked_at, created_at)`.

## Local memory (only on your machine)

Schema: `src/memory/schema.ts`. It lives in the same `localDbPath` file, never in D1.

| Table | Contents |
| --- | --- |
| `mem_sessions` | Claude Code sessions: `id` (session_id), `project`, `directory`, `started_at`, `ended_at`, `summary` |
| `mem_observations` | Memories: `sync_id` (stable id for the backend), `session_id`, `project`, `scope`, `type`, `title`, `content`, `topic_key`, `normalized_hash`, `revision_count`, `duplicate_count`, `pinned`, dates, `deleted_at`, `change_seq` |
| `mem_observation_versions` | Previous versions of each memory (from a topic upsert or `orchestra_update`) |
| `mem_observations_fts` | FTS5 index over title and content, maintained by triggers |
| `mem_sync_cursors` | Last `change_seq` confirmed by each backend (`syncTarget`) |

Each write that must be replicated takes `change_seq = max + 1` inside its transaction. So the sync order does not depend on the clock.

## Concurrency

D1 processes one query at a time per database, so each conditional `UPDATE` is atomic. Every concurrency rule is expressed in a single statement:

| Operation | Guarantee | Statement |
| --- | --- | --- |
| Acquire lease | Only if it is free, yours, or expired, and the task is open | `tryAcquireLease` in `repositories/tasks.ts` |
| Save task | Only the current lease owner, with the expected version; increments the version | `tryUpdateTask` |
| Close task | Moving to `done`/`cancelled` releases the lease | `tryUpdateTask` |
| Memory upsert | Does not replace a newer copy | `upsertMemoryStatement` |
| Memory withdrawal | Does not delete a newer copy | `deleteMemoryStatement` |
| Message ack | Only once, and only by the recipient repo | `tryAck` |

If the condition is not met, the statement affects 0 rows and the service turns that into `conflict` or `not_found` with a message that explains the cause.

## Dates

All dates the backend generates are ISO 8601 in UTC (`toISOString()`), so comparing strings is the same as comparing dates. Memory dates come from each machine's local memory.
