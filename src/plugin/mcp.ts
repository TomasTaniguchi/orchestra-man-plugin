import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MessageKind, Repo } from "../core/contract";
import { advanceTask, getTaskState, type OrchestratorDeps, startTask } from "../orchestration/runner";
import { ApprovalDecision, Edit, type TaskInput } from "../orchestration/state";
import { isOnline, runCheckpoint } from "./commands";
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

/** Every tool the plugin exposes. Names are the MCP surface documented in docs/reference/mcp-tools.md. */
export const TOOLS = {
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
      "Full-text search over the shared memory of every repository, including ones whose codespace is stopped. Use it before asking another repo or waking it.",
    input: { query: z.string().min(1), repo: Repo.optional(), limit: z.number().int().min(1).max(50).optional() },
    run: (rt, a) => rt.remote.searchMemories({ q: a.query, repo: a.repo, limit: a.limit }),
  }),
  orchestra_checkpoints: tool({
    description: "Latest checkpoint (branch, commit, uncommitted files, recent memories) per repository.",
    input: { repo: Repo.optional() },
    run: (rt, a) => rt.remote.latestCheckpoints(a.repo),
  }),
  orchestra_sync: tool({
    description: "Replicates this repo's Engram memories (masked) and saves a checkpoint now.",
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
