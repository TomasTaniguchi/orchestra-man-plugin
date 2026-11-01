import { type Clock, type Ids, randomIds, systemClock } from "../core/clock";
import { LIMITS } from "../core/contract";
import type { SqlDatabase } from "../core/db";
import { OrchestraError } from "../core/errors";
import { findRoute } from "../core/routes";
import { DEFAULT_RETENTION, OrchestraService, type Retention } from "../core/service";
import { authorize } from "./auth";
import { githubWaker } from "./github";
import { HANDLERS } from "./handlers";

export interface Env {
  DB: SqlDatabase;
  /** Secret. Lets you create and revoke per-machine tokens. */
  ADMIN_TOKEN?: string;
  /** Secret, optional. Classic PAT with `codespace` scope; enables POST /v1/wake. */
  GITHUB_TOKEN?: string;
  RETENTION_ACKED_MESSAGE_DAYS?: string;
  RETENTION_UNREAD_MESSAGE_DAYS?: string;
  RETENTION_CHECKPOINT_DAYS?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerDeps {
  clock: Clock;
  ids: Ids;
  fetch: typeof fetch;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const errorResponse = (error: OrchestraError): Response =>
  json(error.status, { error: { code: error.code, message: error.message } });

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET") return undefined;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.requestBodyMaxBytes) throw new OrchestraError("bad_request", "request body too large");
  const text = await request.text();
  if (text.length > LIMITS.requestBodyMaxBytes) throw new OrchestraError("bad_request", "request body too large");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new OrchestraError("bad_request", "body is not valid JSON");
  }
}

const positiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const retentionFrom = (env: Env): Retention => ({
  ackedMessageDays: positiveInt(env.RETENTION_ACKED_MESSAGE_DAYS, DEFAULT_RETENTION.ackedMessageDays),
  unreadMessageDays: positiveInt(env.RETENTION_UNREAD_MESSAGE_DAYS, DEFAULT_RETENTION.unreadMessageDays),
  checkpointDays: positiveInt(env.RETENTION_CHECKPOINT_DAYS, DEFAULT_RETENTION.checkpointDays),
});

/** Builds the Worker with injectable time, ids and fetch, so tests can run it in-process. */
export function createWorker(overrides: Partial<WorkerDeps> = {}) {
  const deps: WorkerDeps = { clock: systemClock, ids: randomIds, fetch: (...a) => fetch(...a), ...overrides };
  const serviceFor = (env: Env) =>
    new OrchestraService({
      db: env.DB,
      clock: deps.clock,
      ids: deps.ids,
      waker: env.GITHUB_TOKEN ? githubWaker(env.GITHUB_TOKEN, deps.fetch) : undefined,
    });

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        const url = new URL(request.url);
        const match = findRoute(request.method, url.pathname);
        if (!match) throw new OrchestraError("not_found", `no route for ${request.method} ${url.pathname}`);
        const service = serviceFor(env);
        await authorize(request, match.def.auth, {
          adminToken: env.ADMIN_TOKEN,
          isValidAgentToken: (token) => service.isValidToken(token),
        });
        const result = await HANDLERS[match.operation](service, {
          params: match.params,
          query: Object.fromEntries(url.searchParams),
          body: await readBody(request),
        });
        return json(match.def.status, result);
      } catch (error) {
        if (error instanceof OrchestraError) return errorResponse(error);
        console.error("orchestra-man: unhandled error", error);
        return errorResponse(new OrchestraError("internal", "internal error"));
      }
    },

    async scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
      ctx.waitUntil(
        serviceFor(env)
          .maintenance(retentionFrom(env))
          .then((result) => console.log("orchestra-man: maintenance", JSON.stringify(result))),
      );
    },
  };
}

export default createWorker();
