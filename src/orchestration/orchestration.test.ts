import { describe, expect, it } from "vitest";
import { agentA, agentB, START, testService } from "../../test/helpers/fixtures";
import { route } from "./graph";
import { advanceTask, getTaskState, type OrchestratorDeps, startTask } from "./runner";
import { initialState } from "./state";

function setup() {
  const t = testService();
  const deps: OrchestratorDeps = { remote: t.service, agentId: agentA.id, repo: agentA.repo, clock: t.clock };
  return { ...t, deps };
}

async function toApprove(deps: OrchestratorDeps) {
  const started = await startTask(deps, "Add invoiceId to orders", [agentB.repo]);
  await advanceTask(deps, started.taskId, { kind: "findings", findings: ["orders lacks invoiceId"] });
  await advanceTask(deps, started.taskId, { kind: "plan", plan: "1. migration 2. API field" });
  return started.taskId;
}

describe("route", () => {
  it("rejects closed tasks and lets cancel win", () => {
    const task = initialState("g", ["a/b"], "a/b");
    expect(route({ task, input: { kind: "cancel", reason: "x" } })).toBe("cancel");
    expect(() => route({ task: { ...task, phase: "done" }, input: { kind: "start" } })).toThrow(/already done/);
  });
});

describe("task graph", () => {
  it("starts by gathering shared context and asking the other repos", async () => {
    const { deps, service } = setup();
    await service.upsertMemories({
      agentId: agentB.id,
      repo: agentB.repo,
      items: [{ sourceId: "o1", type: "api", title: "Invoice API", content: "POST /invoices returns invoiceId", createdAt: START, updatedAt: START }],
    });
    const result = await startTask(deps, "Add invoiceId to orders", [agentB.repo]);
    expect(result.phase).toBe("investigate");
    expect(result.state.repos).toEqual([agentA.repo, agentB.repo]);
    expect(result.state.context.find((c) => c.repo === agentB.repo)?.memories[0]?.title).toBe("Invoice API");
    const [request] = await service.inbox({ repo: agentB.repo });
    expect(request).toMatchObject({ kind: "investigate-request", taskId: result.taskId, fromRepo: agentA.repo });
  });

  it("runs the happy path to done and records every action", async () => {
    const { deps, service } = setup();
    const taskId = await toApprove(deps);
    const approved = await advanceTask(deps, taskId, { kind: "approval", decision: "approve" });
    expect(approved.phase).toBe("edit");
    expect((await service.inbox({ repo: agentB.repo })).map((m) => m.kind)).toEqual(["investigate-request", "edit-request"]);
    await advanceTask(deps, taskId, { kind: "edits", edits: [{ repo: agentA.repo, branch: "feat/invoice", summary: "field" }] });
    await advanceTask(deps, taskId, { kind: "verification", passed: true, report: "all green" });
    const done = await advanceTask(deps, taskId, { kind: "pull-requests", urls: ["https://github.com/acme/api/pull/1"] });
    expect(done).toMatchObject({ phase: "done", status: "done" });
    expect(done.state.actions.map((a) => a.node)).toEqual(["investigate", "investigate", "plan", "approve", "edit", "verify", "propose"]);
  });

  it("loops edit/verify and replans after maxIterations failures", async () => {
    const { deps } = setup();
    const taskId = await toApprove(deps);
    await advanceTask(deps, taskId, { kind: "approval", decision: "approve" });
    const edits = { kind: "edits" as const, edits: [{ repo: agentA.repo, branch: "b", summary: "s" }] };
    const fail = { kind: "verification" as const, passed: false, report: "test failed" };
    await advanceTask(deps, taskId, edits);
    expect((await advanceTask(deps, taskId, fail)).phase).toBe("edit");
    await advanceTask(deps, taskId, edits);
    expect((await advanceTask(deps, taskId, fail)).phase).toBe("edit");
    await advanceTask(deps, taskId, edits);
    const replanned = await advanceTask(deps, taskId, fail);
    expect(replanned).toMatchObject({ phase: "plan", state: { iterations: 3 } });
  });

  it("supports revise and plan-only decisions", async () => {
    const { deps } = setup();
    const taskId = await toApprove(deps);
    expect((await advanceTask(deps, taskId, { kind: "approval", decision: "revise", note: "smaller" })).phase).toBe("plan");
    await advanceTask(deps, taskId, { kind: "plan", plan: "smaller plan" });
    const closed = await advanceTask(deps, taskId, { kind: "approval", decision: "plan-only" });
    expect(closed).toMatchObject({ phase: "done", status: "done", state: { edits: [] } });
  });

  it("rejects input that does not match the phase, and cancels", async () => {
    const { deps } = setup();
    const { taskId } = await startTask(deps, "goal", []);
    await expect(advanceTask(deps, taskId, { kind: "plan", plan: "too early" })).rejects.toThrow(/expects start or findings/);
    expect((await advanceTask(deps, taskId, { kind: "cancel", reason: "not needed" })).status).toBe("cancelled");
    await expect(advanceTask(deps, taskId, { kind: "cancel", reason: "again" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("blocks a second orchestrator while the lease is live and lets it take over after expiry", async () => {
    const { deps, clock } = setup();
    const { taskId } = await startTask(deps, "goal", [agentB.repo]);
    const other = { ...deps, agentId: agentB.id, repo: agentB.repo };
    await expect(advanceTask(other, taskId, { kind: "findings", findings: ["x"] })).rejects.toMatchObject({ code: "conflict" });
    clock.advance(601);
    const taken = await advanceTask(other, taskId, { kind: "findings", findings: ["from billing"] });
    expect(taken.state.actions.at(-1)).toMatchObject({ agent: agentB.id, node: "investigate" });
    expect((await getTaskState(deps, taskId)).phase).toBe("plan");
  });
});
