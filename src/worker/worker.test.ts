import { describe, expect, it } from "vitest";
import { agentB } from "../../test/helpers/fixtures";
import { ADMIN_TOKEN, BASE_URL, inProcessWorker, issueToken } from "../../test/helpers/worker";
import { buildPath, findRoute, matchPath } from "../core/routes";
import { secretsEqual } from "./auth";
import { githubWaker } from "./github";
import { retentionFrom } from "./index";

const call = (fetchFn: typeof fetch, method: string, path: string, token?: string, body?: unknown) =>
  fetchFn(`${BASE_URL}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });

describe("routes", () => {
  it("builds and matches encoded params", () => {
    expect(buildPath("/v1/tasks/{id}/lease", { id: "a/b" })).toBe("/v1/tasks/a%2Fb/lease");
    expect(matchPath("/v1/tasks/{id}/lease", "/v1/tasks/a%2Fb/lease")).toEqual({ id: "a/b" });
    expect(findRoute("PUT", "/v1/tasks/x")?.operation).toBe("updateTask");
    expect(findRoute("DELETE", "/v1/tasks/x")).toBeNull();
  });
});

describe("worker http", () => {
  it("serves health without auth", async () => {
    const { fetch } = inProcessWorker();
    const response = await call(fetch, "GET", "/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "orchestra-man", version: "0.1.0" });
  });

  it("requires a valid agent token and rejects revoked ones", async () => {
    const { fetch } = inProcessWorker();
    expect((await call(fetch, "GET", "/v1/agents")).status).toBe(401);
    expect((await call(fetch, "GET", "/v1/agents", ADMIN_TOKEN)).status).toBe(401);
    const created = await (await call(fetch, "POST", "/v1/admin/tokens", ADMIN_TOKEN, { name: "laptop" })).json();
    expect((await call(fetch, "GET", "/v1/agents", created.token)).status).toBe(200);
    expect((await call(fetch, "POST", `/v1/admin/tokens/${created.id}/revoke`, ADMIN_TOKEN)).status).toBe(200);
    expect((await call(fetch, "GET", "/v1/agents", created.token)).status).toBe(401);
  });

  it("protects admin routes and reports a missing ADMIN_TOKEN as unavailable", async () => {
    const { fetch } = inProcessWorker();
    const token = await issueToken(fetch);
    expect((await call(fetch, "POST", "/v1/admin/tokens", token, { name: "x" })).status).toBe(401);
    const noAdmin = inProcessWorker({ env: { ADMIN_TOKEN: undefined } });
    expect((await call(noAdmin.fetch, "POST", "/v1/admin/tokens", "anything", { name: "x" })).status).toBe(503);
  });

  it("maps errors to the contract error body", async () => {
    const { fetch } = inProcessWorker();
    const token = await issueToken(fetch);
    const notFound = await call(fetch, "GET", "/v1/nope", token);
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: { code: "not_found", message: "no route for GET /v1/nope" } });
    const badJson = await call(fetch, "POST", "/v1/agents", token, "{not json");
    expect(await badJson.json()).toEqual({ error: { code: "bad_request", message: "body is not valid JSON" } });
    const invalid = await call(fetch, "POST", "/v1/agents", token, { id: "x" });
    expect(invalid.status).toBe(400);
  });

  it("wakes a codespace through the GitHub API", async () => {
    const requests: string[] = [];
    const githubFetch: typeof fetch = async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`);
      return Response.json({ state: "Starting" });
    };
    const { fetch } = inProcessWorker({ githubFetch, env: { GITHUB_TOKEN: "ghp_x" } });
    const token = await issueToken(fetch);
    await call(fetch, "POST", "/v1/agents", token, agentB);
    const response = await call(fetch, "POST", "/v1/wake", token, { repo: "acme/billing" });
    expect(await response.json()).toEqual({ repo: "acme/billing", codespaceName: "cs-billing", state: "Starting" });
    expect(requests).toEqual(["POST https://api.github.com/user/codespaces/cs-billing/start"]);
  });

  it("runs maintenance on the cron trigger", async () => {
    const { worker, env } = inProcessWorker();
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({}, env, { waitUntil: (p) => void pending.push(p) });
    await expect(Promise.all(pending)).resolves.toHaveLength(1);
  });
});

describe("github waker", () => {
  it("treats 304 as already available and other failures as unavailable", async () => {
    expect(await githubWaker("t", async () => new Response(null, { status: 304 }))("cs")).toBe("Available");
    await expect(githubWaker("t", async () => new Response("no", { status: 402 }))("cs")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("helpers", () => {
  it("compares secrets", async () => {
    expect(await secretsEqual("a", "a")).toBe(true);
    expect(await secretsEqual("a", "b")).toBe(false);
  });

  it("reads retention from env with safe fallbacks", () => {
    expect(retentionFrom({ DB: {} as never, RETENTION_CHECKPOINT_DAYS: "3", RETENTION_ACKED_MESSAGE_DAYS: "-1" })).toEqual({
      ackedMessageDays: 7,
      unreadMessageDays: 30,
      checkpointDays: 3,
    });
  });
});
