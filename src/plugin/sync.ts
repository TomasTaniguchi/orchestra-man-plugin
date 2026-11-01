import { LIMITS, type MemoryInput } from "../core/contract";
import type { Remote } from "../core/remote";
import { type EngramClient, type EngramObservation, EngramUnavailableError } from "./engram";
import type { GitState, Identity } from "./identity";

export const SYNC_WINDOW = 200;
const TRUNCATED = "\n…[truncated by orchestra-man]";

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max - TRUNCATED.length) + TRUNCATED;

/** Maps one Engram observation to the contract. Returns null for deleted or empty ones. */
export function toMemory(obs: EngramObservation): MemoryInput | null {
  if (obs.deleted_at || !obs.title.trim() || !obs.content.trim()) return null;
  return {
    sourceId: obs.sync_id,
    type: truncate(obs.type || "note", 50),
    title: truncate(obs.title, LIMITS.memoryTitleMax),
    content: truncate(obs.content, LIMITS.memoryContentMax),
    topicKey: obs.topic_key ?? null,
    createdAt: obs.created_at,
    updatedAt: obs.updated_at,
  };
}

export const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export interface SyncResult {
  status: "synced" | "engram-unavailable";
  read: number;
  upserted: number;
  batches: number;
  detail?: string;
}

/**
 * Replicates this repo's recent Engram observations to the shared backend.
 * Every batch is one request and one D1 `batch()`. Re-sending is safe: the backend keeps the newest copy.
 * shortcut: always re-reads the last SYNC_WINDOW observations; add a high-water mark if Engram grows past that per interval.
 */
export async function syncMemories(args: {
  engram: EngramClient;
  remote: Remote;
  identity: Identity;
  project: string;
}): Promise<SyncResult> {
  let observations: EngramObservation[];
  try {
    observations = await args.engram.recentObservations(args.project, SYNC_WINDOW);
  } catch (error) {
    if (error instanceof EngramUnavailableError)
      return { status: "engram-unavailable", read: 0, upserted: 0, batches: 0, detail: error.message };
    throw error;
  }
  const memories = observations.map(toMemory).filter((m): m is MemoryInput => m !== null);
  let upserted = 0;
  const batches = chunk(memories, LIMITS.memoriesPerBatch);
  for (const items of batches) {
    upserted += (await args.remote.upsertMemories({ agentId: args.identity.agent.id, repo: args.identity.agent.repo, items })).upserted;
  }
  return { status: "synced", read: observations.length, upserted, batches: batches.length };
}

/** A plain-text snapshot of where this repo is, for agents that cannot reach it. */
export function checkpointSummary(git: GitState, recentTitles: readonly string[]): string {
  const lines = [
    `branch: ${git.branch}`,
    `commit: ${git.commitSha}`,
    `uncommitted files (${git.changedFiles.length}): ${git.changedFiles.join(", ") || "none"}`,
    "recent memories:",
    ...(recentTitles.length ? recentTitles.slice(0, 10).map((t) => `- ${t}`) : ["- none"]),
  ];
  return truncate(lines.join("\n"), LIMITS.checkpointSummaryMax);
}
