import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentA, testService } from "../../test/helpers/fixtures";
import { BASE_URL, inProcessWorker, issueToken } from "../../test/helpers/worker";
import { coerce, readConfigFile, redactConfig, resolveConfig, writeConfigFile } from "./config";
import { httpRemote } from "./http-remote";
import { detectIdentity, type Exec, readGitState, repoFromRemote } from "./identity";
import { checkpointSummary, chunk, SYNC_WINDOW, syncMemories, toChange } from "./sync";
import { testRuntime } from "../../test/helpers/runtime";

const SALT = "0123456789abcdef0123";

describe("config", () => {
  it("defaults to local mode and applies env over file", () => {
    const config = resolveConfig({ maskSalt: SALT, inboxPollSec: 60 }, { ORCHESTRA_INBOX_POLL: "20" }, "/home/me");
    expect(config).toMatchObject({ mode: "local", inboxPollSec: 20 });
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
    expect(coerce("workerUrl", "")).toBeNull();
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

describe("sync", () => {
  it("maps memories to changes and withdraws deleted or personal ones without content", () => {
    const { store } = testRuntime({ memories: [{ type: "decision", title: "Public", content: "shared content", topicKey: "decision/x" }] });
    const [pub] = store.changesSince("t", "acme/api", 10);
    expect(toChange(pub!)).toMatchObject({ sourceId: "acme/api:obs-1", title: "Public", topicKey: "decision/x" });
    expect(toChange({ ...pub!, scope: "personal" })).toEqual({ sourceId: "acme/api:obs-1", updatedAt: pub!.updatedAt, deleted: true });
    expect(toChange({ ...pub!, deletedAt: "x" })).toMatchObject({ deleted: true });
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("pushes only new changes, in batches of 50, across several windows", async () => {
    const memories = Array.from({ length: SYNC_WINDOW + 20 }, (_, i) => ({ type: "note", title: `Memory ${i}`, content: `Body number ${i}` }));
    const { rt, service, store } = testRuntime({ memories });
    const first = await syncMemories({ store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget });
    expect(first).toMatchObject({ sent: 220, applied: 220, batches: 5, pending: false });
    expect(first.recentTitles).toHaveLength(10);
    expect((await syncMemories({ store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget })).sent).toBe(0);

    store.delete(1, "acme/api");
    const withdrawn = await syncMemories({ store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget });
    expect(withdrawn).toMatchObject({ sent: 1, applied: 1 });
    expect(await service.searchMemories({ q: "Memory 0", repo: "acme/api", limit: 50 })).not.toContainEqual(
      expect.objectContaining({ title: "Memory 0" }),
    );
  });

  it("keeps the cursor when the backend fails, so nothing is lost", async () => {
    const { rt, store } = testRuntime({ memories: [{ type: "note", title: "Kept", content: "Must not be lost" }] });
    const failing = { ...rt.remote, upsertMemories: () => Promise.reject(new Error("offline")) };
    await expect(syncMemories({ store, remote: failing, identity: rt.identity, target: rt.syncTarget })).rejects.toThrow("offline");
    expect((await syncMemories({ store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget })).sent).toBe(1);
  });

  it("publishes personal memories nowhere", async () => {
    const { rt, service, store } = testRuntime({ memories: [{ type: "preference", title: "My editor", content: "I prefer vim keybindings", scope: "personal" }] });
    await syncMemories({ store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget });
    expect(await service.searchMemories({ q: "vim" })).toEqual([]);
    expect(rt.store.search({ project: "acme/api", q: "vim" })).toHaveLength(1);
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
