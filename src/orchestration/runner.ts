import { iso, type Clock } from "../core/clock";
import type { Task } from "../core/contract";
import type { Remote } from "../core/remote";
import { parse } from "../core/validate";
import { buildTaskGraph } from "./graph";
import type { GraphTools } from "./nodes";
import { initialState, statusFor, type TaskGraphState, TaskInput } from "./state";

export const LEASE_SECONDS = 600;

export interface OrchestratorDeps {
  remote: Remote;
  agentId: string;
  repo: string;
  clock: Clock;
}

export interface StepResult {
  taskId: string;
  phase: TaskGraphState["phase"];
  status: Task["status"];
  instruction: string;
  state: TaskGraphState;
}

/** GraphTools backed by the Remote port, scoped to one task. */
export const remoteTools = (deps: OrchestratorDeps, taskId: string): GraphTools => ({
  recall: (query, repo) => deps.remote.searchMemories({ q: query, repo, limit: 5 }),
  latestCheckpoint: async (repo) => (await deps.remote.latestCheckpoints(repo))[0],
  send: async (toRepo, kind, body) => {
    await deps.remote.sendMessage({ fromAgent: deps.agentId, fromRepo: deps.repo, toRepo, kind, body, taskId });
  },
});

const toResult = (task: Task): StepResult => {
  const state = task.state as unknown as TaskGraphState;
  return { taskId: task.id, phase: state.phase, status: task.status, instruction: state.instruction, state };
};

/**
 * Takes the lease (failing with `conflict` if another live orchestrator holds it), runs one graph
 * step and saves the new state with an optimistic version check.
 */
export async function advanceTask(deps: OrchestratorDeps, taskId: string, rawInput: TaskInput): Promise<StepResult> {
  const input = parse(TaskInput, rawInput);
  const leased = await deps.remote.acquireLease(taskId, { agentId: deps.agentId, ttlSeconds: LEASE_SECONDS });
  const result = await buildTaskGraph(remoteTools(deps, taskId)).invoke({
    task: leased.state as unknown as TaskGraphState,
    input,
    taskId,
    actor: deps.agentId,
    now: iso(deps.clock.now()),
  });
  const saved = await deps.remote.updateTask(taskId, {
    agentId: deps.agentId,
    version: leased.version,
    state: result.task as unknown as Record<string, unknown>,
    status: statusFor(result.task.phase),
  });
  return toResult(saved);
}

/** Creates the task (the caller becomes orchestrator) and runs the first step. */
export async function startTask(deps: OrchestratorDeps, goal: string, repos: string[]): Promise<StepResult> {
  const allRepos = [...new Set([deps.repo, ...repos])];
  const task = await deps.remote.createTask({
    agentId: deps.agentId,
    title: goal,
    repos: allRepos,
    state: initialState(goal, allRepos, deps.repo) as unknown as Record<string, unknown>,
  });
  return advanceTask(deps, task.id, { kind: "start" });
}

export async function getTaskState(deps: Pick<OrchestratorDeps, "remote">, taskId: string): Promise<StepResult> {
  return toResult(await deps.remote.getTask(taskId));
}
