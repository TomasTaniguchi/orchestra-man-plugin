import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the shipped artifact (plugin/dist) as Claude Code would: hooks as processes fed the
 * event JSON on stdin, the MCP server over stdio, two real git clones sharing the local backend.
 * No Engram, no network.
 */

const ROOT = join(import.meta.dirname, "../..");
const DIST = join(ROOT, "plugin/dist");
let work: string;
let env: NodeJS.ProcessEnv;

function gitRepo(name: string, origin: string): string {
  const dir = join(work, name);
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", origin);
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

/** Runs a hook command the way Claude Code does: event JSON on stdin. */
const hook = (cwd: string, command: string, event: Record<string, unknown> = {}) =>
  execFileSync("node", [join(DIST, "cli.mjs"), command], {
    cwd,
    env,
    encoding: "utf8",
    input: JSON.stringify({ cwd, ...event }),
    stdio: ["pipe", "pipe", "ignore"],
  });

/** Replaces values that change per machine or run, so the snapshot is stable. */
const normalize = (text: string) =>
  text
    .replaceAll(hostname(), "<host>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>")
    .replace(/@[0-9a-f]{7}\b/g, "@<sha>");

async function mcp(cwd: string) {
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: [join(DIST, "mcp.mjs")], cwd, env: env as Record<string, string>, stderr: "ignore" }),
  );
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      if (result.isError) throw new Error(result.content[0]?.text);
      const text = result.content[0]?.text ?? "null";
      return text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text;
    },
    close: () => client.close(),
  };
}

beforeAll(() => {
  execFileSync("node", [join(ROOT, "scripts/build-plugin.mjs")], { stdio: "ignore" });
  work = realpathSync(mkdtempSync(join(tmpdir(), "om-bundle-")));
  env = {
    PATH: process.env.PATH,
    HOME: work,
    ORCHESTRA_CONFIG: join(work, "config.json"),
    ORCHESTRA_LOCAL_DB: join(work, "shared.db"),
    ORCHESTRA_MASK_SALT: "bundle-e2e-salt-0123456789",
  };
}, 60_000);

describe("bundled plugin (local mode, two clones on one machine)", () => {
  it("runs the full memory and coordination cycle without Engram", async () => {
    const api = gitRepo("api", "git@github.com:acme/api.git");
    const billing = gitRepo("billing", "https://github.com/acme/billing.git");

    hook(billing, "session-start", { session_id: "sess-billing", source: "startup" });
    hook(api, "session-start", { session_id: "sess-api", source: "startup" });

    const apiTools = await mcp(api);
    const billingTools = await mcp(billing);
    try {
      // The diagnosis behind /orchestra-man:help, through MCP and the CLI.
      const status = await apiTools.call("orchestra_status");
      expect(status).toMatch(/✓ Backend: responding \(version 0\.2\.0\)/);
      expect(status).toMatch(/- acme\/billing: online/);
      expect(status).toMatch(/All good\./);
      expect(execFileSync("node", [join(DIST, "cli.mjs"), "doctor"], { cwd: api, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).toBe(`${status}\n`);

      // Memory: billing saves locally; a topic_key save updates in place; personal stays private.
      const saved = await billingTools.call("orchestra_save", {
        title: "Invoice API contract",
        type: "architecture",
        content: "What: POST /invoices returns invoiceId. Where: src/invoices.ts. Owner jane.doe@acme.com",
        topicKey: "architecture/invoice-api",
      });
      expect(saved).toMatchObject({ outcome: "created", topicKey: "architecture/invoice-api", revision: 1 });
      const updated = await billingTools.call("orchestra_save", {
        title: "Invoice API contract",
        type: "architecture",
        content: "What: POST /invoices returns invoiceId and status. Owner jane.doe@acme.com",
        topicKey: "architecture/invoice-api",
      });
      expect(updated).toMatchObject({ id: saved.id, outcome: "updated-topic", revision: 2 });
      await billingTools.call("orchestra_save", { title: "My shell alias", type: "preference", content: "alias gs=git status", scope: "personal" });
      expect((await billingTools.call("orchestra_get", { id: saved.id, history: true })).versions).toHaveLength(1);
      expect(await billingTools.call("orchestra_search", { query: "invoices" })).toHaveLength(1);

      // Nothing is shared until a sync; then api recalls it, masked, and never sees the personal note.
      expect(await apiTools.call("orchestra_recall", { query: "invoices" })).toEqual([]);
      expect((await billingTools.call("orchestra_sync")).sync).toMatchObject({ sent: 2, applied: 1 });
      const [hit] = await apiTools.call("orchestra_recall", { query: "invoices" });
      expect(hit).toMatchObject({ repo: "acme/billing", title: "Invoice API contract" });
      expect(hit.snippet).toMatch(/<email:[0-9a-f]{8}>/);
      expect(await apiTools.call("orchestra_recall", { query: "alias" })).toEqual([]);

      // Coordination.
      await apiTools.call("orchestra_send", { toRepo: "acme/billing", kind: "note", body: "ping jane.doe@acme.com about invoices" });
      const [message] = await billingTools.call("orchestra_inbox");
      expect(message.body).toMatch(/^ping <email:[0-9a-f]{8}> about invoices$/);
      await billingTools.call("orchestra_ack", { messageId: message.id });

      const started = await apiTools.call("orchestra_task_start", { goal: "Link orders to invoices", repos: ["acme/billing"] });
      expect(started.phase).toBe("investigate");
      await expect(
        billingTools.call("orchestra_task_advance", { taskId: started.taskId, kind: "findings", findings: ["x"] }),
      ).rejects.toThrow(/leased by acme\/api#/);

      // A subagent's "Key Learnings" are captured passively by the SubagentStop hook.
      hook(api, "subagent-stop", {
        session_id: "sess-api",
        last_assistant_message: "Done.\n\n## Key Learnings\n- OrderService.create is the only place that persists orders",
      });
      expect(await apiTools.call("orchestra_search", { query: "OrderService" })).toHaveLength(1);
    } finally {
      await apiTools.close();
      await billingTools.close();
    }

    expect(normalize(hook(api, "session-start", { session_id: "sess-api", source: "resume" }))).toMatchSnapshot(
      "SessionStart output in acme/api",
    );
    expect(normalize(hook(api, "post-compact", { session_id: "sess-api", source: "compact" }))).toMatchSnapshot(
      "SessionStart after compaction in acme/api",
    );
    expect(hook(api, "session-end", { session_id: "sess-api" })).toBe("");
  }, 60_000);

  it("explains how to configure instead of failing when nothing is set", () => {
    const out = execFileSync("node", [join(DIST, "cli.mjs"), "session-start"], {
      cwd: work,
      env: { PATH: process.env.PATH, HOME: work, ORCHESTRA_CONFIG: join(work, "missing.json") },
      encoding: "utf8",
      input: "{}",
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(out).toMatch(/maskSalt.*\/orchestra-man:configure/);
  });
});
