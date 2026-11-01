import { z } from "zod";
import { Repo } from "../core/contract";

export const Phase = z.enum(["investigate", "plan", "approve", "edit", "verify", "propose", "done", "cancelled"]);
export type Phase = z.infer<typeof Phase>;

export const Edit = z.object({ repo: Repo, branch: z.string().min(1).max(200), summary: z.string().min(1).max(4000) });
export type Edit = z.infer<typeof Edit>;

export const ApprovalDecision = z.enum(["approve", "revise", "plan-only"]);

/** What Claude reports back through the MCP tools. Each phase accepts specific kinds. */
export const TaskInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("findings"), findings: z.array(z.string().min(1).max(8000)).min(1).max(50) }),
  z.object({ kind: z.literal("plan"), plan: z.string().min(1).max(16_000) }),
  z.object({ kind: z.literal("approval"), decision: ApprovalDecision, note: z.string().max(4000).default("") }),
  z.object({ kind: z.literal("edits"), edits: z.array(Edit).min(1).max(20) }),
  z.object({ kind: z.literal("verification"), passed: z.boolean(), report: z.string().min(1).max(16_000) }),
  z.object({ kind: z.literal("pull-requests"), urls: z.array(z.string().min(1).max(500)).max(20) }),
  z.object({ kind: z.literal("cancel"), reason: z.string().min(1).max(2000) }),
]);
export type TaskInput = z.input<typeof TaskInput>;
export type ParsedTaskInput = z.infer<typeof TaskInput>;

export interface ContextEntry {
  repo: string;
  checkpoint: string | null;
  memories: { title: string; snippet: string }[];
}

export interface Action {
  node: string;
  agent: string;
  at: string;
  note: string;
}

/** The task state persisted in `tasks.state`. Every agent sees the same state. */
export interface TaskGraphState {
  goal: string;
  repos: string[];
  orchestratorRepo: string;
  phase: Phase;
  context: ContextEntry[];
  findings: string[];
  plan: string | null;
  approval: { decision: z.infer<typeof ApprovalDecision>; by: string; note: string } | null;
  edits: Edit[];
  verification: { passed: boolean; report: string } | null;
  iterations: number;
  maxIterations: number;
  pullRequests: string[];
  actions: Action[];
  /** What the agent holding the lease must do next. */
  instruction: string;
}

export const DEFAULT_MAX_ITERATIONS = 3;

export function initialState(goal: string, repos: string[], orchestratorRepo: string): TaskGraphState {
  return {
    goal,
    repos,
    orchestratorRepo,
    phase: "investigate",
    context: [],
    findings: [],
    plan: null,
    approval: null,
    edits: [],
    verification: null,
    iterations: 0,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    pullRequests: [],
    actions: [],
    instruction: "",
  };
}

export const statusFor = (phase: Phase) => (phase === "done" ? "done" : phase === "cancelled" ? "cancelled" : "open");
