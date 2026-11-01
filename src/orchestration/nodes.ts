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
        "Redactá un plan concreto por repositorio (archivos, cambios, riesgos, cómo verificar) y llamá a orchestra_task_advance con kind=plan.",
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
      `Tarea ${ctx.taskId}: ${task.goal}\nInvestigá en ${repo} lo relevante para esta tarea y respondé con orchestra_send (kind=investigate-result, taskId=${ctx.taskId}).`,
    );
  }
  return step(task, ctx, "investigate", `context from ${context.length} repos, ${others(task).length} requests sent`, {
    phase: "investigate",
    context,
    instruction: [
      "Revisá el contexto compartido de la tarea y el código de tu repositorio.",
      others(task).length
        ? `Se pidió investigación a: ${others(task).join(", ")}. Leé sus respuestas con orchestra_inbox (pueden tardar; si un codespace está apagado usá orchestra_recall o orchestra_wake).`
        : "",
      "Cuando tengas hallazgos, llamá a orchestra_task_advance con kind=findings.",
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
      "Mostrale el plan al usuario y pedile autorización explícita. Después llamá a orchestra_task_approve con decision=approve, revise o plan-only. No edites código antes de eso.",
  });
};

export const approve: Node = async (task, input, ctx) => {
  requireInput("approve", input, "approval");
  const approval = { decision: input.decision, by: ctx.actor, note: input.note };
  if (input.decision === "plan-only") {
    return step(task, ctx, "approve", "plan accepted without edits", {
      phase: "done",
      approval,
      instruction: "Tarea cerrada: el plan quedó registrado y no se autorizó editar código.",
    });
  }
  if (input.decision === "revise") {
    return step(task, ctx, "approve", `revision requested: ${input.note}`, {
      phase: "plan",
      approval,
      instruction: `El usuario pidió revisar el plan: ${input.note || "sin detalle"}. Ajustalo y llamá a orchestra_task_advance con kind=plan.`,
    });
  }
  for (const repo of others(task)) {
    await ctx.tools.send(
      repo,
      "edit-request",
      `Tarea ${ctx.taskId} autorizada por el usuario.\nPlan:\n${task.plan}\n\nAplicá solo la parte de ${repo} en una rama nueva, corré los tests y respondé con orchestra_send (kind=edit-result, taskId=${ctx.taskId}) indicando rama y resultado.`,
    );
  }
  return step(task, ctx, "approve", "edits authorized", {
    phase: "edit",
    approval,
    instruction:
      "Aplicá la parte del plan de tu repositorio en una rama nueva (nunca en la rama principal). Esperá los edit-result de los otros repos en orchestra_inbox y llamá a orchestra_task_advance con kind=edits listando repo, rama y resumen de cada uno.",
  });
};

export const edit: Node = async (task, input, ctx) => {
  requireInput("edit", input, "edits");
  return step(task, ctx, "edit", `${input.edits.length} edits`, {
    phase: "verify",
    edits: [...task.edits, ...input.edits],
    instruction:
      "Verificá los cambios (tests, lint, build) en cada repositorio tocado y llamá a orchestra_task_advance con kind=verification, passed y un reporte.",
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
        "Abrí un pull request por repositorio tocado (no hagas merge) y llamá a orchestra_task_advance con kind=pull-requests y las URLs.",
    });
  }
  const iterations = task.iterations + 1;
  if (iterations >= task.maxIterations) {
    return step(task, ctx, "verify", `verification failed ${iterations} times, replanning`, {
      phase: "plan",
      verification,
      iterations,
      instruction: `La verificación falló ${iterations} veces. Revisá el plan con el usuario a partir del reporte y llamá a orchestra_task_advance con kind=plan (se volverá a pedir autorización).`,
    });
  }
  return step(task, ctx, "verify", `verification failed (${iterations}/${task.maxIterations})`, {
    phase: "edit",
    verification,
    iterations,
    instruction: "La verificación falló. Corregí según el reporte y llamá a orchestra_task_advance con kind=edits.",
  });
};

export const propose: Node = async (task, input, ctx) => {
  requireInput("propose", input, "pull-requests");
  return step(task, ctx, "propose", `${input.urls.length} pull requests`, {
    phase: "done",
    pullRequests: input.urls,
    instruction: `Tarea terminada. Pull requests:\n${bullet(input.urls) || "- ninguno"}`,
  });
};

export const cancel: Node = async (task, input, ctx) => {
  requireInput(task.phase, input, "cancel");
  return step(task, ctx, "cancel", input.reason, { phase: "cancelled", instruction: `Tarea cancelada: ${input.reason}` });
};
