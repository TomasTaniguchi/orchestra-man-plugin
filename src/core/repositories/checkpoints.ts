import type { Checkpoint } from "../contract";
import type { SqlDatabase, SqlStatement } from "../db";
import { type Row, str } from "./rows";

const toCheckpoint = (row: Row): Checkpoint => ({
  id: str(row, "id"),
  agentId: str(row, "agent_id"),
  repo: str(row, "repo"),
  branch: str(row, "branch"),
  commitSha: str(row, "commit_sha"),
  summary: str(row, "summary"),
  createdAt: str(row, "created_at"),
});

export const insertCheckpoint = (db: SqlDatabase, c: Checkpoint) =>
  db
    .prepare(
      `INSERT INTO checkpoints (id, agent_id, repo, branch, commit_sha, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(c.id, c.agentId, c.repo, c.branch, c.commitSha, c.summary, c.createdAt)
    .run();

/** Latest checkpoint per repository, optionally for one repository. */
export async function latestCheckpoints(db: SqlDatabase, repo: string | null): Promise<Checkpoint[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY repo ORDER BY created_at DESC, id DESC) AS rn
         FROM checkpoints WHERE (? IS NULL OR repo = ?)
       ) WHERE rn = 1 ORDER BY repo`,
    )
    .bind(repo, repo)
    .all<Row>();
  return results.map(toCheckpoint);
}

/** Deletes checkpoints older than `before`, always keeping the latest one of each repo. */
export const pruneCheckpointsStatement = (db: SqlDatabase, before: string): SqlStatement =>
  db
    .prepare(
      `DELETE FROM checkpoints WHERE created_at < ? AND id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY repo ORDER BY created_at DESC, id DESC) AS rn FROM checkpoints
         ) WHERE rn = 1
       )`,
    )
    .bind(before);
