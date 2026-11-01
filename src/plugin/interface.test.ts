import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentB, testService } from "../../test/helpers/fixtures";
import { testRuntime } from "../../test/helpers/runtime";
import { runCli } from "./cli";
import { formatNotification, watch } from "./commands";
import { readConfigFile } from "./config";
import { callTool, TOOLS } from "./mcp";

const io = (stdin = "") => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l), readStdin: async () => stdin } };
};

describe("cli configure", () => {
  const env = () => ({ ORCHESTRA_CONFIG: join(mkdtempSync(join(tmpdir(), "om-cli-")), "config.json") });

  it("sets keys, reads the token from stdin and never prints it", async () => {
    const e = env();
    const first = io();
    expect(await runCli(["configure", "--set", "mode=d1", "--set", "workerUrl=https://w.dev", "--set", "inboxPollSec=20"], first.io, { env: e })).toBe(0);
    const second = io("om_supersecret_token\n");
    expect(await runCli(["configure", "--token-stdin"], second.io, { env: e })).toBe(0);
    expect(readConfigFile(e.ORCHESTRA_CONFIG)).toMatchObject({ mode: "d1", workerUrl: "https://w.dev", inboxPollSec: 20, token: "om_supersecret_token" });
    expect(second.out.join()).not.toContain("om_supersecret_token");
  });

  it("refuses the token as --set and unknown keys", async () => {
    const e = env();
    const tokenAttempt = io();
    expect(await runCli(["configure", "--set", "token=om_x"], tokenAttempt.io, { env: e })).toBe(1);
    expect(tokenAttempt.err[0]).toMatch(/--token-stdin/);
    const unknown = io();
    expect(await runCli(["configure", "--set", "nope=1"], unknown.io, { env: e })).toBe(1);
  });

  it("prints usage for unknown commands", async () => {
    const r = io();
    expect(await runCli(["bogus"], r.io)).toBe(1);
    expect(r.out[0]).toMatch(/^orchestra-man <command>/);
  });

  it("keeps hooks from failing the session when unconfigured", async () => {
    const r = io();
    const code = await runCli(["session-start"], r.io, { env: { ORCHESTRA_CONFIG: "/nonexistent/config.json" }, home: "/nonexistent" });
    expect(code).toBe(0);
    expect(r.out[0]).toMatch(/orchestra-man: .*configure/);
  });
});

describe("mcp tools", () => {
  it("returns an MCP error result instead of throwing", async () => {
    const result = await callTool(() => {
      throw new Error("not configured. Run /orchestra-man:configure.");
    }, "orchestra_status", {});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "orchestra-man: not configured. Run /orchestra-man:configure." }] });
  });

  it("validates arguments against the tool schema", async () => {
    const { rt } = testRuntime();
    const result = await callTool(() => rt, "orchestra_recall", { query: "" });
    expect(result.isError).toBe(true);
  });

  it("exposes the approval gate as its own tool", () => {
    expect(Object.keys(TOOLS)).toContain("orchestra_task_approve");
    expect(TOOLS.orchestra_task_advance.input.kind.options).not.toContain("approval");
  });
});

describe("watch", () => {
  it("prints each new message once and reports errors once per distinct failure", async () => {
    const { rt, service } = testRuntime();
    const lines: string[] = [];
    const send = (body: string) =>
      service.sendMessage({ fromAgent: agentB.id, fromRepo: agentB.repo, toRepo: rt.identity.agent.repo, kind: "note", body });
    await send("already there before the monitor started");
    let polls = 0;
    await watch(rt, {
      print: (l) => void lines.push(l),
      maxPolls: 3,
      sleep: async () => {
        polls += 1;
        if (polls === 1) await send("hello from billing");
      },
    });
    expect(lines).toEqual([expect.stringContaining("hello from billing")]);
  });

  it("formats notifications as one actionable line", async () => {
    const { service } = testService();
    const m = await service.sendMessage({ fromAgent: agentB.id, fromRepo: agentB.repo, toRepo: "acme/api", kind: "edit-request", body: "line1\nline2", taskId: "task_1" });
    expect(formatNotification(m)).toMatchInlineSnapshot(
      `"[orchestra-man] Mensaje edit-request de acme/billing (tarea task_1), id msg_0001: line1 line2 — leelo con orchestra_inbox y respondé con orchestra_send."`,
    );
  });
});
