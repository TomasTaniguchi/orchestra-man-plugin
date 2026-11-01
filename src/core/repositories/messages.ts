import type { Message } from "../contract";
import { changesOf, type SqlDatabase, type SqlStatement } from "../db";
import { type Row, optStr, str } from "./rows";

const toMessage = (row: Row): Message => ({
  id: str(row, "id"),
  taskId: optStr(row, "task_id"),
  fromAgent: str(row, "from_agent"),
  fromRepo: str(row, "from_repo"),
  toRepo: str(row, "to_repo"),
  kind: str(row, "kind") as Message["kind"],
  body: str(row, "body"),
  createdAt: str(row, "created_at"),
  ackedAt: optStr(row, "acked_at"),
  ackedBy: optStr(row, "acked_by"),
});

export const insertMessage = (db: SqlDatabase, m: Message) =>
  db
    .prepare(
      `INSERT INTO messages (id, task_id, from_agent, from_repo, to_repo, kind, body, created_at, acked_at, acked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(m.id, m.taskId, m.fromAgent, m.fromRepo, m.toRepo, m.kind, m.body, m.createdAt)
    .run();

export async function findMessage(db: SqlDatabase, id: string): Promise<Message | null> {
  const row = await db.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<Row>();
  return row ? toMessage(row) : null;
}

export async function inbox(db: SqlDatabase, repo: string, includeAcked: boolean): Promise<Message[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM messages WHERE to_repo = ? AND (? = 1 OR acked_at IS NULL)
       ORDER BY created_at, id LIMIT 100`,
    )
    .bind(repo, includeAcked ? 1 : 0)
    .all<Row>();
  return results.map(toMessage);
}

/** Acknowledges a message once, and only on behalf of the recipient repository. */
export async function tryAck(
  db: SqlDatabase,
  args: { id: string; repo: string; agentId: string; now: string },
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE messages SET acked_at = ?, acked_by = ? WHERE id = ? AND to_repo = ? AND acked_at IS NULL")
    .bind(args.now, args.agentId, args.id, args.repo)
    .run();
  return changesOf(result) === 1;
}

/** Acknowledged messages expire after `ackedBefore`; unread ones after `createdBefore`. */
export const pruneMessagesStatement = (db: SqlDatabase, ackedBefore: string, createdBefore: string): SqlStatement =>
  db
    .prepare("DELETE FROM messages WHERE (acked_at IS NOT NULL AND acked_at < ?) OR created_at < ?")
    .bind(ackedBefore, createdBefore);
