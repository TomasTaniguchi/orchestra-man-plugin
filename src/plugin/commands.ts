import { z } from "zod";
import type { Agent, Checkpoint, Message } from "../core/contract";
import { formatMemoryContext } from "../memory/context";
import { readGitState } from "./identity";
import type { Runtime } from "./runtime";
import { checkpointSummary, type SyncResult, syncMemories } from "./sync";

/**
 * Use cases shared by the MCP server and the CLI (hooks, monitor). Each takes the Runtime,
 * so they are testable with an in-memory backend, a fake git and a fixed clock.
 */

/** The JSON Claude Code sends to hooks on stdin. Only the fields orchestra-man uses. */
export const HookInput = z
  .object({
    session_id: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    source: z.string().optional(),
    last_assistant_message: z.string().optional(),
    stdout: z.string().optional(),
  })
  .catch({});
export type HookInput = z.infer<typeof HookInput>;

export const parseHookInput = (raw: string): HookInput => {
  try {
    return HookInput.parse(JSON.parse(raw || "{}"));
  } catch {
    return {};
  }
};

export interface CheckpointResult {
  sync: SyncResult;
  checkpoint: Checkpoint;
}

/** Heartbeat + incremental memory replication + a checkpoint of where this repo is. */
export async function runCheckpoint(rt: Runtime): Promise<CheckpointResult> {
  await rt.remote.registerAgent(rt.identity.agent);
  const sync = await syncMemories({ store: rt.store, remote: rt.remote, identity: rt.identity, target: rt.syncTarget });
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

/** The cross-repo block injected at SessionStart. Pure, so it is snapshot-tested. */
/** One line per other repository: online state, where its agents run and its latest checkpoint. */
export function formatRepoLines(view: {
  ownRepo: string;
  agents: Agent[];
  checkpoints: Checkpoint[];
  now: Date;
  staleMinutes: number;
}): string[] {
  const repos = [...new Set([...view.agents.map((a) => a.repo), ...view.checkpoints.map((c) => c.repo)])]
    .filter((r) => r !== view.ownRepo)
    .sort();
  return repos.map((repo) => {
    const agents = view.agents.filter((a) => a.repo === repo);
    const online = agents.some((a) => isOnline(a, view.now, view.staleMinutes));
    const where = agents.map((a) => `${a.machine} (${a.kind})`).join(", ") || "sin agentes registrados";
    const ckpt = view.checkpoints.find((c) => c.repo === repo);
    const ckptText = ckpt ? `último checkpoint ${ckpt.createdAt} en ${ckpt.branch}@${shortSha(ckpt.commitSha)}` : "sin checkpoint";
    return `- ${repo}: ${online ? "online" : "offline"} · ${where} · ${ckptText}`;
  });
}

export function formatSessionContext(view: SessionView): string {
  const repoLines = formatRepoLines({ ownRepo: view.agent.repo, ...view });
  return [
    "# orchestra-man",
    `Agente ${view.agent.id} (${view.agent.kind}) · backend ${view.mode} · memorias sincronizadas: ${view.sync.sent}${view.sync.pending ? " (quedan pendientes)" : ""}.`,
    "",
    "## Otros repositorios",
    ...(repoLines.length ? repoLines : ["- ninguno registrado todavía"]),
    "",
    `## Bandeja (${view.inbox.length} sin leer)`,
    ...(view.inbox.length ? view.inbox.slice(0, 10).map((m) => formatMessage(m)) : ["- vacía"]),
    "",
    "Memoria de este repo: seguí la skill orchestra-man:memory. Trabajo entre repositorios: skill orchestra-man:orchestra. El contexto de repos offline es el de su último checkpoint.",
  ].join("\n");
}

/** This repo's memory block (own sessions, pinned and recent memories). */
export function memoryContext(rt: Runtime, options: { compact?: boolean; maxBytes?: number } = {}): string {
  const project = rt.identity.agent.repo;
  return formatMemoryContext({
    project,
    sessions: rt.store.recentSessions(project, 5),
    pinned: rt.store.recent(project, 20, true),
    recent: rt.store.recent(project, 20),
    ...options,
  });
}

async function crossRepoContext(rt: Runtime): Promise<string> {
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

/** Local memory always comes first: it works even when the shared backend is unreachable. */
async function withCrossRepo(rt: Runtime, local: string): Promise<string> {
  try {
    return `${local}\n\n${await crossRepoContext(rt)}`;
  } catch (error) {
    return `${local}\n\n# orchestra-man\nBackend compartido no disponible: ${(error as Error).message}`;
  }
}

const startSession = (rt: Runtime, hook: HookInput) => {
  if (hook.session_id)
    rt.store.startSession({ id: hook.session_id, project: rt.identity.agent.repo, directory: hook.cwd ?? rt.identity.repoRoot });
};

/** SessionStart (startup, resume, clear). */
export async function sessionStart(rt: Runtime, hook: HookInput): Promise<string> {
  startSession(rt, hook);
  return withCrossRepo(rt, memoryContext(rt, { compact: true }));
}

/** SessionStart after compaction: the summary of what happened must be saved before continuing. */
export async function postCompact(rt: Runtime, hook: HookInput): Promise<string> {
  startSession(rt, hook);
  const steps = [
    "# orchestra-man: el contexto se compactó",
    "Antes de seguir, en este orden:",
    "1. Llamá a orchestra_session_summary con el contenido del resumen compactado (Goal, Discoveries, Accomplished, Next Steps, Relevant Files). Sin esto se pierde lo hecho antes de compactar.",
    "2. Leé la memoria de abajo y, si hace falta más, orchestra_context u orchestra_search.",
    "3. Recién entonces continuá con la tarea.",
  ].join("\n");
  return withCrossRepo(rt, `${steps}\n\n${memoryContext(rt)}`);
}

/** SessionEnd: close the session and push the last changes. */
export async function sessionEnd(rt: Runtime, hook: HookInput): Promise<void> {
  if (hook.session_id) rt.store.endSession(hook.session_id);
  await runCheckpoint(rt);
}

/** SubagentStop: saves "Key Learnings" items from the subagent's last message (passive capture). */
export function subagentStop(rt: Runtime, hook: HookInput) {
  const content = hook.last_assistant_message || hook.stdout || "";
  if (!content.trim()) return { extracted: 0, saved: 0, duplicates: 0 };
  return rt.store.capturePassive({ project: rt.identity.agent.repo, sessionId: hook.session_id ?? null, content });
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
