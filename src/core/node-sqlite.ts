// Node-only: adapts node:sqlite to the D1-shaped SqlDatabase. Never imported by the Worker.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDatabase, SqlStatement, SqlValue } from "./db";

export interface NodeSqliteDatabase extends SqlDatabase {
  exec(sql: string): void;
  /** Synchronous variants, for code that must run inside an explicit transaction. */
  selectSync(sql: string, ...values: SqlValue[]): Record<string, unknown>[];
  runSync(sql: string, ...values: SqlValue[]): { changes: number; lastInsertRowid: number };
  /** Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolling back on error. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

class NodeStatement implements SqlStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]): SqlStatement {
    return new NodeStatement(this.db, this.sql, values.map((v) => v ?? null));
  }

  private params(): SQLInputValue[] {
    return this.values;
  }

  allSync<T>(): T[] {
    // Spread drops the null prototype node:sqlite gives rows.
    return this.db
      .prepare(this.sql)
      .all(...this.params())
      .map((row) => ({ ...row }) as T);
  }

  runSync(): { meta: { changes: number } } {
    return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.params()).changes) } };
  }

  /** D1 semantics inside batch(): statements returning columns yield rows, the rest yield meta. */
  executeSync(): unknown {
    return this.db.prepare(this.sql).columns().length > 0 ? { results: this.allSync() } : this.runSync();
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.allSync<T>() };
  }

  async first<T>(): Promise<T | null> {
    return this.allSync<T>()[0] ?? null;
  }

  async run() {
    return this.runSync();
  }
}

/**
 * Opens (or creates) a SQLite file. WAL and a busy timeout let several local
 * Claude Code sessions on the same machine share one file safely.
 */
export function openNodeSqlite(path: string): NodeSqliteDatabase {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  return {
    prepare: (sql) => new NodeStatement(db, sql),
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => (s as NodeStatement).executeSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec: (sql) => db.exec(sql),
    selectSync: (sql, ...values) => new NodeStatement(db, sql, values).allSync(),
    runSync: (sql, ...values) => {
      const r = db.prepare(sql).run(...values.map((v) => v ?? null));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}
