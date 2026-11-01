import type { NodeSqliteDatabase } from "../../src/core/node-sqlite";
import type { Remote } from "../../src/core/remote";
import { OrchestraService } from "../../src/core/service";
import { httpRemote } from "../../src/plugin/http-remote";
import { manualClock, migratedDb, sequentialIds } from "./fixtures";
import { BASE_URL, inProcessWorker, issueToken } from "./worker";

export type BackendKind = "d1" | "local";

export interface Backend {
  kind: BackendKind;
  clock: ReturnType<typeof manualClock>;
  /** What every agent talks to: the Worker over HTTP, or the local service directly. */
  remote: Remote;
  /** The underlying database, to assert on what was actually stored. */
  db: NodeSqliteDatabase;
}

/** The two production backends, each over a fresh migrated database with a shared deterministic clock. */
export async function makeBackend(kind: BackendKind): Promise<Backend> {
  const clock = manualClock();
  if (kind === "local") {
    const db = migratedDb();
    return { kind, clock, db, remote: new OrchestraService({ db, clock, ids: sequentialIds() }) };
  }
  const worker = inProcessWorker({ clock });
  const token = await issueToken(worker.fetch);
  return { kind, clock, db: worker.db, remote: httpRemote({ baseUrl: BASE_URL, token, fetch: worker.fetch }) };
}

/** Every text value stored anywhere in the database, for "nothing sensitive leaked" assertions. */
export async function dumpAllText(db: NodeSqliteDatabase): Promise<string> {
  const tables = ["agents", "memories", "checkpoints", "tasks", "messages"];
  const rows = await Promise.all(tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  return JSON.stringify(rows.map((r) => r.results));
}
