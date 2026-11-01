import type { Agent, Checkpoint } from "../core/contract";
import { OrchestraError } from "../core/errors";
import { SERVICE_VERSION } from "../core/service";
import type { MemoryStats } from "../memory/store";
import { formatRepoLines, isOnline } from "./commands";
import type { Runtime } from "./runtime";

/**
 * Live diagnosis behind `/orchestra-man:help`, the `doctor` CLI command and `orchestra_status`.
 * `diagnose` gathers facts; `formatReport` is pure, so the output is snapshot-tested.
 */

export type CheckStatus = "ok" | "warn" | "error";

export interface Check {
  status: CheckStatus;
  label: string;
  detail: string;
  /** What to do about it, for warn and error. */
  fix?: string;
}

export interface Report {
  checks: Check[];
  ownRepo: string | null;
  agents: Agent[];
  checkpoints: Checkpoint[];
  inboxUnread: number | null;
  now: Date;
  staleMinutes: number;
}

const CONFIGURE = "Corré /orchestra-man:configure (o `npm run worker:setup` en el repo del plugin para desplegar tu Worker).";

/** The report when the configuration cannot even be loaded. */
export function configErrorReport(error: unknown, configFile: string, now: Date): Report {
  return {
    checks: [
      {
        status: "error",
        label: "Configuración",
        detail: `${(error as Error).message.replace(/ Run \/orchestra-man:configure\.$/, "")} (archivo: ${configFile})`,
        fix: CONFIGURE,
      },
    ],
    ownRepo: null,
    agents: [],
    checkpoints: [],
    inboxUnread: null,
    now,
    staleMinutes: 15,
  };
}

function backendFix(error: unknown, mode: string): string {
  const code = error instanceof OrchestraError ? error.code : "internal";
  if (code === "unauthorized") return "El token fue rechazado: emití uno nuevo (docs/guides/deploy-worker.md, \"Emitir más tokens\") y cargalo con `configure --token-stdin`.";
  if (code === "unavailable" && mode === "d1") return "Revisá la URL con `curl <workerUrl>/v1/health` y tu conexión. La memoria local sigue funcionando y se publica cuando vuelva.";
  return "Revisá `cli.mjs status` y docs/troubleshooting.md.";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const memoryDetail = (m: MemoryStats): string =>
  [
    [
      count(m.project, "compartida", "compartidas"),
      count(m.personal, "personal", "personales"),
      count(m.pinned, "fijada", "fijadas"),
      count(m.sessions, "sesión", "sesiones"),
    ].join(", "),
    m.pendingSync
      ? `${count(m.pendingSync, "cambio sin publicar", "cambios sin publicar")} (se publican en la próxima sincronización, o ya con orchestra_sync)`
      : "todo publicado",
    m.lastChangeAt ? `último cambio ${m.lastChangeAt}` : "todavía sin memorias",
  ].join(" · ");

export async function diagnose(rt: Runtime): Promise<Report> {
  const { agent } = rt.identity;
  const checks: Check[] = [
    {
      status: "ok",
      label: "Configuración",
      detail: rt.config.mode === "d1" ? `modo d1 · ${rt.config.workerUrl}` : `modo local · ${rt.config.localDbPath}`,
    },
  ];
  const report: Report = {
    checks,
    ownRepo: agent.repo,
    agents: [],
    checkpoints: [],
    inboxUnread: null,
    now: rt.clock.now(),
    staleMinutes: rt.config.agentStaleMinutes,
  };

  try {
    const health = await rt.remote.health();
    const sameVersion = health.version === SERVICE_VERSION;
    checks.push({
      status: sameVersion ? "ok" : "warn",
      label: "Backend",
      detail: sameVersion ? `responde (versión ${health.version})` : `responde con la versión ${health.version}; el plugin espera ${SERVICE_VERSION}`,
      ...(sameVersion ? {} : { fix: "Actualizá el Worker: en el repo del plugin, `git pull && npm ci && npm run worker:migrate:remote && npm run worker:deploy`." }),
    });
    [report.agents, report.checkpoints, report.inboxUnread] = await Promise.all([
      rt.remote.listAgents(),
      rt.remote.latestCheckpoints(),
      rt.remote.inbox({ repo: agent.repo }).then((m) => m.length),
    ]);
  } catch (error) {
    checks.push({ status: "error", label: "Backend", detail: (error as Error).message, fix: backendFix(error, rt.config.mode) });
  }

  const registered = report.agents.find((a) => a.id === agent.id);
  checks.push(
    agent.repo.startsWith("local/")
      ? {
          status: "warn",
          label: "Agente",
          detail: `${agent.id} (${agent.kind}): el repo no tiene remoto git, así que se identifica por el nombre de la carpeta`,
          fix: "Agregá el remoto (`git remote add origin <url>`) para que los demás repos lo reconozcan como owner/name.",
        }
      : {
          status: "ok",
          label: "Agente",
          detail: `${agent.id} (${agent.kind})${registered && isOnline(registered, report.now, report.staleMinutes) ? " · registrado" : " · se registra al abrir la sesión o con orchestra_sync"}`,
        },
  );

  checks.push({ status: "ok", label: "Memoria de este repo", detail: memoryDetail(rt.store.stats(agent.repo, rt.syncTarget)) });
  return report;
}

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", error: "✗" };

export function formatReport(report: Report): string {
  const lines = ["# orchestra-man · diagnóstico", ""];
  for (const c of report.checks) lines.push(`${ICON[c.status]} ${c.label}: ${c.detail}`);

  if (report.ownRepo && report.inboxUnread !== null) {
    const repos = formatRepoLines({ ...report, ownRepo: report.ownRepo });
    lines.push("", "## Otros repositorios", ...(repos.length ? repos : ["- ninguno registrado todavía"]));
    lines.push("", `## Bandeja: ${report.inboxUnread} sin leer${report.inboxUnread ? " (orchestra_inbox para verlos)" : ""}`);
  }

  const problems = report.checks.filter((c) => c.status !== "ok");
  lines.push("", "## Estado");
  if (!problems.length) lines.push("Todo en orden.");
  for (const p of problems) lines.push(`- ${ICON[p.status]} ${p.label}: ${p.fix ?? "revisá docs/troubleshooting.md"}`);
  return lines.join("\n");
}

export const hasErrors = (report: Report): boolean => report.checks.some((c) => c.status === "error");
