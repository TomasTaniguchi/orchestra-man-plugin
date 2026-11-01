// The orchestra-man API contract. Every payload crossing a process boundary is
// validated against these schemas; docs/api/openapi.yaml mirrors them.
import { z } from "zod";

export const API_VERSION = "v1";

/** Hard limits, sized to stay inside D1 limits (see docs/reference/d1-limits.md). */
export const LIMITS = {
  memoriesPerBatch: 50,
  memoryTitleMax: 300,
  memoryContentMax: 64_000,
  messageBodyMax: 32_000,
  checkpointSummaryMax: 32_000,
  searchLimitMax: 50,
  leaseTtlMinSeconds: 10,
  leaseTtlMaxSeconds: 3_600,
  reposPerTask: 20,
  requestBodyMaxBytes: 4_000_000,
} as const;

const text = (max: number) => z.string().min(1).max(max);
export const Id = text(200);
/** `owner/name` from the git remote, or `local/<dir>` when there is no remote. */
export const Repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/name");
const Timestamp = text(40);

export const AgentKind = z.enum(["codespace", "local"]);
export const AgentRegistration = z.object({
  id: Id,
  repo: Repo,
  machine: text(200),
  kind: AgentKind,
  codespaceName: z.string().max(200).nullable().default(null),
});
export const Agent = AgentRegistration.extend({ createdAt: Timestamp, lastSeenAt: Timestamp });

export const MemoryInput = z.object({
  sourceId: Id,
  type: text(50),
  title: text(LIMITS.memoryTitleMax),
  content: text(LIMITS.memoryContentMax),
  topicKey: z.string().max(200).nullable().default(null),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const MemoryBatch = z.object({
  agentId: Id,
  repo: Repo,
  items: z.array(MemoryInput).min(1).max(LIMITS.memoriesPerBatch),
});
export const MemorySearch = z.object({
  q: text(200),
  repo: Repo.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.searchLimitMax).default(10),
});
export const MemoryHit = z.object({
  repo: Repo,
  sourceId: Id,
  type: z.string(),
  title: z.string(),
  snippet: z.string(),
  topicKey: z.string().nullable(),
  updatedAt: Timestamp,
});

export const CheckpointInput = z.object({
  agentId: Id,
  repo: Repo,
  branch: text(200),
  commitSha: text(64),
  summary: text(LIMITS.checkpointSummaryMax),
});
export const Checkpoint = CheckpointInput.extend({ id: Id, createdAt: Timestamp });
export const CheckpointQuery = z.object({ repo: Repo.optional() });

export const TaskStatus = z.enum(["open", "done", "cancelled"]);
export const TaskState = z.record(z.string(), z.unknown());
export const TaskCreate = z.object({
  agentId: Id,
  title: text(300),
  repos: z.array(Repo).min(1).max(LIMITS.reposPerTask),
  state: TaskState,
});
export const Task = z.object({
  id: Id,
  title: z.string(),
  repos: z.array(Repo),
  orchestrator: Id,
  status: TaskStatus,
  state: TaskState,
  version: z.number().int(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const LeaseRequest = z.object({
  agentId: Id,
  ttlSeconds: z.number().int().min(LIMITS.leaseTtlMinSeconds).max(LIMITS.leaseTtlMaxSeconds),
});
export const TaskUpdate = z.object({
  agentId: Id,
  version: z.number().int().min(1),
  state: TaskState,
  status: TaskStatus,
});

export const MessageKind = z.enum([
  "investigate-request",
  "investigate-result",
  "edit-request",
  "edit-result",
  "note",
]);
export const MessageInput = z.object({
  fromAgent: Id,
  fromRepo: Repo,
  toRepo: Repo,
  taskId: Id.nullable().default(null),
  kind: MessageKind,
  body: text(LIMITS.messageBodyMax),
});
export const Message = MessageInput.extend({
  id: Id,
  createdAt: Timestamp,
  ackedAt: z.string().nullable(),
  ackedBy: z.string().nullable(),
});
export const InboxQuery = z.object({
  repo: Repo,
  includeAcked: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export const AckRequest = z.object({ agentId: Id, repo: Repo });

export const TokenCreate = z.object({ name: text(100) });
export const TokenCreated = z.object({ id: Id, name: z.string(), token: z.string(), createdAt: Timestamp });
export const WakeResult = z.object({ repo: Repo, codespaceName: z.string(), state: z.string() });
export const Health = z.object({ status: z.literal("ok"), service: z.literal("orchestra-man"), version: z.string() });
export const UpsertResult = z.object({ upserted: z.number().int() });
export const MaintenanceResult = z.object({
  messagesDeleted: z.number().int(),
  checkpointsDeleted: z.number().int(),
  leasesReleased: z.number().int(),
});

export const ErrorCode = z.enum(["bad_request", "unauthorized", "not_found", "conflict", "unavailable", "internal"]);
export const ErrorBody = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });

export type AgentRegistration = z.input<typeof AgentRegistration>;
export type Agent = z.infer<typeof Agent>;
export type MemoryInput = z.input<typeof MemoryInput>;
export type MemoryBatch = z.input<typeof MemoryBatch>;
export type MemorySearch = z.input<typeof MemorySearch>;
export type MemoryHit = z.infer<typeof MemoryHit>;
export type CheckpointInput = z.infer<typeof CheckpointInput>;
export type Checkpoint = z.infer<typeof Checkpoint>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskState = z.infer<typeof TaskState>;
export type TaskCreate = z.infer<typeof TaskCreate>;
export type Task = z.infer<typeof Task>;
export type LeaseRequest = z.infer<typeof LeaseRequest>;
export type TaskUpdate = z.infer<typeof TaskUpdate>;
export type MessageKind = z.infer<typeof MessageKind>;
export type MessageInput = z.input<typeof MessageInput>;
export type Message = z.infer<typeof Message>;
export type InboxQuery = z.input<typeof InboxQuery>;
export type AckRequest = z.infer<typeof AckRequest>;
export type TokenCreated = z.infer<typeof TokenCreated>;
export type WakeResult = z.infer<typeof WakeResult>;
export type Health = z.infer<typeof Health>;
export type UpsertResult = z.infer<typeof UpsertResult>;
export type MaintenanceResult = z.infer<typeof MaintenanceResult>;
export type ErrorCode = z.infer<typeof ErrorCode>;
