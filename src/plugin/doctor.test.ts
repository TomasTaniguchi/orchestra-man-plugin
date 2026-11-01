import { describe, expect, it } from "vitest";
import { agentB, START } from "../../test/helpers/fixtures";
import { testRuntime } from "../../test/helpers/runtime";
import { OrchestraError } from "../core/errors";
import type { Remote } from "../core/remote";
import { runCli } from "./cli";
import { configErrorReport, diagnose, formatReport, hasErrors } from "./doctor";
import { callTool } from "./mcp";

const withRemote = (remote: Remote, patch: Partial<Remote>): Remote => ({ ...remote, ...patch });

async function healthyRuntime() {
  const t = testRuntime({
    memories: [
      { type: "decision", title: "Elegido D1 sobre KV", content: "What: D1. Why: SQL y FTS5." },
      { type: "preference", title: "Mi alias", content: "alias gs=git status", scope: "personal" },
    ],
  });
  t.store.setPinned(1, "acme/api", true);
  t.store.startSession({ id: "sess-1", project: "acme/api" });
  await t.service.registerAgent(t.rt.identity.agent);
  await t.service.registerAgent(agentB);
  await t.service.saveCheckpoint({ agentId: agentB.id, repo: agentB.repo, branch: "main", commitSha: "abcdef1234", summary: "s" });
  await t.service.sendMessage({ fromAgent: agentB.id, fromRepo: agentB.repo, toRepo: "acme/api", kind: "note", body: "hola" });
  return t;
}

describe("doctor", () => {
  it("reports a healthy setup (snapshot)", async () => {
    const { rt } = await healthyRuntime();
    const report = await diagnose(rt);
    expect(hasErrors(report)).toBe(false);
    expect(formatReport(report)).toMatchSnapshot();
  });

  it("explains an unreachable backend and keeps the local memory facts", async () => {
    const { rt } = await healthyRuntime();
    rt.remote = withRemote(rt.remote, {
      health: () => Promise.reject(new OrchestraError("unavailable", "cannot reach https://w.dev: fetch failed")),
    });
    rt.config = { ...rt.config, mode: "d1", workerUrl: "https://w.dev", token: "om_x" };
    const report = await diagnose(rt);
    expect(hasErrors(report)).toBe(true);
    expect(formatReport(report)).toMatchSnapshot();
  });

  it("tells how to replace a rejected token", async () => {
    const { rt } = await healthyRuntime();
    rt.remote = withRemote(rt.remote, { health: () => Promise.reject(new OrchestraError("unauthorized", "invalid or revoked token")) });
    expect(formatReport(await diagnose(rt))).toMatch(/✗ Backend: El token fue rechazado: emití uno nuevo/);
  });

  it("warns when the Worker runs another version", async () => {
    const { rt } = await healthyRuntime();
    rt.remote = withRemote(rt.remote, { health: async () => ({ status: "ok", service: "orchestra-man", version: "0.1.0" }) });
    const out = formatReport(await diagnose(rt));
    expect(out).toMatch(/! Backend: responde con la versión 0\.1\.0; el plugin espera 0\.2\.0/);
    expect(out).toMatch(/npm run worker:deploy/);
  });

  it("warns about a repository without a git remote", async () => {
    const { rt } = testRuntime({ repo: "local/scratch" });
    expect(formatReport(await diagnose(rt))).toMatch(/! Agente: .*no tiene remoto git[\s\S]*git remote add origin/);
  });

  it("explains a missing configuration (snapshot)", () => {
    const report = configErrorReport(
      new Error("orchestra-man is not configured correctly (maskSalt: Invalid input). Run /orchestra-man:configure."),
      "/home/me/.config/orchestra-man/config.json",
      new Date(START),
    );
    expect(formatReport(report)).toMatchSnapshot();
  });
});

describe("doctor entry points", () => {
  const io = () => {
    const out: string[] = [];
    return { out, io: { out: (l: string) => void out.push(l), err: () => {}, readStdin: async () => "" } };
  };

  it("cli doctor explains a missing configuration with exit code 1", async () => {
    const r = io();
    const code = await runCli(["doctor"], r.io, { env: { ORCHESTRA_CONFIG: "/nonexistent/c.json" }, home: "/nonexistent" });
    expect(code).toBe(1);
    expect(r.out[0]).toMatch(/✗ Configuración: .*\(archivo: \/nonexistent\/c\.json\)[\s\S]*orchestra-man:configure/);
  });

  it("orchestra_status returns the same report", async () => {
    const { rt } = await healthyRuntime();
    const result = await callTool(() => rt, "orchestra_status", {});
    expect(result.content[0]?.text).toBe(formatReport(await diagnose(rt)));
  });
});
