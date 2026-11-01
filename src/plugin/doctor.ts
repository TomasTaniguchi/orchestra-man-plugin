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

const CONFIGURE = "Run /orchestra-man:configure (or `npm run worker:setup` in the plugin repo to deploy your Worker).";

/** The report when the configuration cannot even be loaded. */
export function configErrorReport(error: unknown, configFile: string, now: Date): Report {
  return {
    checks: [
      {
        status: "error",
        label: "Configuration",
        detail: `${(error as Error).message.replace(/ Run \/orchestra-man:configure\.$/, "")} (file: ${configFile})`,
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
  if (code === "unauthorized") return "The token was rejected: issue a new one (docs/guides/deploy-worker.md, \"Issue more tokens\") and store it with `configure --token-stdin`.";
  if (code === "unavailable" && mode === "d1") return "Check the URL with `curl <workerUrl>/v1/health` and your connection. Local memory keeps working and is published when it is back.";
  return "Check `cli.mjs status` and docs/troubleshooting.md.";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const memoryDetail = (m: MemoryStats): string =>
  [
    [
      count(m.project, "shared", "shared"),
      count(m.personal, "personal", "personal"),
      count(m.pinned, "pinned", "pinned"),
      count(m.sessions, "session", "sessions"),
    ].join(", "),
    m.pendingSync
      ? `${count(m.pendingSync, "unsynced change", "unsynced changes")} (published on the next sync, or now with orchestra_sync)`
      : "all synced",
    m.lastChangeAt ? `last change ${m.lastChangeAt}` : "no memories yet",
  ].join(" · ");

export async function diagnose(rt: Runtime): Promise<Report> {
  const { agent } = rt.identity;
  const checks: Check[] = [
    {
      status: "ok",
      label: "Configuration",
      detail: rt.config.mode === "d1" ? `d1 mode · ${rt.config.workerUrl}` : `local mode · ${rt.config.localDbPath}`,
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
      detail: sameVersion ? `responding (version ${health.version})` : `responding with version ${health.version}; the plugin expects ${SERVICE_VERSION}`,
      ...(sameVersion ? {} : { fix: "Update the Worker: in the plugin repo, `git pull && npm ci && npm run worker:migrate:remote && npm run worker:deploy`." }),
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
          label: "Agent",
          detail: `${agent.id} (${agent.kind}): the repo has no git remote, so it is identified by its folder name`,
          fix: "Add the remote (`git remote add origin <url>`) so the other repos recognize it as owner/name.",
        }
      : {
          status: "ok",
          label: "Agent",
          detail: `${agent.id} (${agent.kind})${registered && isOnline(registered, report.now, report.staleMinutes) ? " · registered" : " · registers when the session opens or with orchestra_sync"}`,
        },
  );

  checks.push({ status: "ok", label: "This repo's memory", detail: memoryDetail(rt.store.stats(agent.repo, rt.syncTarget)) });
  return report;
}

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", error: "✗" };

export function formatReport(report: Report): string {
  const lines = ["# orchestra-man · diagnosis", ""];
  for (const c of report.checks) lines.push(`${ICON[c.status]} ${c.label}: ${c.detail}`);

  if (report.ownRepo && report.inboxUnread !== null) {
    const repos = formatRepoLines({ ...report, ownRepo: report.ownRepo });
    lines.push("", "## Other repositories", ...(repos.length ? repos : ["- none registered yet"]));
    lines.push("", `## Inbox: ${report.inboxUnread} unread${report.inboxUnread ? " (see them with orchestra_inbox)" : ""}`);
  }

  const problems = report.checks.filter((c) => c.status !== "ok");
  lines.push("", "## Status");
  if (!problems.length) lines.push("All good.");
  for (const p of problems) lines.push(`- ${ICON[p.status]} ${p.label}: ${p.fix ?? "see docs/troubleshooting.md"}`);
  return lines.join("\n");
}

export const hasErrors = (report: Report): boolean => report.checks.some((c) => c.status === "error");
