import { describe, expect, it } from "vitest";
import type { Message } from "../../src/core/contract";
import { advanceTask, getTaskState, type OrchestratorDeps, startTask } from "../../src/orchestration/runner";
import { newMessages, runCheckpoint, sessionContext } from "../../src/plugin/commands";
import type { EngramObservation } from "../../src/plugin/engram";
import type { Runtime } from "../../src/plugin/runtime";
import { type Backend, type BackendKind, dumpAllText, makeBackend } from "../helpers/backends";
import { testRuntime } from "../helpers/runtime";
import { BASE_URL } from "../helpers/worker";

/**
 * Three repositories that work as one product through microservices:
 *   acme/api      local clone, where the user asks (orchestrator)
 *   acme/billing  codespace
 *   acme/web      local clone
 * The same scenario runs against the Worker (D1 contract over HTTP) and local SQLite,
 * and both must produce identical results.
 */

const PII = ["jane.doe@acme.com", "+54 9 11 4567-8901", "sk_live_51HxYzAbCdEfGhIjKl", "8812345"];

const obs = (id: string, title: string, content: string, topic_key: string | null = null): EngramObservation => ({
  sync_id: id,
  type: "architecture",
  title,
  content,
  topic_key,
  created_at: "2026-10-30T09:00:00Z",
  updated_at: "2026-10-30T09:00:00Z",
});

const BILLING_MEMORY = [
  obs(
    "bill-1",
    "Invoice API contract",
    "POST /invoices creates an invoice and returns invoiceId. Contact billing owner jane.doe@acme.com or +54 9 11 4567-8901. Key sk_live_51HxYzAbCdEfGhIjKl.",
    "architecture/invoice-api",
  ),
  obs("bill-2", "Webhook retries", "invoice.paid webhooks retry 3 times with exponential backoff; customer_id=8812345 was the incident."),
];
const API_MEMORY = [obs("api-1", "Orders table", "orders has no invoice reference yet; OrderService.create persists orders.")];
const WEB_MEMORY = [obs("web-1", "Checkout page", "Checkout shows order totals from GET /orders/:id.")];

function agents(backend: Backend) {
  const config = backend.kind === "d1" ? { mode: "d1" as const, workerUrl: BASE_URL, token: "om_test" } : {};
  const shared = { remote: backend.remote, clock: backend.clock, config };
  return {
    api: testRuntime({ ...shared, repo: "acme/api", machine: "laptop", observations: API_MEMORY, git: { branch: "main", status: " M src/orders.ts" } }).rt,
    billing: testRuntime({ ...shared, repo: "acme/billing", machine: "cs-billing", codespace: true, observations: BILLING_MEMORY }).rt,
    web: testRuntime({ ...shared, repo: "acme/web", machine: "laptop", observations: WEB_MEMORY }).rt,
  };
}

const deps = (rt: Runtime): OrchestratorDeps => ({
  remote: rt.remote,
  agentId: rt.identity.agent.id,
  repo: rt.identity.agent.repo,
  clock: rt.clock,
});

/** What a remote agent's Claude does when the monitor notifies it: answer and acknowledge. */
async function answer(rt: Runtime, seen: Set<string>, reply: (m: Message) => { kind: Message["kind"]; body: string }) {
  const handled: string[] = [];
  for (const message of await newMessages(rt, seen)) {
    const r = reply(message);
    await rt.remote.sendMessage({
      fromAgent: rt.identity.agent.id,
      fromRepo: rt.identity.agent.repo,
      toRepo: message.fromRepo,
      taskId: message.taskId,
      kind: r.kind,
      body: r.body,
    });
    await rt.remote.ackMessage(message.id, { agentId: rt.identity.agent.id, repo: rt.identity.agent.repo });
    handled.push(`${rt.identity.agent.repo} handled ${message.kind}`);
  }
  return handled;
}

async function runScenario(kind: BackendKind) {
  const backend = await makeBackend(kind);
  const { api, billing, web } = agents(backend);
  const seen = { api: new Set<string>(), billing: new Set<string>(), web: new Set<string>() };
  const log: string[] = [];

  // 1. Each repo's Claude starts once: registers, replicates Engram memory (masked) and checkpoints.
  backend.clock.advance(60);
  await sessionContext(billing);
  await sessionContext(web);
  backend.clock.advance(20 * 60); // web goes quiet: it will show as offline
  await runCheckpoint(billing);
  const apiContext = await sessionContext(api);

  // 2. The user asks in acme/api. Its Claude recalls billing's memory even if that codespace is off.
  const recall = await api.remote.searchMemories({ q: "invoice webhook", repo: "acme/billing" });

  // 3. Cross-repo task, orchestrated from acme/api.
  const started = await startTask(deps(api), "Link orders to billing invoices", ["acme/billing", "acme/web"]);
  log.push(`api: ${started.phase}`);
  log.push(...(await answer(billing, seen.billing, () => ({ kind: "investigate-result", body: "billing: POST /invoices returns invoiceId; contact jane.doe@acme.com" }))));
  log.push(...(await answer(web, seen.web, () => ({ kind: "investigate-result", body: "web: checkout needs invoiceId to show a receipt link" }))));
  const results = (await newMessages(api, seen.api)).map((m) => `${m.fromRepo}: ${m.body}`);
  await advanceTask(deps(api), started.taskId, { kind: "findings", findings: results });
  await advanceTask(deps(api), started.taskId, { kind: "plan", plan: "api: add orders.invoice_id; billing: return invoiceId on create; web: show receipt link" });
  const approved = await advanceTask(deps(api), started.taskId, { kind: "approval", decision: "approve", note: "go" });
  log.push(`api: ${approved.phase}`);
  log.push(...(await answer(billing, seen.billing, () => ({ kind: "edit-result", body: "branch feat/invoice-id, tests green" }))));
  log.push(...(await answer(web, seen.web, () => ({ kind: "edit-result", body: "branch feat/receipt-link, tests green" }))));
  await newMessages(api, seen.api);
  const edits = {
    kind: "edits" as const,
    edits: [
      { repo: "acme/api", branch: "feat/invoice-id", summary: "orders.invoice_id column" },
      { repo: "acme/billing", branch: "feat/invoice-id", summary: "invoiceId in create response" },
      { repo: "acme/web", branch: "feat/receipt-link", summary: "receipt link" },
    ],
  };
  await advanceTask(deps(api), started.taskId, edits);
  log.push(`api: ${(await advanceTask(deps(api), started.taskId, { kind: "verification", passed: false, report: "api migration test failed" })).phase}`);
  await advanceTask(deps(api), started.taskId, { kind: "edits", edits: [{ repo: "acme/api", branch: "feat/invoice-id", summary: "fix migration" }] });
  await advanceTask(deps(api), started.taskId, { kind: "verification", passed: true, report: "all green" });
  const done = await advanceTask(deps(api), started.taskId, {
    kind: "pull-requests",
    urls: ["https://github.com/acme/api/pull/10", "https://github.com/acme/billing/pull/7", "https://github.com/acme/web/pull/3"],
  });
  log.push(`api: ${done.phase}`);

  const allMessages = (
    await Promise.all(["acme/api", "acme/billing", "acme/web"].map((repo) => backend.remote.inbox({ repo, includeAcked: "true" })))
  ).flat();

  return { backend, apiContext, recall, log, task: await getTaskState({ remote: backend.remote }, started.taskId), allMessages };
}

describe.each(["d1", "local"] as const)("multi-agent scenario on %s backend", (kind) => {
  it("never stores sensitive values, on any table", async () => {
    const { backend } = await runScenario(kind);
    const stored = await dumpAllText(backend.db);
    for (const value of PII) expect(stored).not.toContain(value);
    expect(stored).toContain("<email:");
  });

  it("rotates the orchestrator only after the lease expires", async () => {
    const backend = await makeBackend(kind);
    const { api, billing } = agents(backend);
    await runCheckpoint(api);
    const { taskId } = await startTask(deps(api), "Rotate", ["acme/billing"]);
    await expect(advanceTask(deps(billing), taskId, { kind: "findings", findings: ["x"] })).rejects.toMatchObject({ code: "conflict" });
    backend.clock.advance(601); // the api laptop went to sleep mid-task
    const taken = await advanceTask(deps(billing), taskId, { kind: "findings", findings: ["billing took over"] });
    expect(taken.state.actions.map((a) => a.agent)).toEqual(["acme/api#laptop", "acme/billing#cs-billing"]);
    await expect(advanceTask(deps(api), taskId, { kind: "plan", plan: "late" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("multi-agent scenario", () => {
  it("produces identical results on the Worker (D1) and local SQLite backends", async () => {
    // Only the backend label in the session context may differ.
    const strip = ({ backend: _b, apiContext, ...rest }: Awaited<ReturnType<typeof runScenario>>) => ({
      ...rest,
      apiContext: apiContext.replace(/backend (d1|local)/, "backend <kind>"),
    });
    expect(strip(await runScenario("d1"))).toEqual(strip(await runScenario("local")));
  });

  it("matches the expected end-to-end outcome (snapshots)", async () => {
    const result = await runScenario("d1");
    expect(result.apiContext).toMatchSnapshot("session context injected in acme/api");
    expect(result.recall).toMatchSnapshot("recall of a stopped codespace's memory");
    expect(result.log).toMatchSnapshot("conversation between agents");
    expect(result.task).toMatchSnapshot("final task state");
    expect(result.allMessages).toMatchSnapshot("every message exchanged (masked)");
  });
});
