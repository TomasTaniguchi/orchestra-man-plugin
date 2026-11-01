// Node-only: applies migrations/*.sql to a local SQLite file. The Worker uses wrangler instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NodeSqliteDatabase } from "./node-sqlite";

export interface Migration {
  name: string;
  sql: string;
}

export const loadMigrations = (dir: string): Migration[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));

/** Applies pending migrations, each in its own transaction. Returns the names applied. */
export function applyMigrations(db: NodeSqliteDatabase, migrations: Migration[], now: string): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS _orchestra_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied: string[] = [];
  for (const m of migrations) {
    db.transaction(() => {
      // Re-checked inside the transaction so concurrent sessions never apply a migration twice.
      if (db.selectSync("SELECT 1 FROM _orchestra_migrations WHERE name = ?", m.name).length === 0) {
        db.exec(m.sql);
        db.runSync("INSERT INTO _orchestra_migrations (name, applied_at) VALUES (?, ?)", m.name, now);
        applied.push(m.name);
      }
    });
  }
  return applied;
}
