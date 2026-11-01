/**
 * The subset of the Cloudflare D1 API that data code depends on.
 * A real `D1Database` satisfies it, and so does `openNodeSqlite` (local mode and tests),
 * which is what lets the Worker and local mode share every SQL statement.
 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** Runs statements sequentially inside one transaction. Counts as one D1 query. */
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

export const changesOf = (result: unknown): number =>
  (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
