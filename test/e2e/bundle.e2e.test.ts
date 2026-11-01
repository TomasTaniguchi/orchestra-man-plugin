import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the shipped artifact (plugin/dist) as Claude Code would: hooks as processes,
 * the MCP server over stdio, two real git clones sharing the local SQLite backend.
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

const cli = (cwd: string, ...args: string[]) =>
  execFileSync("node", [join(DIST, "cli.mjs"), ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Replaces values that change per machine or run, so the snapshot is stable. */
const normalize = (text: string) =>
  text
    .replaceAll(hostname(), "<host>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>")
    .replace(/@[0-9a-f]{7}\b/g, "@<sha>")
    .replace(/\(Engram is not reachable[^)]*\)/, "(Engram is not reachable)");

async function mcp(cwd: string) {
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: [join(DIST, "mcp.mjs")], cwd, env: env as Record<string, string>, stderr: "ignore" }),
  );
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      if (result.isError) throw new Error(result.content[0]?.text);
      return JSON.parse(result.content[0]?.text ?? "null");
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
    ENGRAM_URL: "http://127.0.0.1:9",
  };
}, 60_000);

describe("bundled plugin (local mode, two clones on one machine)", () => {
  it("hooks print the session context and MCP tools coordinate both repos", async () => {
    const api = gitRepo("api", "git@github.com:acme/api.git");
    const billing = gitRepo("billing", "https://github.com/acme/billing.git");

    cli(billing, "session-start");
    const context = cli(api, "session-start");
    expect(normalize(context)).toMatchSnapshot("SessionStart output in acme/api");

    const apiTools = await mcp(api);
    const billingTools = await mcp(billing);
    try {
      const status = await apiTools.call("orchestra_status");
      expect(status.agent.repo).toBe("acme/api");
      expect(status.agents.map((a: { repo: string; online: boolean }) => `${a.repo}:${a.online}`)).toEqual([
        "acme/api:true",
        "acme/billing:true",
      ]);

      await apiTools.call("orchestra_send", { toRepo: "acme/billing", kind: "note", body: "ping jane.doe@acme.com about invoices" });
      const [message] = await billingTools.call("orchestra_inbox");
      expect(message.body).toMatch(/^ping <email:[0-9a-f]{8}> about invoices$/);
      await billingTools.call("orchestra_ack", { messageId: message.id });
      expect(await billingTools.call("orchestra_inbox")).toEqual([]);

      const started = await apiTools.call("orchestra_task_start", { goal: "Link orders to invoices", repos: ["acme/billing"] });
      expect(started.phase).toBe("investigate");
      const [request] = await billingTools.call("orchestra_inbox");
      expect(request).toMatchObject({ kind: "investigate-request", taskId: started.taskId });

      await expect(
        billingTools.call("orchestra_task_advance", { taskId: started.taskId, kind: "findings", findings: ["x"] }),
      ).rejects.toThrow(/leased by acme\/api#/);
      await expect(apiTools.call("orchestra_task_advance", { taskId: started.taskId, kind: "plan", plan: "early" })).rejects.toThrow(
        /expects start or findings/,
      );
    } finally {
      await apiTools.close();
      await billingTools.close();
    }

    expect(cli(api, "session-end")).toBe("");
  }, 60_000);

  it("explains how to configure instead of failing when nothing is set", () => {
    const out = execFileSync("node", [join(DIST, "cli.mjs"), "session-start"], {
      cwd: work,
      env: { PATH: process.env.PATH, HOME: work, ORCHESTRA_CONFIG: join(work, "missing.json") },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(out).toMatch(/maskSalt.*\/orchestra-man:configure/);
  });
});
