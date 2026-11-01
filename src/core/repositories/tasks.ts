import type { Task, TaskState, TaskStatus } from "../contract";
import { changesOf, type SqlDatabase, type SqlStatement } from "../db";
import { type Row, json, num, optStr, str } from "./rows";

const toTask = (row: Row): Task => ({
  id: str(row, "id"),
  title: str(row, "title"),
  repos: json<string[]>(row, "repos"),
  orchestrator: str(row, "orchestrator"),
  status: str(row, "status") as TaskStatus,
  state: json<TaskState>(row, "state"),
  version: num(row, "version"),
  leaseOwner: optStr(row, "lease_owner"),
  leaseExpiresAt: optStr(row, "lease_expires_at"),
  createdAt: str(row, "created_at"),
  updatedAt: str(row, "updated_at"),
});

export const insertTask = (db: SqlDatabase, t: Task) =>
  db
    .prepare(
      `INSERT INTO tasks (id, title, repos, orchestrator, status, state, version, lease_owner, lease_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.id,
      t.title,
      JSON.stringify(t.repos),
      t.orchestrator,
      t.status,
      JSON.stringify(t.state),
      t.version,
      t.leaseOwner,
      t.leaseExpiresAt,
      t.createdAt,
      t.updatedAt,
    )
    .run();

export async function findTask(db: SqlDatabase, id: string): Promise<Task | null> {
  const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Row>();
  return row ? toTask(row) : null;
}

/**
 * Takes or renews the lease when it is free, already ours, or expired.
 * A single conditional UPDATE: D1 runs one query at a time, so this is atomic.
 */
export async function tryAcquireLease(
  db: SqlDatabase,
  args: { id: string; agentId: string; now: string; expiresAt: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE tasks SET lease_owner = ?, lease_expires_at = ?
       WHERE id = ? AND status = 'open' AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at < ?)`,
    )
    .bind(args.agentId, args.expiresAt, args.id, args.agentId, args.now)
    .run();
  return changesOf(result) === 1;
}

/**
 * Optimistic, lease-guarded write: succeeds only for the current lease holder at the expected version.
 * Closing a task (done/cancelled) releases the lease.
 */
export async function tryUpdateTask(
  db: SqlDatabase,
  args: { id: string; agentId: string; version: number; state: TaskState; status: TaskStatus; now: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE tasks SET state = ?, status = ?, version = version + 1, updated_at = ?,
         lease_owner = CASE WHEN ? = 'open' THEN lease_owner END,
         lease_expires_at = CASE WHEN ? = 'open' THEN lease_expires_at END
       WHERE id = ? AND version = ? AND status = 'open' AND lease_owner = ? AND lease_expires_at >= ?`,
    )
    .bind(JSON.stringify(args.state), args.status, args.now, args.status, args.status, args.id, args.version, args.agentId, args.now)
    .run();
  return changesOf(result) === 1;
}

export const releaseExpiredLeasesStatement = (db: SqlDatabase, now: string): SqlStatement =>
  db.prepare("UPDATE tasks SET lease_owner = NULL, lease_expires_at = NULL WHERE lease_expires_at < ?").bind(now);
