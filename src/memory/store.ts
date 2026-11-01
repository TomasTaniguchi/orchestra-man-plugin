import { randomUUID } from "node:crypto";
import { addSeconds, type Clock, iso } from "../core/clock";
import { LIMITS } from "../core/contract";
import { OrchestraError } from "../core/errors";
import type { NodeSqliteDatabase } from "../core/node-sqlite";
import { toFtsQuery } from "../core/repositories/memories";
import type { SqlValue } from "../core/db";
import { extractLearnings, normalizedHash, normalizeTopicKey, stripPrivate } from "./text";

/**
 * Local, per-machine memory of this repository: the Engram replacement.
 * Behaviour mirrors Engram's store: topic upserts keep a version history, identical saves within
 * the dedupe window only bump a counter, `<private>` is stripped, deletes are soft by default.
 * Only `project`-scoped memories are replicated to the shared backend (see plugin/sync.ts).
 */

export const SCOPES = ["project", "personal"] as const;
export type Scope = (typeof SCOPES)[number];
export const DEDUPE_WINDOW_SECONDS = 15 * 60;
export const CONTENT_MAX = 50_000;

export interface Observation {
  id: number;
  syncId: string;
  sessionId: string | null;
  project: string;
  scope: Scope;
  type: string;
  title: string;
  content: string;
  topicKey: string | null;
  revisionCount: number;
  duplicateCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  changeSeq: number;
}

export interface ObservationVersion {
  revision: number;
  type: string;
  title: string;
  content: string;
  topicKey: string | null;
  recordedAt: string;
}

export interface Session {
  id: string;
  project: string;
  directory: string | null;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}

export interface SaveInput {
  project: string;
  sessionId?: string | null | undefined;
  scope?: Scope | undefined;
  type: string;
  title: string;
  content: string;
  topicKey?: string | null | undefined;
}

export type SaveOutcome = "created" | "updated-topic" | "deduplicated";

export interface SearchHit {
  id: number;
  scope: Scope;
  type: string;
  title: string;
  snippet: string;
  topicKey: string | null;
  updatedAt: string;
}

type Row = Record<string, unknown>;
const TRUNCATED = "\n…[truncated]";

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max - TRUNCATED.length) + TRUNCATED;

const toObservation = (r: Row): Observation => ({
  id: Number(r.id),
  syncId: String(r.sync_id),
  sessionId: r.session_id == null ? null : String(r.session_id),
  project: String(r.project),
  scope: String(r.scope) as Scope,
  type: String(r.type),
  title: String(r.title),
  content: String(r.content),
  topicKey: r.topic_key == null ? null : String(r.topic_key),
  revisionCount: Number(r.revision_count),
  duplicateCount: Number(r.duplicate_count),
  pinned: Number(r.pinned) === 1,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  deletedAt: r.deleted_at == null ? null : String(r.deleted_at),
  changeSeq: Number(r.change_seq),
});

const toSession = (r: Row): Session => ({
  id: String(r.id),
  project: String(r.project),
  directory: r.directory == null ? null : String(r.directory),
  startedAt: String(r.started_at),
  endedAt: r.ended_at == null ? null : String(r.ended_at),
  summary: r.summary == null ? null : String(r.summary),
});

function cleanTitle(title: string): string {
  const clean = stripPrivate(title).replace(/\s+/g, " ").trim();
  if (!clean) throw new OrchestraError("bad_request", "title is required");
  return truncate(clean, LIMITS.memoryTitleMax);
}

function cleanContent(content: string): string {
  const clean = stripPrivate(content);
  if (!clean) throw new OrchestraError("bad_request", "content is required");
  return truncate(clean, CONTENT_MAX);
}

function cleanType(type: string): string {
  const clean = type.trim().toLowerCase();
  if (!clean) throw new OrchestraError("bad_request", "type is required");
  return clean.slice(0, 50);
}

function cleanScope(scope: string | undefined): Scope {
  const s = scope ?? "project";
  if (!(SCOPES as readonly string[]).includes(s)) throw new OrchestraError("bad_request", `scope must be ${SCOPES.join(" or ")}`);
  return s as Scope;
}

export class MemoryStore {
  constructor(
    private readonly db: NodeSqliteDatabase,
    private readonly clock: Clock,
    private readonly newSyncId: () => string = randomUUID,
  ) {}

  private now(): string {
    return iso(this.clock.now());
  }

  private one(sql: string, ...values: SqlValue[]): Row | undefined {
    return this.db.selectSync(sql, ...values)[0];
  }

  private find(id: number): Observation | null {
    const row = this.one("SELECT * FROM mem_observations WHERE id = ?", id);
    return row ? toObservation(row) : null;
  }

  /** Every by-id operation is scoped to the caller's project, like Engram's *ForProject variants. */
  private owned(id: number, project: string, includeDeleted = false): Observation {
    const obs = this.find(id);
    if (!obs || obs.project !== project || (!includeDeleted && obs.deletedAt))
      throw new OrchestraError("not_found", `memory #${id} not found in ${project}`);
    return obs;
  }

  /** Next change sequence. Called inside write transactions, so it is unique and ordered. */
  private nextSeq(): number {
    return Number(this.one("SELECT coalesce(max(change_seq), 0) + 1 AS seq FROM mem_observations")?.seq ?? 1);
  }

  private recordVersion(obs: Observation, now: string): void {
    this.db.runSync(
      `INSERT INTO mem_observation_versions (observation_id, revision, type, title, content, topic_key, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      obs.id,
      obs.revisionCount,
      obs.type,
      obs.title,
      obs.content,
      obs.topicKey,
      now,
    );
  }

  /**
   * 1. Same topic_key in the same project and scope → update it (old content kept as a version).
   * 2. Same normalized content, title, type, project and scope within 15 minutes → count a duplicate.
   * 3. Otherwise → new memory.
   */
  save(input: SaveInput): { observation: Observation; outcome: SaveOutcome } {
    const title = cleanTitle(input.title);
    const content = cleanContent(input.content);
    const type = cleanType(input.type);
    const scope = cleanScope(input.scope);
    const topicKey = normalizeTopicKey(input.topicKey);
    const hash = normalizedHash(content);
    const now = this.now();
    return this.db.transaction(() => {
      if (topicKey) {
        const row = this.one(
          `SELECT * FROM mem_observations WHERE project = ? AND scope = ? AND topic_key = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 1`,
          input.project,
          scope,
          topicKey,
        );
        if (row) {
          const prev = toObservation(row);
          this.recordVersion(prev, now);
          this.db.runSync(
            `UPDATE mem_observations SET session_id = coalesce(?, session_id), type = ?, title = ?, content = ?,
               normalized_hash = ?, revision_count = revision_count + 1, updated_at = ?, change_seq = ? WHERE id = ?`,
            input.sessionId ?? null,
            type,
            title,
            content,
            hash,
            now,
            this.nextSeq(),
            prev.id,
          );
          return { observation: this.find(prev.id) as Observation, outcome: "updated-topic" as const };
        }
      }
      const duplicate = this.one(
        `SELECT id FROM mem_observations WHERE normalized_hash = ? AND project = ? AND scope = ? AND type = ? AND title = ?
           AND deleted_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
        hash,
        input.project,
        scope,
        type,
        title,
        iso(addSeconds(this.clock.now(), -DEDUPE_WINDOW_SECONDS)),
      );
      if (duplicate) {
        const id = Number(duplicate.id);
        this.db.runSync("UPDATE mem_observations SET duplicate_count = duplicate_count + 1 WHERE id = ?", id);
        return { observation: this.find(id) as Observation, outcome: "deduplicated" as const };
      }
      const { lastInsertRowid } = this.db.runSync(
        `INSERT INTO mem_observations (sync_id, session_id, project, scope, type, title, content, topic_key, normalized_hash, created_at, updated_at, change_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        this.newSyncId(),
        input.sessionId ?? null,
        input.project,
        scope,
        type,
        title,
        content,
        topicKey,
        hash,
        now,
        now,
        this.nextSeq(),
      );
      return { observation: this.find(lastInsertRowid) as Observation, outcome: "created" as const };
    });
  }

  /** Partial update by id. The previous content is kept as a version. */
  update(
    id: number,
    project: string,
    patch: { type?: string; title?: string; content?: string; topicKey?: string | null; scope?: Scope },
  ): Observation {
    const now = this.now();
    return this.db.transaction(() => {
      const prev = this.owned(id, project);
      const content = patch.content === undefined ? prev.content : cleanContent(patch.content);
      this.recordVersion(prev, now);
      this.db.runSync(
        `UPDATE mem_observations SET type = ?, title = ?, content = ?, topic_key = ?, scope = ?, normalized_hash = ?,
           revision_count = revision_count + 1, updated_at = ?, change_seq = ? WHERE id = ?`,
        patch.type === undefined ? prev.type : cleanType(patch.type),
        patch.title === undefined ? prev.title : cleanTitle(patch.title),
        content,
        patch.topicKey === undefined ? prev.topicKey : normalizeTopicKey(patch.topicKey),
        patch.scope === undefined ? prev.scope : cleanScope(patch.scope),
        normalizedHash(content),
        now,
        this.nextSeq(),
        id,
      );
      return this.find(id) as Observation;
    });
  }

  /**
   * Soft delete by default: hidden from search and context, recoverable from the row.
   * Hard delete erases title, content and history, keeping only a tombstone so the deletion
   * still reaches the shared backend on the next sync. Both are replicated as withdrawals.
   */
  delete(id: number, project: string, hard = false): void {
    this.db.transaction(() => {
      this.owned(id, project, hard);
      const now = this.now();
      if (hard) {
        this.db.runSync("DELETE FROM mem_observation_versions WHERE observation_id = ?", id);
        this.db.runSync(
          `UPDATE mem_observations SET title = '[deleted]', content = '[deleted]', topic_key = NULL, normalized_hash = '',
             deleted_at = coalesce(deleted_at, ?), updated_at = ?, pinned = 0, change_seq = ? WHERE id = ?`,
          now,
          now,
          this.nextSeq(),
          id,
        );
        return;
      }
      this.db.runSync(
        "UPDATE mem_observations SET deleted_at = ?, updated_at = ?, pinned = 0, change_seq = ? WHERE id = ?",
        now,
        now,
        this.nextSeq(),
        id,
      );
    });
  }

  get(id: number, project: string, withHistory = false): { observation: Observation; versions?: ObservationVersion[] } {
    const observation = this.owned(id, project);
    if (!withHistory) return { observation };
    const versions = this.db
      .selectSync("SELECT * FROM mem_observation_versions WHERE observation_id = ? ORDER BY revision", id)
      .map((r) => ({
        revision: Number(r.revision),
        type: String(r.type),
        title: String(r.title),
        content: String(r.content),
        topicKey: r.topic_key == null ? null : String(r.topic_key),
        recordedAt: String(r.recorded_at),
      }));
    return { observation, versions };
  }

  search(query: { project: string; q: string; type?: string; scope?: Scope; limit?: number }): SearchHit[] {
    const match = toFtsQuery(query.q);
    if (!match) return [];
    return this.db
      .selectSync(
        `SELECT o.id, o.scope, o.type, o.title, o.topic_key, o.updated_at,
                snippet(mem_observations_fts, 1, '[', ']', '…', 24) AS snippet
         FROM mem_observations_fts JOIN mem_observations o ON o.id = mem_observations_fts.rowid
         WHERE mem_observations_fts MATCH ? AND o.project = ? AND o.deleted_at IS NULL
           AND (? IS NULL OR o.type = ?) AND (? IS NULL OR o.scope = ?)
         ORDER BY bm25(mem_observations_fts), o.updated_at DESC LIMIT ?`,
        match,
        query.project,
        query.type ?? null,
        query.type ?? null,
        query.scope ?? null,
        query.scope ?? null,
        Math.min(Math.max(query.limit ?? 10, 1), 50),
      )
      .map((r) => ({
        id: Number(r.id),
        scope: String(r.scope) as Scope,
        type: String(r.type),
        title: String(r.title),
        snippet: String(r.snippet),
        topicKey: r.topic_key == null ? null : String(r.topic_key),
        updatedAt: String(r.updated_at),
      }));
  }

  recent(project: string, limit = 20, pinned = false): Observation[] {
    return this.db
      .selectSync(
        `SELECT * FROM mem_observations WHERE project = ? AND deleted_at IS NULL AND pinned = ?
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        project,
        pinned ? 1 : 0,
        limit,
      )
      .map(toObservation);
  }

  setPinned(id: number, project: string, pinned: boolean): Observation {
    this.owned(id, project);
    this.db.runSync("UPDATE mem_observations SET pinned = ? WHERE id = ?", pinned ? 1 : 0, id);
    return this.find(id) as Observation;
  }

  /** Memories saved around `id` in the same session, oldest first. */
  timeline(id: number, project: string, before = 3, after = 3): { focus: Observation; before: Observation[]; after: Observation[] } {
    const focus = this.owned(id, project);
    const around = (op: "<" | ">", order: "DESC" | "ASC", limit: number) =>
      this.db
        .selectSync(
          `SELECT * FROM mem_observations WHERE project = ? AND deleted_at IS NULL AND id ${op} ?
             AND ((? IS NULL AND session_id IS NULL) OR session_id = ?)
           ORDER BY id ${order} LIMIT ?`,
          project,
          id,
          focus.sessionId,
          focus.sessionId,
          limit,
        )
        .map(toObservation);
    return { focus, before: around("<", "DESC", before).reverse(), after: around(">", "ASC", after) };
  }

  /** Registers a Claude Code session. Resuming an existing id keeps its start and reopens it. */
  startSession(session: { id: string; project: string; directory?: string | null }): Session {
    this.db.runSync(
      `INSERT INTO mem_sessions (id, project, directory, started_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET ended_at = NULL, directory = coalesce(excluded.directory, directory)`,
      session.id,
      session.project,
      session.directory ?? null,
      this.now(),
    );
    return toSession(this.one("SELECT * FROM mem_sessions WHERE id = ?", session.id) as Row);
  }

  endSession(id: string): void {
    this.db.runSync("UPDATE mem_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL", this.now(), id);
  }

  /**
   * The open session MCP tools attach memories to.
   * shortcut: two open sessions of the same repo on one machine share the newest; bind by Claude session id via a PreToolUse hook if that becomes common.
   */
  currentSession(project: string): Session | null {
    const row = this.one(
      "SELECT * FROM mem_sessions WHERE project = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
      project,
    );
    return row ? toSession(row) : null;
  }

  recentSessions(project: string, limit = 5): Session[] {
    return this.db
      .selectSync("SELECT * FROM mem_sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?", project, limit)
      .map(toSession);
  }

  /** Saves the summary as a memory (one per session, updated on repeat) and on the session row. */
  saveSessionSummary(input: { project: string; sessionId: string | null; content: string }) {
    const firstLine = stripPrivate(input.content).split("\n").find((l) => l.trim()) ?? "Session summary";
    const result = this.save({
      project: input.project,
      sessionId: input.sessionId,
      type: "session_summary",
      title: `Resumen de sesión: ${firstLine.replace(/^[#*\s]+/, "").slice(0, 120)}`,
      content: input.content,
      topicKey: input.sessionId ? `session/${input.sessionId}` : null,
    });
    if (input.sessionId)
      this.db.runSync("UPDATE mem_sessions SET summary = ? WHERE id = ?", truncate(stripPrivate(input.content), 4000), input.sessionId);
    return result;
  }

  /** Saves each "Key Learnings" item once per project (by content hash), like Engram's passive capture. */
  capturePassive(input: { project: string; sessionId: string | null; content: string }) {
    const learnings = extractLearnings(input.content);
    let saved = 0;
    for (const learning of learnings) {
      const exists = this.one(
        "SELECT 1 FROM mem_observations WHERE normalized_hash = ? AND project = ? AND deleted_at IS NULL",
        normalizedHash(stripPrivate(learning)),
        input.project,
      );
      if (exists) continue;
      this.save({
        project: input.project,
        sessionId: input.sessionId,
        type: "learning",
        title: learning.length > 80 ? `${learning.slice(0, 77)}...` : learning,
        content: learning,
      });
      saved += 1;
    }
    return { extracted: learnings.length, saved, duplicates: learnings.length - saved };
  }

  /**
   * Memories changed after the cursor of `target`, including deletions, in change order. All scopes are
   * returned so a memory moved to `personal` can be withdrawn remotely; sync decides what is published.
   * Ordering by change_seq (not by timestamp) never skips a change, even with equal or skewed clocks.
   */
  changesSince(target: string, project: string, limit: number): Observation[] {
    const cursor = this.one("SELECT change_seq FROM mem_sync_cursors WHERE target = ? AND project = ?", target, project);
    return this.db
      .selectSync(
        "SELECT * FROM mem_observations WHERE project = ? AND change_seq > ? ORDER BY change_seq LIMIT ?",
        project,
        cursor ? Number(cursor.change_seq) : 0,
        limit,
      )
      .map(toObservation);
  }

  advanceCursor(target: string, project: string, last: Observation): void {
    this.db.runSync(
      `INSERT INTO mem_sync_cursors (target, project, change_seq) VALUES (?, ?, ?)
       ON CONFLICT (target, project) DO UPDATE SET change_seq = excluded.change_seq`,
      target,
      project,
      last.changeSeq,
    );
  }
}
