import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MessageKind, Repo } from "../core/contract";
import { advanceTask, getTaskState, type OrchestratorDeps, startTask } from "../orchestration/runner";
import { ApprovalDecision, Edit, type TaskInput } from "../orchestration/state";
import { SCOPES } from "../memory/store";
import { suggestTopicKey } from "../memory/text";
import { isOnline, memoryContext, runCheckpoint } from "./commands";
import type { Runtime } from "./runtime";

type Shape = z.ZodRawShape;
interface ToolDef<S extends Shape> {
  description: string;
  input: S;
  run: (rt: Runtime, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}
const tool = <S extends Shape>(def: ToolDef<S>) => def;

const orchestrator = (rt: Runtime): OrchestratorDeps => ({
  remote: rt.remote,
  agentId: rt.identity.agent.id,
  repo: rt.identity.agent.repo,
  clock: rt.clock,
});

const ADVANCE_KINDS = ["findings", "plan", "edits", "verification", "pull-requests", "cancel"] as const;
const Scope = z.enum(SCOPES);
const MemoryId = z.number().int().positive();

const project = (rt: Runtime) => rt.identity.agent.repo;
const currentSessionId = (rt: Runtime) => rt.store.currentSession(project(rt))?.id ?? null;

/** Local memory of this repository (the Engram replacement). Writes stay local until the next sync. */
const MEMORY_TOOLS = {
  orchestra_save: tool({
    description:
      "Saves a durable, verified memory of THIS repository: decisions with rationale, non-obvious root causes, contracts, constraints, pending work. Content format: What / Why / Where / Learned. Use a topic_key for evolving topics: the same key updates the memory and keeps the old version as history. scope=personal keeps it on this machine only.",
    input: {
      title: z.string().min(1).describe("Verb + what, short and searchable"),
      type: z.string().min(1).describe("bugfix | decision | architecture | discovery | pattern | config | preference | learning"),
      content: z.string().min(1),
      scope: Scope.optional(),
      topicKey: z.string().optional().describe("Stable key like architecture/auth-model; see orchestra_suggest_topic_key"),
    },
    run: async (rt, a) => {
      const { observation, outcome } = rt.store.save({ project: project(rt), sessionId: currentSessionId(rt), ...a });
      return { id: observation.id, outcome, topicKey: observation.topicKey, revision: observation.revisionCount, scope: observation.scope };
    },
  }),
  orchestra_update: tool({
    description: "Updates a memory of this repository by id. Fields you omit stay as they are; the previous content is kept as a version.",
    input: {
      id: MemoryId,
      title: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      topicKey: z.string().nullable().optional(),
      scope: Scope.optional(),
    },
    run: async (rt, { id, ...patch }) => rt.store.update(id, project(rt), patch),
  }),
  orchestra_delete: tool({
    description: "Deletes a memory of this repository. Soft by default (also withdrawn from the shared backend on the next sync); hard=true erases it and its history.",
    input: { id: MemoryId, hard: z.boolean().optional() },
    run: async (rt, a) => (rt.store.delete(a.id, project(rt), a.hard ?? false), { id: a.id, deleted: true, hard: a.hard ?? false }),
  }),
  orchestra_get: tool({
    description: "Reads a memory of this repository in full (search results are previews). history=true includes previous versions.",
    input: { id: MemoryId, history: z.boolean().optional() },
    run: async (rt, a) => rt.store.get(a.id, project(rt), a.history ?? false),
  }),
  orchestra_search: tool({
    description:
      "Full-text search over THIS repository's own memory on this machine (fresh, unmasked, includes personal). For other repositories use orchestra_recall.",
    input: { query: z.string().min(1), type: z.string().optional(), scope: Scope.optional(), limit: z.number().int().min(1).max(50).optional() },
    run: async (rt, a) => rt.store.search({ project: project(rt), q: a.query, type: a.type, scope: a.scope, limit: a.limit }),
  }),
  orchestra_context: tool({
    description: "Recent sessions, pinned and recent memories of this repository. Call it first when the user asks what was done before.",
    input: { compact: z.boolean().optional(), maxBytes: z.number().int().min(1024).max(65_536).optional() },
    run: async (rt, a) => memoryContext(rt, a),
  }),
  orchestra_timeline: tool({
    description: "Memories saved just before and after a given memory in the same session, to recover the surrounding story.",
    input: { id: MemoryId, before: z.number().int().min(0).max(20).optional(), after: z.number().int().min(0).max(20).optional() },
    run: async (rt, a) => rt.store.timeline(a.id, project(rt), a.before, a.after),
  }),
  orchestra_pin: tool({
    description: "Pins (or unpins with pinned=false) a memory so it always appears in the session context.",
    input: { id: MemoryId, pinned: z.boolean().optional() },
    run: async (rt, a) => rt.store.setPinned(a.id, project(rt), a.pinned ?? true),
  }),
  orchestra_suggest_topic_key: tool({
    description: "Suggests a stable topic_key (family/segment) for a memory. A hint: search before reusing a key.",
    input: { type: z.string().min(1), title: z.string().min(1), content: z.string().optional() },
    run: async (_rt, a) => ({ topicKey: suggestTopicKey(a.type, a.title, a.content ?? "") }),
  }),
  orchestra_session_summary: tool({
    description:
      "Saves the summary of this session (Goal, Instructions, Discoveries, Accomplished, Next Steps, Relevant Files). Use it at an explicit close or handoff and ALWAYS right after a context compaction.",
    input: { content: z.string().min(1) },
    run: async (rt, a) => {
      const { observation, outcome } = rt.store.saveSessionSummary({ project: project(rt), sessionId: currentSessionId(rt), content: a.content });
      return { id: observation.id, outcome };
    },
  }),
  orchestra_capture_passive: tool({
    description: "Extracts the items of a '## Key Learnings' or '## Aprendizajes' section from text and saves each new one as a memory. A safety net, not a replacement for orchestra_save.",
    input: { content: z.string().min(1) },
    run: async (rt, a) => rt.store.capturePassive({ project: project(rt), sessionId: currentSessionId(rt), content: a.content }),
  }),
} as const;

/** Every tool the plugin exposes. Names are the MCP surface documented in docs/reference/mcp-tools.md. */
export const TOOLS = {
  ...MEMORY_TOOLS,
  orchestra_status: tool({
    description: "Shows this agent, the backend mode and which repositories have agents online or offline.",
    input: {},
    run: async (rt) => {
      const agents = await rt.remote.listAgents();
      const now = rt.clock.now();
      return {
        agent: rt.identity.agent,
        mode: rt.config.mode,
        backend: await rt.remote.health(),
        agents: agents.map((a) => ({ ...a, online: isOnline(a, now, rt.config.agentStaleMinutes) })),
      };
    },
  }),
  orchestra_recall: tool({
    description:
      "Full-text search over the shared (masked) memory of every repository, including ones whose codespace is stopped. Use it before asking another repo or waking it. For this repo's own memory use orchestra_search.",
    input: { query: z.string().min(1), repo: Repo.optional(), limit: z.number().int().min(1).max(50).optional() },
    run: (rt, a) => rt.remote.searchMemories({ q: a.query, repo: a.repo, limit: a.limit }),
  }),
  orchestra_checkpoints: tool({
    description: "Latest checkpoint (branch, commit, uncommitted files, recent memories) per repository.",
    input: { repo: Repo.optional() },
    run: (rt, a) => rt.remote.latestCheckpoints(a.repo),
  }),
  orchestra_sync: tool({
    description: "Pushes this repo's memory changes (masked, project scope only) to the shared backend and saves a checkpoint now.",
    input: {},
    run: (rt) => runCheckpoint(rt),
  }),
  orchestra_send: tool({
    description: "Sends a message to the agents of another repository (masked before leaving the machine).",
    input: { toRepo: Repo, kind: MessageKind, body: z.string().min(1), taskId: z.string().optional() },
    run: (rt, a) =>
      rt.remote.sendMessage({
        fromAgent: rt.identity.agent.id,
        fromRepo: rt.identity.agent.repo,
        toRepo: a.toRepo,
        kind: a.kind,
        body: a.body,
        taskId: a.taskId ?? null,
      }),
  }),
  orchestra_inbox: tool({
    description: "Messages addressed to this repository. Acknowledge each one with orchestra_ack once handled.",
    input: { includeAcked: z.boolean().optional() },
    run: (rt, a) => rt.remote.inbox({ repo: rt.identity.agent.repo, includeAcked: a.includeAcked ? "true" : "false" }),
  }),
  orchestra_ack: tool({
    description: "Marks a message of this repository's inbox as handled.",
    input: { messageId: z.string().min(1) },
    run: (rt, a) => rt.remote.ackMessage(a.messageId, { agentId: rt.identity.agent.id, repo: rt.identity.agent.repo }),
  }),
  orchestra_wake: tool({
    description:
      "Starts the stopped codespace of a repository (Worker backend with GITHUB_TOKEN only). Needed only to run or edit code there; memory is readable while it is stopped.",
    input: { repo: Repo },
    run: (rt, a) => rt.remote.wake(a.repo),
  }),
  orchestra_task_start: tool({
    description:
      "Starts a cross-repository task with this agent as orchestrator. Gathers shared context and asks the other repos to investigate. Returns the next instruction.",
    input: { goal: z.string().min(1).max(300), repos: z.array(Repo).max(19) },
    run: (rt, a) => startTask(orchestrator(rt), a.goal, a.repos),
  }),
  orchestra_task_advance: tool({
    description:
      "Reports the result of the current phase and runs the next graph step. kind must match the phase: findings (investigate), plan (plan), edits (edit), verification (verify), pull-requests (propose), or cancel at any time. Approval has its own tool.",
    input: {
      taskId: z.string().min(1),
      kind: z.enum(ADVANCE_KINDS),
      findings: z.array(z.string()).optional(),
      plan: z.string().optional(),
      edits: z.array(Edit).optional(),
      passed: z.boolean().optional(),
      report: z.string().optional(),
      urls: z.array(z.string()).optional(),
      reason: z.string().optional(),
    },
    run: (rt, { taskId, ...input }) => advanceTask(orchestrator(rt), taskId, input as TaskInput),
  }),
  orchestra_task_approve: tool({
    description:
      "Records the USER's decision on the plan: approve (edit code), revise (change the plan) or plan-only (finish without edits). Call it only after the user explicitly decided. Kept separate so Claude Code asks for permission.",
    input: { taskId: z.string().min(1), decision: ApprovalDecision, note: z.string().optional() },
    run: (rt, a) =>
      advanceTask(orchestrator(rt), a.taskId, { kind: "approval", decision: a.decision, note: a.note ?? "" }),
  }),
  orchestra_task_get: tool({
    description: "Reads a task's full state: phase, plan, edits, actions log and the next instruction.",
    input: { taskId: z.string().min(1) },
    run: (rt, a) => getTaskState({ remote: rt.remote }, a.taskId),
  }),
} as const;

export const toText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** Runs one tool, turning any failure into an MCP error result instead of crashing the server. */
export async function callTool(getRuntime: () => Runtime, name: keyof typeof TOOLS, args: unknown) {
  try {
    const def = TOOLS[name] as ToolDef<Shape>;
    const parsed = z.object(def.input).parse(args ?? {});
    return { content: [{ type: "text" as const, text: toText(await def.run(getRuntime(), parsed)) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: `orchestra-man: ${(error as Error).message}` }] };
  }
}

/** The runtime is created lazily, so an unconfigured plugin still starts and explains what to fix. */
export function createMcpServer(getRuntime: () => Runtime, version: string): McpServer {
  const server = new McpServer({ name: "orchestra-man", version });
  for (const [name, def] of Object.entries(TOOLS) as [keyof typeof TOOLS, ToolDef<Shape>][]) {
    server.registerTool(name, { description: def.description, inputSchema: def.input }, (args: unknown) =>
      callTool(getRuntime, name, args),
    );
  }
  return server;
}
