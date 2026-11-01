import type { Agent, Checkpoint, Message } from "../core/contract";
import { checkpointSummary, type SyncResult, syncMemories } from "./sync";
import { readGitState } from "./identity";
import type { Runtime } from "./runtime";

/**
 * Use cases shared by the MCP server and the CLI (hooks, monitor). Each takes the Runtime,
 * so they are testable with an in-memory backend and fake Engram/git.
 */

export interface CheckpointResult {
  sync: SyncResult;
  checkpoint: Checkpoint;
}

/** Heartbeat + memory replication + a checkpoint of where this repo is. */
export async function runCheckpoint(rt: Runtime): Promise<CheckpointResult> {
  await rt.remote.registerAgent(rt.identity.agent);
  const sync = await syncMemories({ engram: rt.engram, remote: rt.remote, identity: rt.identity, project: rt.project });
  const git = readGitState(rt.identity.repoRoot, rt.exec);
  const checkpoint = await rt.remote.saveCheckpoint({
    agentId: rt.identity.agent.id,
    repo: rt.identity.agent.repo,
    branch: git.branch,
    commitSha: git.commitSha,
    summary: checkpointSummary(git, sync.recentTitles),
  });
  return { sync, checkpoint };
}

export const isOnline = (agent: Agent, now: Date, staleMinutes: number): boolean =>
  now.getTime() - new Date(agent.lastSeenAt).getTime() <= staleMinutes * 60_000;

/** Unread messages for this repo that `seen` does not contain yet; marks them as seen. */
export async function newMessages(rt: Runtime, seen: Set<string>): Promise<Message[]> {
  const fresh = (await rt.remote.inbox({ repo: rt.identity.agent.repo })).filter((m) => !seen.has(m.id));
  for (const m of fresh) seen.add(m.id);
  return fresh;
}

const preview = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const shortSha = (sha: string) => sha.slice(0, 7);

export const formatMessage = (m: Message, max = 300): string =>
  `- [${m.kind}] de ${m.fromRepo}${m.taskId ? ` · tarea ${m.taskId}` : ""} · id ${m.id}: ${preview(m.body.replace(/\s+/g, " "), max)}`;

/** One line per incoming message, as the monitor prints them (each line becomes a notification). */
export const formatNotification = (m: Message): string =>
  `[orchestra-man] Mensaje ${m.kind} de ${m.fromRepo}${m.taskId ? ` (tarea ${m.taskId})` : ""}, id ${m.id}: ${preview(m.body.replace(/\s+/g, " "), 200)} — leelo con orchestra_inbox y respondé con orchestra_send.`;

export interface SessionView {
  agent: Agent | Runtime["identity"]["agent"];
  mode: string;
  sync: SyncResult;
  agents: Agent[];
  checkpoints: Checkpoint[];
  inbox: Message[];
  now: Date;
  staleMinutes: number;
}

/** The text injected into Claude's context at SessionStart. Pure, so it is snapshot-tested. */
export function formatSessionContext(view: SessionView): string {
  const own = view.agent.repo;
  const repos = [...new Set([...view.agents.map((a) => a.repo), ...view.checkpoints.map((c) => c.repo)])]
    .filter((r) => r !== own)
    .sort();
  const syncLine =
    view.sync.status === "synced"
      ? `${view.sync.upserted} memorias de Engram replicadas`
      : `Engram no disponible, memorias no replicadas (${view.sync.detail ?? ""})`;
  const repoLines = repos.map((repo) => {
    const agents = view.agents.filter((a) => a.repo === repo);
    const online = agents.some((a) => isOnline(a, view.now, view.staleMinutes));
    const where = agents.map((a) => `${a.machine} (${a.kind})`).join(", ") || "sin agentes registrados";
    const ckpt = view.checkpoints.find((c) => c.repo === repo);
    const ckptText = ckpt ? `último checkpoint ${ckpt.createdAt} en ${ckpt.branch}@${shortSha(ckpt.commitSha)}` : "sin checkpoint";
    return `- ${repo}: ${online ? "online" : "offline"} · ${where} · ${ckptText}`;
  });
  return [
    "# orchestra-man",
    `Agente ${view.agent.id} (${view.agent.kind}) · backend ${view.mode} · ${syncLine}.`,
    "",
    "## Otros repositorios",
    ...(repoLines.length ? repoLines : ["- ninguno registrado todavía"]),
    "",
    `## Bandeja (${view.inbox.length} sin leer)`,
    ...(view.inbox.length ? view.inbox.slice(0, 10).map((m) => formatMessage(m)) : ["- vacía"]),
    "",
    "Para trabajo que cruza repositorios seguí la skill orchestra-man:orchestra. El contexto de repos offline es el de su último checkpoint.",
  ].join("\n");
}

export async function sessionContext(rt: Runtime): Promise<string> {
  const { sync } = await runCheckpoint(rt);
  const [agents, checkpoints, inbox] = await Promise.all([
    rt.remote.listAgents(),
    rt.remote.latestCheckpoints(),
    rt.remote.inbox({ repo: rt.identity.agent.repo }),
  ]);
  return formatSessionContext({
    agent: rt.identity.agent,
    mode: rt.config.mode,
    sync,
    agents,
    checkpoints,
    inbox,
    now: rt.clock.now(),
    staleMinutes: rt.config.agentStaleMinutes,
  });
}

export interface WatchOptions {
  print: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Stops after this many polls. Unbounded when omitted (the monitor runs for the whole session). */
  maxPolls?: number;
}

/**
 * The monitor loop: notifies about new messages every `inboxPollSec` and checkpoints every
 * `checkpointIntervalSec`. Prints an error once per distinct failure, so a down backend is visible but not noisy.
 */
export async function watch(rt: Runtime, options: WatchOptions): Promise<void> {
  const seen = new Set((await rt.remote.inbox({ repo: rt.identity.agent.repo }).catch(() => [])).map((m) => m.id));
  let lastCheckpoint = rt.clock.now().getTime();
  let lastError = "";
  for (let poll = 0; options.maxPolls === undefined || poll < options.maxPolls; poll++) {
    await options.sleep(rt.config.inboxPollSec * 1000);
    try {
      const now = rt.clock.now().getTime();
      if (now - lastCheckpoint >= rt.config.checkpointIntervalSec * 1000) {
        await runCheckpoint(rt);
        lastCheckpoint = now;
      }
      for (const message of await newMessages(rt, seen)) options.print(formatNotification(message));
      lastError = "";
    } catch (error) {
      const text = (error as Error).message;
      if (text !== lastError) options.print(`[orchestra-man] error: ${text}`);
      lastError = text;
    }
  }
}
