import { describe, expect, it } from "vitest";
import { manualClock, MIGRATIONS_DIR } from "../../test/helpers/fixtures";
import { openLocalDb } from "../plugin/runtime";
import { formatMemoryContext, limitBytes } from "./context";
import { DEDUPE_WINDOW_SECONDS, MemoryStore } from "./store";
import { extractLearnings, normalizedHash, normalizeTopicKey, stripPrivate, suggestTopicKey } from "./text";

const P = "acme/api";

function store() {
  const clock = manualClock();
  let n = 0;
  return { clock, s: new MemoryStore(openLocalDb(":memory:", MIGRATIONS_DIR, clock), clock, () => `sync-${++n}`) };
}

const save = (s: MemoryStore, overrides: Record<string, unknown> = {}) =>
  s.save({ project: P, type: "decision", title: "Chose D1 over KV", content: "What: D1. Why: SQL and FTS5.", ...overrides });

describe("text helpers (ported from Engram)", () => {
  it("strips private blocks", () => {
    expect(stripPrivate("token <private>abc\nsecret</private> done")).toBe("token [REDACTED] done");
  });

  it("hashes ignoring case and whitespace", () => {
    expect(normalizedHash("Hello   World\n")).toBe(normalizedHash("hello world"));
  });

  it("normalizes topic keys", () => {
    expect(normalizeTopicKey("  Architecture/Auth Model ")).toBe("architecture/auth-model");
    expect(normalizeTopicKey("   ")).toBeNull();
  });

  it("suggests topic keys like Engram", () => {
    expect(suggestTopicKey("architecture", "Auth model with JWT", "")).toBe("architecture/auth-model-with-jwt");
    expect(suggestTopicKey("manual", "Fixed crash on login", "")).toBe("bug/fixed-crash-on-login");
    expect(suggestTopicKey("decision", "", "Chose Postgres over Mongo for reporting")).toBe("decision/chose-postgres-over-mongo-for-reporting");
    expect(suggestTopicKey("decision", "Decisión de autenticación", "")).toMatch(/^decision\/decisi-n-de-autenticaci-n-u-[0-9a-f]{12}$/);
  });

  it("extracts learnings from the last section that has valid items", () => {
    const text = [
      "## Key Learnings",
      "- too short",
      "",
      "## Work",
      "done",
      "",
      "## Aprendizajes Clave",
      "1. D1 batch counts as a single query toward the limit",
      "2. **FTS5** needs quoted terms to avoid syntax errors",
      "- bullet ignored because numbered items exist here",
    ].join("\n");
    expect(extractLearnings(text)).toEqual([
      "D1 batch counts as a single query toward the limit",
      "FTS5 needs quoted terms to avoid syntax errors",
    ]);
    expect(extractLearnings("no sections")).toEqual([]);
  });
});

describe("save", () => {
  it("creates, then updates in place by topic_key keeping the old version", () => {
    const { s, clock } = store();
    const first = save(s, { topicKey: "Decision/Storage" });
    expect(first).toMatchObject({ outcome: "created", observation: { topicKey: "decision/storage", revisionCount: 1 } });
    clock.advance(60);
    const second = save(s, { topicKey: "decision/storage", content: "What: D1 + R2 for blobs." });
    expect(second).toMatchObject({ outcome: "updated-topic", observation: { id: first.observation.id, revisionCount: 2 } });
    const { versions } = s.get(first.observation.id, P, true);
    expect(versions?.map((v) => v.content)).toEqual(["What: D1. Why: SQL and FTS5."]);
  });

  it("keeps topics independent per scope", () => {
    const { s } = store();
    const a = save(s, { topicKey: "decision/storage" });
    const b = save(s, { topicKey: "decision/storage", scope: "personal" });
    expect(b.outcome).toBe("created");
    expect(b.observation.id).not.toBe(a.observation.id);
  });

  it("deduplicates identical saves within the 15-minute window only", () => {
    const { s, clock } = store();
    const first = save(s);
    const again = save(s, { content: "what: D1.   why: SQL and FTS5." });
    expect(again).toMatchObject({ outcome: "deduplicated", observation: { id: first.observation.id, duplicateCount: 2 } });
    clock.advance(DEDUPE_WINDOW_SECONDS + 1);
    expect(save(s).outcome).toBe("created");
  });

  it("strips <private> and validates input", () => {
    const { s } = store();
    const { observation } = save(s, { content: "DB at <private>10.0.0.5 pass hunter2</private> port 5432" });
    expect(observation.content).toBe("DB at [REDACTED] port 5432");
    expect(() => save(s, { title: "   " })).toThrow(/title is required/);
    expect(() => save(s, { scope: "global" })).toThrow(/scope must be/);
  });
});

describe("update, delete, get", () => {
  it("updates partially and records a version", () => {
    const { s } = store();
    const { observation } = save(s);
    const updated = s.update(observation.id, P, { title: "Chose D1 (final)" });
    expect(updated).toMatchObject({ title: "Chose D1 (final)", content: observation.content, revisionCount: 2 });
    expect(s.get(observation.id, P, true).versions).toHaveLength(1);
  });

  it("scopes every by-id operation to the project", () => {
    const { s } = store();
    const { observation } = save(s);
    expect(() => s.get(observation.id, "acme/other")).toThrow(/not found in acme\/other/);
    expect(() => s.update(observation.id, "acme/other", { title: "x" })).toThrow(/not found/);
  });

  it("soft deletes by default and hard deletes on request", () => {
    const { s } = store();
    const a = save(s).observation;
    const b = save(s, { title: "Other", content: "Other content here" }).observation;
    s.delete(a.id, P);
    expect(() => s.get(a.id, P)).toThrow(/not found/);
    expect(s.search({ project: P, q: "D1" })).toEqual([]);
    s.delete(b.id, P, true);
    // Both deletions are replicated; the hard one keeps no content or history.
    const changes = s.changesSince("t", P, 10);
    expect(changes.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(changes[1]).toMatchObject({ title: "[deleted]", content: "[deleted]", deletedAt: expect.any(String) });
  });
});

describe("search, pins, timeline, context", () => {
  it("searches with filters and survives FTS syntax", () => {
    const { s } = store();
    save(s);
    save(s, { type: "bugfix", title: "Fixed N+1 in orders", content: "Eager loading in OrderList" });
    expect(s.search({ project: P, q: "orders eager" }).map((h) => h.title)).toEqual(["Fixed N+1 in orders"]);
    expect(s.search({ project: P, q: "D1", type: "bugfix" })).toEqual([]);
    expect(s.search({ project: P, q: '"*' })).toEqual([]);
  });

  it("pins memories out of the recent list", () => {
    const { s } = store();
    const { observation } = save(s);
    s.setPinned(observation.id, P, true);
    expect(s.recent(P, 10, true).map((o) => o.id)).toEqual([observation.id]);
    expect(s.recent(P, 10)).toEqual([]);
  });

  it("returns the surrounding memories of the same session", () => {
    const { s } = store();
    s.startSession({ id: "sess-1", project: P });
    const ids = [1, 2, 3, 4, 5].map((n) => save(s, { title: `Step ${n}`, content: `Step ${n} content`, sessionId: "sess-1" }).observation.id);
    save(s, { title: "Other session", content: "x y z w", sessionId: "sess-2" });
    const t = s.timeline(ids[2] as number, P, 1, 5);
    expect([t.before.map((o) => o.title), t.focus.title, t.after.map((o) => o.title)]).toEqual([["Step 2"], "Step 3", ["Step 4", "Step 5"]]);
  });

  it("formats the session context (snapshot) and bounds its size", () => {
    const { s, clock } = store();
    s.startSession({ id: "sess-1", project: P });
    s.saveSessionSummary({ project: P, sessionId: "sess-1", content: "## Goal\nShip D1 sync\n## Accomplished\nBatching" });
    s.endSession("sess-1");
    clock.advance(60);
    s.startSession({ id: "sess-2", project: P });
    const pinned = save(s, { topicKey: "decision/storage" }).observation;
    s.setPinned(pinned.id, P, true);
    save(s, { type: "bugfix", title: "Fixed N+1 in orders", content: "Eager loading in OrderList", scope: "personal" });
    const view = { project: P, sessions: s.recentSessions(P), pinned: s.recent(P, 20, true), recent: s.recent(P, 20) };
    expect(formatMemoryContext(view)).toMatchSnapshot();
    expect(formatMemoryContext({ ...view, compact: true })).not.toContain("Eager loading");
    expect(formatMemoryContext({ project: P, sessions: [], pinned: [], recent: [] })).toContain("Sin memorias todavía");
    expect(limitBytes("ñandú ñandú", 10)).toMatch(/\[truncated\]$/);
  });
});

describe("sessions and passive capture", () => {
  it("reopens a resumed session and tracks the current one", () => {
    const { s } = store();
    s.startSession({ id: "sess-1", project: P });
    s.endSession("sess-1");
    expect(s.currentSession(P)).toBeNull();
    s.startSession({ id: "sess-1", project: P });
    expect(s.currentSession(P)?.id).toBe("sess-1");
  });

  it("keeps one summary memory per session", () => {
    const { s } = store();
    s.startSession({ id: "sess-1", project: P });
    const a = s.saveSessionSummary({ project: P, sessionId: "sess-1", content: "Goal: v1" });
    const b = s.saveSessionSummary({ project: P, sessionId: "sess-1", content: "Goal: v1 done" });
    expect(b.observation.id).toBe(a.observation.id);
    expect(s.recentSessions(P)[0]?.summary).toBe("Goal: v1 done");
  });

  it("captures each learning once", () => {
    const { s } = store();
    const text = "## Key Learnings\n- D1 batch counts as a single query toward the limit\n- Workers cannot read a stopped codespace";
    expect(s.capturePassive({ project: P, sessionId: null, content: text })).toEqual({ extracted: 2, saved: 2, duplicates: 0 });
    expect(s.capturePassive({ project: P, sessionId: null, content: text })).toEqual({ extracted: 2, saved: 0, duplicates: 2 });
  });
});

describe("stats", () => {
  it("counts live memories by scope and changes not yet synced to a target", () => {
    const { s } = store();
    const a = save(s).observation;
    save(s, { title: "Mine", content: "personal note here", scope: "personal" });
    s.setPinned(a.id, P, true);
    s.startSession({ id: "sess-1", project: P });
    expect(s.stats(P, "d1")).toMatchObject({ project: 1, personal: 1, pinned: 1, sessions: 1, pendingSync: 2 });
    s.advanceCursor("d1", P, s.changesSince("d1", P, 10).at(-1)!);
    s.delete(a.id, P);
    expect(s.stats(P, "d1")).toMatchObject({ project: 0, personal: 1, pinned: 0, pendingSync: 1 });
    expect(s.stats("acme/empty", "d1")).toEqual({ project: 0, personal: 0, pinned: 0, sessions: 0, pendingSync: 0, lastChangeAt: null });
  });
});

describe("incremental changes", () => {
  it("follows the change sequence, so equal timestamps never hide a change, and includes personal rows", () => {
    const { s } = store();
    const a = save(s, { title: "A", content: "content a" }).observation;
    const b = save(s, { title: "B", content: "content b", scope: "personal" }).observation;
    const first = s.changesSince("d1", P, 1);
    expect(first.map((o) => o.id)).toEqual([a.id]);
    s.advanceCursor("d1", P, first[0]!);
    expect(s.changesSince("d1", P, 10).map((o) => o.id)).toEqual([b.id]);
    expect(s.changesSince("other-target", P, 10)).toHaveLength(2);
  });
});
