import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { OrchestraError } from "../core/errors";
import * as nodes from "./nodes";
import type { GraphTools, Node } from "./nodes";
import type { ParsedTaskInput, Phase, TaskGraphState } from "./state";

const GraphState = Annotation.Root({
  task: Annotation<TaskGraphState>(),
  input: Annotation<ParsedTaskInput>(),
  taskId: Annotation<string>(),
  actor: Annotation<string>(),
  now: Annotation<string>(),
});
type GraphStateType = typeof GraphState.State;

const NODE_FOR_PHASE: Record<Exclude<Phase, "done" | "cancelled">, keyof typeof NODES> = {
  investigate: "investigate",
  plan: "plan",
  approve: "approve",
  edit: "edit",
  verify: "verify",
  propose: "propose",
};

const NODES = {
  investigate: nodes.investigate,
  plan: nodes.plan,
  approve: nodes.approve,
  edit: nodes.edit,
  verify: nodes.verify,
  propose: nodes.propose,
  cancel: nodes.cancel,
} satisfies Record<string, Node>;

/** Routes one step: cancel wins, closed tasks are rejected, otherwise the current phase decides. */
export function route({ task, input }: Pick<GraphStateType, "task" | "input">): keyof typeof NODES {
  if (task.phase === "done" || task.phase === "cancelled")
    throw new OrchestraError("conflict", `task is already ${task.phase}`);
  return input.kind === "cancel" ? "cancel" : NODE_FOR_PHASE[task.phase];
}

/**
 * One invocation = one step. The persisted task state is the graph state, so any agent that
 * holds the lease can run the next step: the orchestrator can rotate between machines.
 */
export function buildTaskGraph(tools: GraphTools) {
  const graph = new StateGraph(GraphState);
  for (const [name, node] of Object.entries(NODES)) {
    graph.addNode(name, async (s: GraphStateType) => ({
      task: await node(s.task, s.input, { taskId: s.taskId, actor: s.actor, now: s.now, tools }),
    }));
  }
  const names = Object.keys(NODES) as (keyof typeof NODES)[];
  // LangGraph narrows node names per chained call; nodes are added in a loop, so names are checked via NODES instead.
  const builder = graph as unknown as {
    addConditionalEdges: (from: string, fn: (s: GraphStateType) => string, to: string[]) => unknown;
    addEdge: (from: string, to: string) => unknown;
    compile: () => { invoke: (s: GraphStateType) => Promise<GraphStateType> };
  };
  builder.addConditionalEdges(START, route, names);
  for (const name of names) builder.addEdge(name, END);
  return builder.compile();
}
