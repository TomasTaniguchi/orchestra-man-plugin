import type { Checkpoint, MemoryHit, MessageKind } from "../core/contract";
import { OrchestraError } from "../core/errors";
import type { Action, ParsedTaskInput, Phase, TaskGraphState } from "./state";

/** The MCP-backed tools nodes may call. LangGraph coordinates them; Claude Code does the reasoning. */
export interface GraphTools {
  recall(query: string, repo: string): Promise<MemoryHit[]>;
  latestCheckpoint(repo: string): Promise<Checkpoint | undefined>;
  send(toRepo: string, kind: MessageKind, body: string): Promise<void>;
}

export interface StepContext {
  taskId: string;
  actor: string;
  now: string;
  tools: GraphTools;
}

export type Node = (task: TaskGraphState, input: ParsedTaskInput, ctx: StepContext) => Promise<TaskGraphState>;

function requireInput<K extends ParsedTaskInput["kind"]>(
  phase: Phase,
  input: ParsedTaskInput,
  ...kinds: K[]
): asserts input is Extract<ParsedTaskInput, { kind: K }> {
  if (!kinds.includes(input.kind as K))
    throw new OrchestraError("bad_request", `phase "${phase}" expects ${kinds.join(" or ")}, got "${input.kind}"`);
}

const step = (
  task: TaskGraphState,
  ctx: StepContext,
  node: string,
  note: string,
  changes: Partial<TaskGraphState> & { phase: Phase; instruction: string },
): TaskGraphState => {
  const action: Action = { node, agent: ctx.actor, at: ctx.now, note };
  return { ...task, ...changes, actions: [...task.actions, action] };
};

const others = (task: TaskGraphState) => task.repos.filter((r) => r !== task.orchestratorRepo);
const bullet = (items: readonly string[]) => items.map((i) => `- ${i}`).join("\n");

/** start: gathers shared memory and asks the other repos to investigate. findings: moves to planning. */
export const investigate: Node = async (task, input, ctx) => {
  requireInput("investigate", input, "start", "findings");
  if (input.kind === "findings") {
    return step(task, ctx, "investigate", `${input.findings.length} findings`, {
      phase: "plan",
      findings: [...task.findings, ...input.findings],
      instruction:
        "Write a concrete plan per repository (files, changes, risks, how to verify) and call orchestra_task_advance with kind=plan.",
    });
  }
  const context = await Promise.all(
    task.repos.map(async (repo) => ({
      repo,
      checkpoint: (await ctx.tools.latestCheckpoint(repo))?.summary ?? null,
      memories: (await ctx.tools.recall(task.goal, repo)).map((m) => ({ title: m.title, snippet: m.snippet })),
    })),
  );
  for (const repo of others(task)) {
    await ctx.tools.send(
      repo,
      "investigate-request",
      `Task ${ctx.taskId}: ${task.goal}\nInvestigate in ${repo} what is relevant to this task and reply with orchestra_send (kind=investigate-result, taskId=${ctx.taskId}).`,
    );
  }
  return step(task, ctx, "investigate", `context from ${context.length} repos, ${others(task).length} requests sent`, {
    phase: "investigate",
    context,
    instruction: [
      "Review the task's shared context and the code of your repository.",
      others(task).length
        ? `Investigation was requested from: ${others(task).join(", ")}. Read their replies with orchestra_inbox (they may take a while; if a codespace is stopped, use orchestra_recall or orchestra_wake).`
        : "",
      "When you have findings, call orchestra_task_advance with kind=findings.",
    ]
      .filter(Boolean)
      .join(" "),
  });
};

export const plan: Node = async (task, input, ctx) => {
  requireInput("plan", input, "plan");
  return step(task, ctx, "plan", "plan proposed", {
    phase: "approve",
    plan: input.plan,
    instruction:
      "Show the plan to the user and ask for explicit authorization. Then call orchestra_task_approve with decision=approve, revise or plan-only. Do not edit code before that.",
  });
};

export const approve: Node = async (task, input, ctx) => {
  requireInput("approve", input, "approval");
  const approval = { decision: input.decision, by: ctx.actor, note: input.note };
  if (input.decision === "plan-only") {
    return step(task, ctx, "approve", "plan accepted without edits", {
      phase: "done",
      approval,
      instruction: "Task closed: the plan was recorded and editing code was not authorized.",
    });
  }
  if (input.decision === "revise") {
    return step(task, ctx, "approve", `revision requested: ${input.note}`, {
      phase: "plan",
      approval,
      instruction: `The user asked to revise the plan: ${input.note || "no details"}. Adjust it and call orchestra_task_advance with kind=plan.`,
    });
  }
  for (const repo of others(task)) {
    await ctx.tools.send(
      repo,
      "edit-request",
      `Task ${ctx.taskId} authorized by the user.\nPlan:\n${task.plan}\n\nApply only the ${repo} part on a new branch, run the tests and reply with orchestra_send (kind=edit-result, taskId=${ctx.taskId}) with the branch and the result.`,
    );
  }
  return step(task, ctx, "approve", "edits authorized", {
    phase: "edit",
    approval,
    instruction:
      "Apply your repository's part of the plan on a new branch (never on the main branch). Wait for the edit-result replies from the other repos in orchestra_inbox and call orchestra_task_advance with kind=edits, listing repo, branch and summary for each one.",
  });
};

export const edit: Node = async (task, input, ctx) => {
  requireInput("edit", input, "edits");
  return step(task, ctx, "edit", `${input.edits.length} edits`, {
    phase: "verify",
    edits: [...task.edits, ...input.edits],
    instruction:
      "Verify the changes (tests, lint, build) in every touched repository and call orchestra_task_advance with kind=verification, passed and a report.",
  });
};

/** Loops back to edit on failure; after maxIterations failures, returns to planning (a new human gate). */
export const verify: Node = async (task, input, ctx) => {
  requireInput("verify", input, "verification");
  const verification = { passed: input.passed, report: input.report };
  if (input.passed) {
    return step(task, ctx, "verify", "verification passed", {
      phase: "propose",
      verification,
      instruction:
        "Open one pull request per touched repository (do not merge) and call orchestra_task_advance with kind=pull-requests and the URLs.",
    });
  }
  const iterations = task.iterations + 1;
  if (iterations >= task.maxIterations) {
    return step(task, ctx, "verify", `verification failed ${iterations} times, replanning`, {
      phase: "plan",
      verification,
      iterations,
      instruction: `Verification failed ${iterations} times. Review the plan with the user based on the report and call orchestra_task_advance with kind=plan (authorization will be requested again).`,
    });
  }
  return step(task, ctx, "verify", `verification failed (${iterations}/${task.maxIterations})`, {
    phase: "edit",
    verification,
    iterations,
    instruction: "Verification failed. Fix the issues in the report and call orchestra_task_advance with kind=edits.",
  });
};

export const propose: Node = async (task, input, ctx) => {
  requireInput("propose", input, "pull-requests");
  return step(task, ctx, "propose", `${input.urls.length} pull requests`, {
    phase: "done",
    pullRequests: input.urls,
    instruction: `Task done. Pull requests:\n${bullet(input.urls) || "- none"}`,
  });
};

export const cancel: Node = async (task, input, ctx) => {
  requireInput(task.phase, input, "cancel");
  return step(task, ctx, "cancel", input.reason, { phase: "cancelled", instruction: `Task cancelled: ${input.reason}` });
};
