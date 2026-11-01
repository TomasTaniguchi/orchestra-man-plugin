import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentA, testService } from "../../test/helpers/fixtures";
import { BASE_URL, inProcessWorker, issueToken } from "../../test/helpers/worker";
import { coerce, readConfigFile, redactConfig, resolveConfig, writeConfigFile } from "./config";
import { type EngramObservation, engramClient } from "./engram";
import { httpRemote } from "./http-remote";
import { detectIdentity, type Exec, readGitState, repoFromRemote } from "./identity";
import { checkpointSummary, chunk, syncMemories, toMemory } from "./sync";

const SALT = "0123456789abcdef0123";

describe("config", () => {
  it("defaults to local mode and applies env over file", () => {
    const config = resolveConfig({ maskSalt: SALT, inboxPollSec: 60 }, { ORCHESTRA_INBOX_POLL: "20" }, "/home/me");
    expect(config).toMatchObject({ mode: "local", inboxPollSec: 20, engramUrl: "http://127.0.0.1:7437" });
    expect(config.localDbPath).toBe("/home/me/.local/share/orchestra-man/orchestra.db");
  });

  it("switches to d1 when url and token are present", () => {
    const env = { ORCHESTRA_URL: "https://w.example.workers.dev", ORCHESTRA_TOKEN: "om_x", ORCHESTRA_MASK_SALT: SALT };
    expect(resolveConfig({}, env, "/h").mode).toBe("d1");
  });

  it("explains what is missing", () => {
    expect(() => resolveConfig({}, {}, "/h")).toThrow(/maskSalt.*configure/);
    expect(() => resolveConfig({ maskSalt: SALT, mode: "d1" }, {}, "/h")).toThrow(/workerUrl or token is missing/);
  });

  it("coerces CLI values", () => {
    expect(coerce("checkpointIntervalSec", "120")).toBe(120);
    expect(coerce("maskPatterns", '["CUST-\\\\d+"]')).toEqual(["CUST-\\d+"]);
    expect(coerce("engramProject", "")).toBeNull();
  });

  it("writes a private file with a generated salt and merges patches", () => {
    const path = join(mkdtempSync(join(tmpdir(), "om-")), "nested", "config.json");
    writeConfigFile(path, { workerUrl: "https://w.dev" });
    writeConfigFile(path, { token: "om_secret_value" });
    const file = readConfigFile(path);
    expect(file).toMatchObject({ workerUrl: "https://w.dev", token: "om_secret_value" });
    expect(file.maskSalt).toHaveLength(48);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(redactConfig(file)).toMatchObject({ token: "om_sec…" });
  });
});

describe("identity", () => {
  it("parses ssh and https remotes", () => {
    expect(repoFromRemote("git@github.com:acme/api.git")).toBe("acme/api");
    expect(repoFromRemote("https://github.com/acme/billing-svc")).toBe("acme/billing-svc");
    expect(repoFromRemote(null)).toBeNull();
  });

  const fakeGit =
    (answers: Record<string, string | null>): Exec =>
    (_cmd, args) =>
      answers[args.join(" ")] ?? null;

  it("identifies a codespace agent", () => {
    const exec = fakeGit({ "rev-parse --show-toplevel": "/workspaces/api", "remote get-url origin": "git@github.com:acme/api.git" });
    const { agent } = detectIdentity("/workspaces/api/src", { CODESPACES: "true", CODESPACE_NAME: "cs-api" }, exec);
    expect(agent).toEqual({ id: "acme/api#cs-api", repo: "acme/api", machine: "cs-api", kind: "codespace", codespaceName: "cs-api" });
  });

  it("falls back to local/<dir> without a remote", () => {
    const exec = fakeGit({ "rev-parse --show-toplevel": "/Users/me/dev/my svc" });
    expect(detectIdentity("/x", {}, exec).agent).toMatchObject({ repo: "local/my-svc", kind: "local", codespaceName: null });
  });

  it("reads git state", () => {
    const exec = fakeGit({
      "status --porcelain": " M src/a.ts\n?? new.txt",
      "rev-parse --abbrev-ref HEAD": "feat/x",
      "rev-parse HEAD": "abc123",
    });
    expect(readGitState("/r", exec)).toEqual({ branch: "feat/x", commitSha: "abc123", changedFiles: ["src/a.ts", "new.txt"] });
  });
});

const obs = (n: number, overrides: Partial<EngramObservation> = {}): EngramObservation => ({
  sync_id: `obs-${n}`,
  type: "decision",
  title: `Decision ${n}`,
  content: `Content ${n}`,
  topic_key: null,
  created_at: "2026-10-30 10:00:00",
  updated_at: "2026-10-30 10:00:00",
  ...overrides,
});

describe("sync", () => {
  it("maps observations and drops deleted or empty ones", () => {
    expect(toMemory(obs(1, { topic_key: "architecture/auth" }))).toMatchObject({ sourceId: "obs-1", topicKey: "architecture/auth" });
    expect(toMemory(obs(2, { deleted_at: "x" }))).toBeNull();
    expect(toMemory(obs(3, { content: "  " }))).toBeNull();
    expect(toMemory(obs(4, { content: "x".repeat(70_000) }))?.content).toHaveLength(64_000);
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("replicates Engram observations in batches of 50", async () => {
    const { service } = testService();
    const observations = Array.from({ length: 120 }, (_, i) => obs(i));
    const engram = { recentObservations: async () => observations };
    const identity = { repoRoot: "/r", agent: { ...agentA, codespaceName: null } };
    const result = await syncMemories({ engram, remote: service, identity, project: "api" });
    expect(result).toMatchObject({ status: "synced", read: 120, upserted: 120, batches: 3 });
    expect(result.recentTitles).toHaveLength(10);
    const again = await syncMemories({ engram, remote: service, identity, project: "api" });
    expect(again.upserted).toBe(120); // same updated_at re-applies idempotently
  });

  it("reports Engram being down instead of failing", async () => {
    const engram = engramClient("http://127.0.0.1:1", async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await syncMemories({
      engram,
      remote: testService().service,
      identity: { repoRoot: "/r", agent: { ...agentA, codespaceName: null } },
      project: "api",
    });
    expect(result).toMatchObject({ status: "engram-unavailable", upserted: 0 });
  });

  it("summarises a checkpoint", () => {
    expect(checkpointSummary({ branch: "main", commitSha: "abc", changedFiles: [] }, ["A", "B"])).toMatchInlineSnapshot(`
      "branch: main
      commit: abc
      uncommitted files (0): none
      recent memories:
      - A
      - B"
    `);
  });
});

describe("httpRemote", () => {
  it("maps contract errors and unreachable hosts to OrchestraError", async () => {
    const { fetch } = inProcessWorker();
    const remote = httpRemote({ baseUrl: BASE_URL, token: await issueToken(fetch), fetch });
    await expect(remote.getTask("task_missing")).rejects.toMatchObject({ code: "not_found", message: "task task_missing not found" });
    const bad = httpRemote({ baseUrl: BASE_URL, token: "wrong", fetch });
    await expect(bad.listAgents()).rejects.toMatchObject({ code: "unauthorized" });
    const down = httpRemote({ baseUrl: BASE_URL, token: "t", fetch: () => Promise.reject(new Error("offline")) });
    await expect(down.health()).rejects.toMatchObject({ code: "unavailable" });
  });
});
