import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorker } from "../../src/worker/index";
import { manualClock, migratedDb, sequentialIds } from "../helpers/fixtures";

/**
 * Runs scripts/setup-worker.sh for real (bash 3.2 on macOS, Git Bash on Windows, bash on Linux)
 * against a fake wrangler and the real Worker served over HTTP. The Worker reads ADMIN_TOKEN from
 * the secrets the script uploaded, exactly like a deployed Worker would.
 */

const ROOT = join(import.meta.dirname, "../..");
const posix = (p: string) => p.replaceAll("\\", "/");
const BASH = process.platform === "darwin" ? "/bin/bash" : "bash";
const ADMIN = "a".repeat(40);

interface FakeState {
  loggedIn: boolean;
  databases: { uuid: string; name: string }[];
  calls: string[];
  migrations: { database: string; remote: boolean; config: string }[];
  deploys: { config: string }[];
  secrets: Record<string, string>;
}

let server: Server;
let workerUrl: string;
let statePath = "";

const readState = (): FakeState => JSON.parse(readFileSync(statePath, "utf8"));

beforeAll(async () => {
  const db = migratedDb();
  const worker = createWorker({ clock: manualClock(), ids: sequentialIds() });
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`${workerUrl}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, body });
    const response = await worker.fetch(request, { DB: db, ADMIN_TOKEN: statePath ? readState().secrets.ADMIN_TOKEN : undefined });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  workerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function runSetup(state: Partial<FakeState>, env: Record<string, string>, args = ["--yes"]) {
  const work = mkdtempSync(join(tmpdir(), "om-setup-"));
  statePath = join(work, "wrangler-state.json");
  writeFileSync(statePath, JSON.stringify({ loggedIn: true, databases: [], calls: [], migrations: [], deploys: [], secrets: {}, ...state }));
  const paths = { config: join(work, "wrangler.local.jsonc"), plugin: join(work, "plugin-config.json") };
  return new Promise<{ code: number; stdout: string; stderr: string; paths: typeof paths }>((resolve) => {
    execFile(
      BASH,
      [posix(join(ROOT, "scripts/setup-worker.sh")), ...args],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT, // Windows needs it to run node
          HOME: work,
          USERPROFILE: work,
          WRANGLER: `node ${posix(join(ROOT, "test/helpers/fake-wrangler.mjs"))}`,
          FAKE_WRANGLER_STATE: statePath,
          OM_LOCAL_CONFIG: paths.config,
          ORCHESTRA_CONFIG: paths.plugin,
          OM_WORKER_URL: workerUrl,
          ...env,
        },
      },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr, paths }),
    );
  });
}

describe("scripts/setup-worker.sh", () => {
  it("creates the database, deploys, uploads secrets, issues a token and configures the plugin", async () => {
    const run = await runSetup({}, { OM_WORKER_NAME: "om-test", OM_ADMIN_TOKEN: ADMIN, OM_GITHUB_TOKEN: "ghp_codespaces", OM_MACHINE_NAME: "ci-laptop" });
    expect(run.stderr).not.toMatch(/error:/);
    expect(run.code).toBe(0);

    const state = readState();
    expect(state.databases).toEqual([{ uuid: "00000000-0000-4000-8000-000000000001", name: "om-test", version: "production" }]);
    expect(state.migrations).toEqual([{ database: "DB", remote: true, config: run.paths.config }]);
    expect(state.deploys).toEqual([{ config: run.paths.config }]);
    expect(state.secrets).toEqual({ ADMIN_TOKEN: ADMIN, GITHUB_TOKEN: "ghp_codespaces" });

    const config = readFileSync(run.paths.config, "utf8");
    expect(config).toContain('"name": "om-test"');
    expect(config).toContain('"database_name": "om-test"');
    expect(config).toContain('"database_id": "00000000-0000-4000-8000-000000000001"');
    expect(config).toContain('"main": "../src/worker/index.ts"');

    const plugin = JSON.parse(readFileSync(run.paths.plugin, "utf8"));
    expect(plugin).toMatchObject({ mode: "d1", workerUrl });
    const agents = await fetch(`${workerUrl}/v1/agents`, { headers: { authorization: `Bearer ${plugin.token}` } });
    expect(agents.status).toBe(200);

    // Secrets the user typed or that are already stored are never echoed.
    for (const secret of [ADMIN, "ghp_codespaces", plugin.token]) expect(run.stdout).not.toContain(secret);
    expect(run.stdout).toContain(`Done. Your Worker: ${workerUrl}`);
  }, 60_000);

  it("logs in, reuses an existing database, generates the admin token and prints the machine token once", async () => {
    const run = await runSetup(
      { loggedIn: false, databases: [{ uuid: "11111111-2222-4333-8444-555555555555", name: "orchestra-man" }] },
      { OM_CONFIGURE_PLUGIN: "n", OM_MACHINE_NAME: "spare" },
    );
    expect(run.code).toBe(0);
    const state = readState();
    expect(state.calls).toContain("login");
    expect(state.calls).not.toContainEqual(expect.stringMatching(/^d1 create/));
    expect(Object.keys(state.secrets)).toEqual(["ADMIN_TOKEN"]);
    expect(state.secrets.ADMIN_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(run.paths.config, "utf8")).toContain('"database_id": "11111111-2222-4333-8444-555555555555"');

    // The generated admin token and the machine token are shown exactly once, for the user to save.
    expect(run.stdout.split(state.secrets.ADMIN_TOKEN as string)).toHaveLength(2);
    const machineToken = /Token for machine "spare".*\n\s+(om_\S+)/.exec(run.stdout)?.[1];
    expect(machineToken).toBeDefined();
    expect((await fetch(`${workerUrl}/v1/agents`, { headers: { authorization: `Bearer ${machineToken}` } })).status).toBe(200);
  }, 60_000);

  it("rejects invalid names and refuses to reuse a database the user declined", async () => {
    const invalid = await runSetup({}, { OM_WORKER_NAME: "Not_Valid" });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toMatch(/Invalid Worker name/);

    const declined = await runSetup({ databases: [{ uuid: "x", name: "orchestra-man" }] }, { OM_REUSE_DATABASE: "n" });
    expect(declined.code).toBe(1);
    expect(declined.stderr).toMatch(/Choose another database name/);
    expect(readState().deploys).toEqual([]);
  }, 60_000);

  it("prints usage", async () => {
    const help = await runSetup({}, {}, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^Usage: scripts\/setup-worker.sh/);
    expect((await runSetup({}, {}, ["--nope"])).code).toBe(2);
  });
});
