import type { Agent } from "../contract";
import type { SqlDatabase } from "../db";
import { type Row, optStr, str } from "./rows";

const toAgent = (row: Row): Agent => ({
  id: str(row, "id"),
  repo: str(row, "repo"),
  machine: str(row, "machine"),
  kind: str(row, "kind") as Agent["kind"],
  codespaceName: optStr(row, "codespace_name"),
  createdAt: str(row, "created_at"),
  lastSeenAt: str(row, "last_seen_at"),
});

/** Inserts the agent or refreshes its heartbeat and location. */
export const upsertAgent = (db: SqlDatabase, agent: Omit<Agent, "createdAt" | "lastSeenAt">, now: string) =>
  db
    .prepare(
      `INSERT INTO agents (id, repo, machine, kind, codespace_name, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET repo = excluded.repo, machine = excluded.machine, kind = excluded.kind,
         codespace_name = excluded.codespace_name, last_seen_at = excluded.last_seen_at`,
    )
    .bind(agent.id, agent.repo, agent.machine, agent.kind, agent.codespaceName, now, now)
    .run();

export async function findAgent(db: SqlDatabase, id: string): Promise<Agent | null> {
  const row = await db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<Row>();
  return row ? toAgent(row) : null;
}

export async function listAgents(db: SqlDatabase): Promise<Agent[]> {
  const { results } = await db.prepare("SELECT * FROM agents ORDER BY repo, last_seen_at DESC").all<Row>();
  return results.map(toAgent);
}

/** The most recently seen agent of `repo` that runs in a codespace. */
export async function latestCodespaceAgent(db: SqlDatabase, repo: string): Promise<Agent | null> {
  const row = await db
    .prepare(
      `SELECT * FROM agents WHERE repo = ? AND codespace_name IS NOT NULL
       ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .bind(repo)
    .first<Row>();
  return row ? toAgent(row) : null;
}
