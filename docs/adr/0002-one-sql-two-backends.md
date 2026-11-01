# 0002. One SQL, two backends

**Status**: accepted (2026-10-31)

## Context

Two modes were requested: D1 through a Worker (shared across machines) and local SQLite (no cloud). Implementing the logic twice would duplicate delicate rules: leases, versions, idempotency.

## Decision

- `SqlDatabase` (`src/core/db.ts`) is the subset of the D1 API that we use. The D1 binding satisfies it as is; `openNodeSqlite` implements it on top of `node:sqlite`.
- Repositories and `OrchestraService` depend only on that interface.
- A single schema (`migrations/`) is applied by wrangler to D1 and by `applyMigrations` to the local SQLite.
- The Worker is an HTTP adapter over the same service.

## Consequences

- Every business rule exists only once.
- The schema must be portable SQLite (it is: FTS5, upsert and window functions exist in both).
- The tests run the real Worker in process on `node:sqlite`, and the e2e scenario requires identical results on both backends. The migration was also verified against wrangler's local D1 (workerd).
- Local mode only coordinates processes on the same machine (a file with WAL and `busy_timeout`).
