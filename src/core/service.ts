import { addSeconds, type Clock, type Ids, iso, sha256Hex } from "./clock";
import {
  AckRequest,
  AgentRegistration,
  CheckpointInput,
  CheckpointQuery,
  InboxQuery,
  LeaseRequest,
  MemoryBatch,
  MemorySearch,
  MessageInput,
  Repo,
  TaskCreate,
  TaskUpdate,
  TokenCreate,
  type Agent,
  type Checkpoint,
  type Health,
  type MaintenanceResult,
  type Message,
  type Task,
  type TokenCreated,
  type WakeResult,
} from "./contract";
import { changesOf, type SqlDatabase } from "./db";
import { OrchestraError } from "./errors";
import type { Remote } from "./remote";
import * as agents from "./repositories/agents";
import * as checkpoints from "./repositories/checkpoints";
import * as memories from "./repositories/memories";
import * as messages from "./repositories/messages";
import * as tasks from "./repositories/tasks";
import * as tokens from "./repositories/tokens";
import { parse } from "./validate";

/**
 * Version of the backend API (Worker and local service), reported by /v1/health.
 * Bump it only when the Worker changes; the plugin has its own version in plugin.json.
 * `doctor` warns when a deployed Worker reports a different one.
 */
export const SERVICE_VERSION = "0.2.0";
export const DEFAULT_LEASE_SECONDS = 300;

/** Starts a codespace and returns its new state. Provided by the Worker (GitHub API). */
export type Waker = (codespaceName: string) => Promise<string>;

export interface Retention {
  ackedMessageDays: number;
  unreadMessageDays: number;
  checkpointDays: number;
}

export const DEFAULT_RETENTION: Retention = { ackedMessageDays: 7, unreadMessageDays: 30, checkpointDays: 30 };

export interface ServiceDeps {
  db: SqlDatabase;
  clock: Clock;
  ids: Ids;
  waker?: Waker | undefined;
}

const daysAgo = (now: Date, days: number) => iso(addSeconds(now, -days * 86_400));

/**
 * Business rules over the repositories. Validates every input against the contract,
 * so the Worker and local mode get identical behaviour from one implementation.
 */
export class OrchestraService implements Remote {
  constructor(private readonly deps: ServiceDeps) {}

  private now(): string {
    return iso(this.deps.clock.now());
  }

  async health(): Promise<Health> {
    return { status: "ok", service: "orchestra-man", version: SERVICE_VERSION };
  }

  async registerAgent(input: unknown): Promise<Agent> {
    const agent = parse(AgentRegistration, input);
    await agents.upsertAgent(this.deps.db, agent, this.now());
    return (await agents.findAgent(this.deps.db, agent.id)) as Agent;
  }

  listAgents(): Promise<Agent[]> {
    return agents.listAgents(this.deps.db);
  }

  async wake(repoInput: unknown): Promise<WakeResult> {
    const repo = parse(Repo, repoInput);
    if (!this.deps.waker) throw new OrchestraError("unavailable", "wake is not configured on this backend");
    const agent = await agents.latestCodespaceAgent(this.deps.db, repo);
    if (!agent?.codespaceName) throw new OrchestraError("not_found", `no codespace registered for ${repo}`);
    const state = await this.deps.waker(agent.codespaceName);
    return { repo, codespaceName: agent.codespaceName, state };
  }

  /** All items of a batch are written in one transactional `batch()` call (one D1 query). */
  async upsertMemories(input: unknown) {
    const batch = parse(MemoryBatch, input);
    const now = this.now();
    const statements = batch.items.map((item) =>
      "deleted" in item
        ? memories.deleteMemoryStatement(this.deps.db, { ...item, repo: batch.repo })
        : memories.upsertMemoryStatement(this.deps.db, { ...item, repo: batch.repo, agentId: batch.agentId }, now),
    );
    const results = await this.deps.db.batch(statements);
    return { upserted: results.reduce<number>((sum, r) => sum + changesOf(r), 0) };
  }

  searchMemories(input: unknown) {
    return memories.searchMemories(this.deps.db, parse(MemorySearch, input));
  }

  async saveCheckpoint(input: unknown): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      ...parse(CheckpointInput, input),
      id: this.deps.ids.id("ckpt"),
      createdAt: this.now(),
    };
    await checkpoints.insertCheckpoint(this.deps.db, checkpoint);
    return checkpoint;
  }

  latestCheckpoints(repo?: unknown): Promise<Checkpoint[]> {
    const query = parse(CheckpointQuery, { repo });
    return checkpoints.latestCheckpoints(this.deps.db, query.repo ?? null);
  }

  /** Creates the task with the creator holding the lease, so it is the orchestrator from the start. */
  async createTask(input: unknown): Promise<Task> {
    const create = parse(TaskCreate, input);
    const now = this.deps.clock.now();
    const task: Task = {
      id: this.deps.ids.id("task"),
      title: create.title,
      repos: create.repos,
      orchestrator: create.agentId,
      status: "open",
      state: create.state,
      version: 1,
      leaseOwner: create.agentId,
      leaseExpiresAt: iso(addSeconds(now, DEFAULT_LEASE_SECONDS)),
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    await tasks.insertTask(this.deps.db, task);
    return task;
  }

  async getTask(id: string): Promise<Task> {
    const task = await tasks.findTask(this.deps.db, id);
    if (!task) throw new OrchestraError("not_found", `task ${id} not found`);
    return task;
  }

  async acquireLease(id: string, input: unknown): Promise<Task> {
    const request = parse(LeaseRequest, input);
    const now = this.deps.clock.now();
    const acquired = await tasks.tryAcquireLease(this.deps.db, {
      id,
      agentId: request.agentId,
      now: iso(now),
      expiresAt: iso(addSeconds(now, request.ttlSeconds)),
    });
    const task = await this.getTask(id);
    if (!acquired) throw new OrchestraError("conflict", leaseConflictMessage(task));
    return task;
  }

  async updateTask(id: string, input: unknown): Promise<Task> {
    const update = parse(TaskUpdate, input);
    const ok = await tasks.tryUpdateTask(this.deps.db, { id, ...update, now: this.now() });
    const task = await this.getTask(id);
    if (ok) return task;
    if (task.version !== update.version)
      throw new OrchestraError("conflict", `task ${id} is at version ${task.version}, not ${update.version}`);
    throw new OrchestraError("conflict", leaseConflictMessage(task, update.agentId));
  }

  async sendMessage(input: unknown): Promise<Message> {
    const message: Message = {
      ...parse(MessageInput, input),
      id: this.deps.ids.id("msg"),
      createdAt: this.now(),
      ackedAt: null,
      ackedBy: null,
    };
    await messages.insertMessage(this.deps.db, message);
    return message;
  }

  inbox(input: unknown): Promise<Message[]> {
    const query = parse(InboxQuery, input);
    return messages.inbox(this.deps.db, query.repo, query.includeAcked);
  }

  async ackMessage(id: string, input: unknown): Promise<Message> {
    const request = parse(AckRequest, input);
    const acked = await messages.tryAck(this.deps.db, { id, ...request, now: this.now() });
    const message = await messages.findMessage(this.deps.db, id);
    if (!message || message.toRepo !== request.repo) throw new OrchestraError("not_found", `message ${id} not found`);
    if (!acked) throw new OrchestraError("conflict", `message ${id} was already acknowledged`);
    return message;
  }

  // Administration: used by the Worker only, not part of the plugin-facing Remote port.

  async createToken(input: unknown): Promise<TokenCreated> {
    const { name } = parse(TokenCreate, input);
    const token = this.deps.ids.secret();
    const created = { id: this.deps.ids.id("tok"), name, token, createdAt: this.now() };
    await tokens.insertToken(this.deps.db, { ...created, hash: await sha256Hex(token) });
    return created;
  }

  async revokeToken(id: string): Promise<{ id: string; revoked: true }> {
    if (!(await tokens.revokeToken(this.deps.db, id, this.now())))
      throw new OrchestraError("not_found", `active token ${id} not found`);
    return { id, revoked: true };
  }

  async isValidToken(token: string): Promise<boolean> {
    return tokens.isActiveTokenHash(this.deps.db, await sha256Hex(token));
  }

  /** Expires old messages and checkpoints and frees expired leases, in one batch. */
  async maintenance(retention: Retention = DEFAULT_RETENTION): Promise<MaintenanceResult> {
    const now = this.deps.clock.now();
    const [msgs, ckpts, leases] = await this.deps.db.batch([
      messages.pruneMessagesStatement(
        this.deps.db,
        daysAgo(now, retention.ackedMessageDays),
        daysAgo(now, retention.unreadMessageDays),
      ),
      checkpoints.pruneCheckpointsStatement(this.deps.db, daysAgo(now, retention.checkpointDays)),
      tasks.releaseExpiredLeasesStatement(this.deps.db, iso(now)),
    ]);
    return {
      messagesDeleted: changesOf(msgs),
      checkpointsDeleted: changesOf(ckpts),
      leasesReleased: changesOf(leases),
    };
  }
}

function leaseConflictMessage(task: Task, requester?: string): string {
  if (task.status !== "open") return `task ${task.id} is ${task.status}`;
  if (task.leaseOwner && task.leaseOwner !== requester)
    return `task ${task.id} is leased by ${task.leaseOwner} until ${task.leaseExpiresAt}`;
  return `task ${task.id} lease is not held by ${requester ?? "this agent"}; acquire it first`;
}
