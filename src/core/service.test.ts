import { describe, expect, it } from "vitest";
import { agentA, agentB, MIGRATIONS_DIR, migratedDb, START, testService } from "../../test/helpers/fixtures";
import { applyMigrations, loadMigrations } from "./migrations";
import { toFtsQuery } from "./repositories/memories";

const memory = (sourceId: string, overrides: Record<string, unknown> = {}) => ({
  sourceId,
  type: "decision",
  title: `Title ${sourceId}`,
  content: "The billing service exposes POST /invoices and retries webhooks three times.",
  createdAt: START,
  updatedAt: START,
  ...overrides,
});

describe("migrations", () => {
  it("are idempotent", () => {
    const db = migratedDb();
    expect(applyMigrations(db, loadMigrations(MIGRATIONS_DIR), START)).toEqual([]);
  });
});

describe("agents", () => {
  it("registers and refreshes the heartbeat", async () => {
    const { service, clock } = testService();
    const first = await service.registerAgent(agentA);
    clock.advance(60);
    const second = await service.registerAgent(agentA);
    expect(first.createdAt).toBe(second.createdAt);
    expect(second.lastSeenAt).not.toBe(first.lastSeenAt);
    expect(await service.listAgents()).toHaveLength(1);
  });

  it("rejects invalid registrations with bad_request", async () => {
    const { service } = testService();
    await expect(service.registerAgent({ ...agentA, repo: "not a repo" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});

describe("wake", () => {
  it("starts the latest codespace of the repo through the injected waker", async () => {
    const started: string[] = [];
    const { service } = testService({ waker: async (name) => (started.push(name), "Starting") });
    await service.registerAgent(agentB);
    expect(await service.wake("acme/billing")).toEqual({
      repo: "acme/billing",
      codespaceName: "cs-billing",
      state: "Starting",
    });
    expect(started).toEqual(["cs-billing"]);
  });

  it("is unavailable without a waker and not_found without a codespace", async () => {
    await expect(testService().service.wake("acme/billing")).rejects.toMatchObject({ code: "unavailable" });
    const { service } = testService({ waker: async () => "Starting" });
    await service.registerAgent(agentA);
    await expect(service.wake("acme/api")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("memories", () => {
  it("upserts a batch and finds it by full-text search", async () => {
    const { service } = testService();
    const result = await service.upsertMemories({
      agentId: agentB.id,
      repo: agentB.repo,
      items: [memory("obs-1"), memory("obs-2", { content: "Unrelated note about logging" })],
    });
    expect(result).toEqual({ upserted: 2 });
    const hits = await service.searchMemories({ q: "invoices webhook" });
    expect(hits.map((h) => h.sourceId)).toEqual(["obs-1"]);
    expect(hits[0]?.snippet).toContain("[invoices]");
  });

  it("never overwrites a newer copy with an older one", async () => {
    const { service } = testService();
    const repo = { agentId: agentB.id, repo: agentB.repo };
    await service.upsertMemories({ ...repo, items: [memory("obs-1", { title: "new", updatedAt: "2026-10-31T13:00:00Z" })] });
    const stale = await service.upsertMemories({ ...repo, items: [memory("obs-1", { title: "old" })] });
    expect(stale).toEqual({ upserted: 0 });
    expect((await service.searchMemories({ q: "invoices" }))[0]?.title).toBe("new");
  });

  it("filters by repo and survives FTS syntax in the query", async () => {
    const { service } = testService();
    await service.upsertMemories({ agentId: agentB.id, repo: agentB.repo, items: [memory("obs-1")] });
    expect(await service.searchMemories({ q: 'invoices" OR *', repo: "acme/api" })).toEqual([]);
    expect(await service.searchMemories({ q: "*** ---" })).toEqual([]);
  });

  it("rejects batches larger than the contract limit", async () => {
    const { service } = testService();
    const items = Array.from({ length: 51 }, (_, i) => memory(`obs-${i}`));
    await expect(service.upsertMemories({ agentId: agentB.id, repo: agentB.repo, items })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("builds quoted prefix FTS queries", () => {
    expect(toFtsQuery('billing "invoice" OR x*')).toBe('"billing"* "invoice"* "OR"* "x"*');
    expect(toFtsQuery("  ")).toBeNull();
  });
});

describe("checkpoints", () => {
  it("returns the latest checkpoint per repo", async () => {
    const { service, clock } = testService();
    const base = { agentId: agentA.id, branch: "main", commitSha: "abc", summary: "s" };
    await service.saveCheckpoint({ ...base, repo: "acme/api", summary: "old" });
    clock.advance(10);
    await service.saveCheckpoint({ ...base, repo: "acme/api", summary: "new" });
    await service.saveCheckpoint({ ...base, repo: "acme/billing" });
    const latest = await service.latestCheckpoints();
    expect(latest.map((c) => [c.repo, c.summary])).toEqual([
      ["acme/api", "new"],
      ["acme/billing", "s"],
    ]);
    expect(await service.latestCheckpoints("acme/billing")).toHaveLength(1);
  });
});

describe("tasks", () => {
  const create = { agentId: agentA.id, title: "Add invoice id to orders", repos: ["acme/api"], state: { phase: "investigate" } };

  it("gives the creator the lease and lets only the holder update", async () => {
    const { service } = testService();
    const task = await service.createTask(create);
    expect(task.leaseOwner).toBe(agentA.id);
    await expect(service.acquireLease(task.id, { agentId: agentB.id, ttlSeconds: 60 })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      service.updateTask(task.id, { agentId: agentB.id, version: 1, state: {}, status: "open" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const updated = await service.updateTask(task.id, { agentId: agentA.id, version: 1, state: { phase: "plan" }, status: "open" });
    expect(updated).toMatchObject({ version: 2, state: { phase: "plan" } });
  });

  it("rejects stale versions", async () => {
    const { service } = testService();
    const task = await service.createTask(create);
    await service.updateTask(task.id, { agentId: agentA.id, version: 1, state: {}, status: "open" });
    await expect(
      service.updateTask(task.id, { agentId: agentA.id, version: 1, state: {}, status: "open" }),
    ).rejects.toThrow(/version 2, not 1/);
  });

  it("lets another agent take over an expired lease (orchestrator rotation)", async () => {
    const { service, clock } = testService();
    const task = await service.createTask(create);
    clock.advance(301);
    const taken = await service.acquireLease(task.id, { agentId: agentB.id, ttlSeconds: 60 });
    expect(taken.leaseOwner).toBe(agentB.id);
  });

  it("releases the lease when the task is closed", async () => {
    const { service } = testService();
    const task = await service.createTask(create);
    const done = await service.updateTask(task.id, { agentId: agentA.id, version: 1, state: {}, status: "done" });
    expect(done).toMatchObject({ status: "done", leaseOwner: null, leaseExpiresAt: null });
    await expect(service.acquireLease(task.id, { agentId: agentA.id, ttlSeconds: 60 })).rejects.toThrow(/is done/);
  });

  it("returns not_found for unknown tasks", async () => {
    await expect(testService().service.getTask("task_nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("messages", () => {
  const send = { fromAgent: agentA.id, fromRepo: agentA.repo, toRepo: agentB.repo, kind: "note" as const, body: "hi" };

  it("delivers to the recipient repo inbox and acks once", async () => {
    const { service } = testService();
    const msg = await service.sendMessage(send);
    expect(await service.inbox({ repo: agentB.repo })).toHaveLength(1);
    expect(await service.inbox({ repo: agentA.repo })).toHaveLength(0);
    const acked = await service.ackMessage(msg.id, { agentId: agentB.id, repo: agentB.repo });
    expect(acked.ackedBy).toBe(agentB.id);
    expect(await service.inbox({ repo: agentB.repo })).toHaveLength(0);
    expect(await service.inbox({ repo: agentB.repo, includeAcked: "true" })).toHaveLength(1);
    await expect(service.ackMessage(msg.id, { agentId: agentB.id, repo: agentB.repo })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("does not let another repo ack the message", async () => {
    const { service } = testService();
    const msg = await service.sendMessage(send);
    await expect(service.ackMessage(msg.id, { agentId: agentA.id, repo: agentA.repo })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("tokens", () => {
  it("creates, validates and revokes tokens without storing them in clear", async () => {
    const { service, db } = testService();
    const created = await service.createToken({ name: "laptop" });
    expect(await service.isValidToken(created.token)).toBe(true);
    expect(await service.isValidToken("om_wrong")).toBe(false);
    const stored = await db.prepare("SELECT token_hash FROM tokens").first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toContain(created.token);
    await service.revokeToken(created.id);
    expect(await service.isValidToken(created.token)).toBe(false);
    await expect(service.revokeToken(created.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("maintenance", () => {
  it("prunes expired data, keeps the latest checkpoint and frees expired leases", async () => {
    const { service, clock } = testService();
    const base = { agentId: agentA.id, repo: agentA.repo, branch: "main", commitSha: "abc", summary: "s" };
    await service.saveCheckpoint(base);
    clock.advance(1);
    await service.saveCheckpoint(base);
    const msg = await service.sendMessage({ fromAgent: agentA.id, fromRepo: agentA.repo, toRepo: agentB.repo, kind: "note", body: "x" });
    await service.ackMessage(msg.id, { agentId: agentB.id, repo: agentB.repo });
    await service.createTask({ agentId: agentA.id, title: "t", repos: [agentA.repo], state: {} });
    clock.advance(31 * 86_400);
    expect(await service.maintenance()).toEqual({ messagesDeleted: 1, checkpointsDeleted: 1, leasesReleased: 1 });
    expect(await service.latestCheckpoints()).toHaveLength(1);
  });
});
