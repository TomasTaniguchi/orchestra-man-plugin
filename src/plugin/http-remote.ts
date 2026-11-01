import { ErrorBody } from "../core/contract";
import { codeForStatus, OrchestraError } from "../core/errors";
import type { Remote } from "../core/remote";
import { buildPath, type Operation, ROUTES } from "../core/routes";

export interface HttpRemoteOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface CallInput {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** The Worker as a Remote. Packs each call into the route from core/routes.ts (inverse of worker/handlers.ts). */
export function httpRemote({ baseUrl, token, fetch: fetchFn = fetch, timeoutMs = 15_000 }: HttpRemoteOptions): Remote {
  async function call<T>(operation: Operation, input: CallInput = {}): Promise<T> {
    const def = ROUTES[operation];
    const url = new URL(buildPath(def.path, input.params), baseUrl);
    for (const [key, value] of Object.entries(input.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: def.method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new OrchestraError("unavailable", `cannot reach ${url.origin}: ${(error as Error).message}`);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return payload as T;
    const parsed = ErrorBody.safeParse(payload);
    throw new OrchestraError(
      parsed.success ? parsed.data.error.code : codeForStatus(response.status),
      parsed.success ? parsed.data.error.message : `HTTP ${response.status} from ${def.method} ${url.pathname}`,
    );
  }

  return {
    health: () => call("health"),
    registerAgent: (body) => call("registerAgent", { body }),
    listAgents: () => call("listAgents"),
    wake: (repo) => call("wake", { body: { repo } }),
    upsertMemories: (body) => call("upsertMemories", { body }),
    searchMemories: ({ q, repo, limit }) =>
      call("searchMemories", { query: { q, repo, limit: limit === undefined ? undefined : String(limit) } }),
    saveCheckpoint: (body) => call("saveCheckpoint", { body }),
    latestCheckpoints: (repo) => call("latestCheckpoints", { query: { repo } }),
    createTask: (body) => call("createTask", { body }),
    getTask: (id) => call("getTask", { params: { id } }),
    acquireLease: (id, body) => call("acquireLease", { params: { id }, body }),
    updateTask: (id, body) => call("updateTask", { params: { id }, body }),
    sendMessage: (body) => call("sendMessage", { body }),
    inbox: ({ repo, includeAcked }) => call("inbox", { query: { repo, includeAcked } }),
    ackMessage: (id, body) => call("ackMessage", { params: { id }, body }),
  };
}
