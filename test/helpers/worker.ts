import { createWorker, type Env } from "../../src/worker/index";
import { manualClock, migratedDb, sequentialIds } from "./fixtures";

export const ADMIN_TOKEN = "admin-secret";
export const BASE_URL = "https://orchestra.test";

/** Runs the real Worker in-process over a migrated in-memory SQLite (the D1 stand-in). */
export function inProcessWorker(options: { githubFetch?: typeof fetch; env?: Partial<Env> } = {}) {
  const db = migratedDb();
  const clock = manualClock();
  const worker = createWorker({ clock, ids: sequentialIds(), fetch: options.githubFetch ?? (() => Promise.reject(new Error("no network"))) });
  const env: Env = { DB: db, ADMIN_TOKEN, ...options.env };
  const fetchFn: typeof fetch = async (input, init) => worker.fetch(new Request(input, init), env);
  return { db, clock, worker, env, fetch: fetchFn };
}

/** Creates an agent token through the admin API, like a user would with curl. */
export async function issueToken(fetchFn: typeof fetch, name = "test-machine"): Promise<string> {
  const response = await fetchFn(`${BASE_URL}/v1/admin/tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.status !== 201) throw new Error(`token creation failed: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}
