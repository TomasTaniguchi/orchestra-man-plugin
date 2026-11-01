import type {
  AckRequest,
  Agent,
  AgentRegistration,
  Checkpoint,
  CheckpointInput,
  Health,
  InboxQuery,
  LeaseRequest,
  MemoryBatch,
  MemoryHit,
  MemorySearch,
  Message,
  MessageInput,
  Task,
  TaskCreate,
  TaskUpdate,
  UpsertResult,
  WakeResult,
} from "./contract";

/**
 * The port the plugin depends on. Implemented by `OrchestraService` (local SQLite),
 * `httpRemote` (your Worker) and decorated by `maskedRemote` (redaction).
 */
export interface Remote {
  health(): Promise<Health>;
  registerAgent(agent: AgentRegistration): Promise<Agent>;
  listAgents(): Promise<Agent[]>;
  wake(repo: string): Promise<WakeResult>;
  upsertMemories(batch: MemoryBatch): Promise<UpsertResult>;
  searchMemories(query: MemorySearch): Promise<MemoryHit[]>;
  saveCheckpoint(checkpoint: CheckpointInput): Promise<Checkpoint>;
  latestCheckpoints(repo?: string): Promise<Checkpoint[]>;
  createTask(task: TaskCreate): Promise<Task>;
  getTask(id: string): Promise<Task>;
  acquireLease(id: string, request: LeaseRequest): Promise<Task>;
  updateTask(id: string, update: TaskUpdate): Promise<Task>;
  sendMessage(message: MessageInput): Promise<Message>;
  inbox(query: InboxQuery): Promise<Message[]>;
  ackMessage(id: string, request: AckRequest): Promise<Message>;
}

export const REMOTE_METHODS = [
  "health",
  "registerAgent",
  "listAgents",
  "wake",
  "upsertMemories",
  "searchMemories",
  "saveCheckpoint",
  "latestCheckpoints",
  "createTask",
  "getTask",
  "acquireLease",
  "updateTask",
  "sendMessage",
  "inbox",
  "ackMessage",
] as const satisfies readonly (keyof Remote)[];
