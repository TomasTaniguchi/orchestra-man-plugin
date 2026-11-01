import type { MemoryHit } from "../contract";
import type { SqlDatabase, SqlStatement } from "../db";
import { type Row, optStr, str } from "./rows";

export interface MemoryRow {
  repo: string;
  sourceId: string;
  agentId: string;
  type: string;
  title: string;
  content: string;
  topicKey: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One upsert per memory (11 bound parameters, far below D1's 100).
 * An older copy never overwrites a newer one, so replays and out-of-order syncs are safe.
 */
export const upsertMemoryStatement = (db: SqlDatabase, m: MemoryRow, now: string): SqlStatement =>
  db
    .prepare(
      `INSERT INTO memories (repo, source_id, agent_id, type, title, content, topic_key, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo, source_id) DO UPDATE SET agent_id = excluded.agent_id, type = excluded.type,
         title = excluded.title, content = excluded.content, topic_key = excluded.topic_key,
         updated_at = excluded.updated_at, synced_at = excluded.synced_at
       WHERE excluded.updated_at >= memories.updated_at`,
    )
    .bind(m.repo, m.sourceId, m.agentId, m.type, m.title, m.content, m.topicKey, m.createdAt, m.updatedAt, now);

/** Removes a memory unless the backend already holds a newer copy. */
export const deleteMemoryStatement = (
  db: SqlDatabase,
  m: { repo: string; sourceId: string; updatedAt: string },
): SqlStatement =>
  db
    .prepare("DELETE FROM memories WHERE repo = ? AND source_id = ? AND updated_at <= ?")
    .bind(m.repo, m.sourceId, m.updatedAt);

/**
 * Turns free text into a safe FTS5 query: every word becomes a quoted prefix term, OR-ed so a
 * natural-language goal still recalls partial matches (bm25 ranks the best ones first).
 * Quoting means user input can never produce FTS syntax errors. Returns null when nothing is searchable.
 */
export function toFtsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 10) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null;
}

const toHit = (row: Row): MemoryHit => ({
  repo: str(row, "repo"),
  sourceId: str(row, "source_id"),
  type: str(row, "type"),
  title: str(row, "title"),
  snippet: str(row, "snippet"),
  topicKey: optStr(row, "topic_key"),
  updatedAt: str(row, "updated_at"),
});

export async function searchMemories(
  db: SqlDatabase,
  query: { q: string; repo?: string | undefined; limit: number },
): Promise<MemoryHit[]> {
  const match = toFtsQuery(query.q);
  if (!match) return [];
  const repo = query.repo ?? null;
  const { results } = await db
    .prepare(
      `SELECT m.repo, m.source_id, m.type, m.title, m.topic_key, m.updated_at,
              snippet(memories_fts, 1, '[', ']', '…', 24) AS snippet
       FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
       WHERE memories_fts MATCH ? AND (? IS NULL OR m.repo = ?)
       ORDER BY bm25(memories_fts), m.updated_at DESC
       LIMIT ?`,
    )
    .bind(match, repo, repo, query.limit)
    .all<Row>();
  return results.map(toHit);
}
