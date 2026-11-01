import { changesOf, type SqlDatabase } from "../db";

export const insertToken = (db: SqlDatabase, t: { id: string; name: string; hash: string; createdAt: string }) =>
  db
    .prepare("INSERT INTO tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(t.id, t.name, t.hash, t.createdAt)
    .run();

export async function isActiveTokenHash(db: SqlDatabase, hash: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM tokens WHERE token_hash = ? AND revoked_at IS NULL").bind(hash).first();
  return row !== null;
}

export async function revokeToken(db: SqlDatabase, id: string, now: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, id)
    .run();
  return changesOf(result) === 1;
}
