import { join } from "node:path";
import type { Clock, Ids } from "../../src/core/clock";
import { applyMigrations, loadMigrations } from "../../src/core/migrations";
import { type NodeSqliteDatabase, openNodeSqlite } from "../../src/core/node-sqlite";
import { OrchestraService, type Waker } from "../../src/core/service";

export const MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations");
export const START = "2026-10-31T12:00:00.000Z";

/** A clock that only moves when told to, so timestamps in snapshots are stable. */
export function manualClock(start = START): Clock & { advance(seconds: number): void } {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (seconds) => {
      current += seconds * 1000;
    },
  };
}

export function sequentialIds(): Ids {
  const counters = new Map<string, number>();
  let secrets = 0;
  return {
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${String(n).padStart(4, "0")}`;
    },
    secret: () => `om_test_secret_${++secrets}`,
  };
}

export function migratedDb(): NodeSqliteDatabase {
  const db = openNodeSqlite(":memory:");
  applyMigrations(db, loadMigrations(MIGRATIONS_DIR), START);
  return db;
}

export function testService(options: { waker?: Waker } = {}) {
  const db = migratedDb();
  const clock = manualClock();
  const ids = sequentialIds();
  const service = new OrchestraService({ db, clock, ids, waker: options.waker });
  return { db, clock, ids, service };
}

export const agentA = { id: "acme/api#laptop", repo: "acme/api", machine: "laptop", kind: "local" as const };
export const agentB = {
  id: "acme/billing#cs-billing",
  repo: "acme/billing",
  machine: "cs-billing",
  kind: "codespace" as const,
  codespaceName: "cs-billing",
};
