import { LIMITS, type MemoryChange } from "../core/contract";
import type { Remote } from "../core/remote";
import type { MemoryStore, Observation } from "../memory/store";
import { truncate } from "../memory/store";
import type { GitState, Identity } from "./identity";

/** Rows read from the local store per round; each round is pushed in batches of 50. */
export const SYNC_WINDOW = 200;
/** Upper bound of rounds per sync call, so one call never runs unbounded. */
export const SYNC_MAX_ROUNDS = 10;

/** Deleted and personal memories are withdrawn remotely without sending their content. */
export function toChange(obs: Observation): MemoryChange {
  if (obs.deletedAt || obs.scope !== "project") return { sourceId: obs.syncId, updatedAt: obs.updatedAt, deleted: true };
  return {
    sourceId: obs.syncId,
    type: obs.type.slice(0, 50),
    title: truncate(obs.title, LIMITS.memoryTitleMax),
    content: truncate(obs.content, LIMITS.memoryContentMax),
    topicKey: obs.topicKey,
    createdAt: obs.createdAt,
    updatedAt: obs.updatedAt,
  };
}

export const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export interface SyncResult {
  /** Changes read from the local store and sent (upserts + withdrawals). */
  sent: number;
  /** Rows the backend actually changed (an older copy never overwrites a newer one). */
  applied: number;
  batches: number;
  /** True when SYNC_MAX_ROUNDS was reached; the rest goes in the next sync. */
  pending: boolean;
  /** Titles of the newest project memories, for the checkpoint summary. */
  recentTitles: string[];
}

/**
 * Pushes the local memory changes of this repo to the shared backend, incrementally.
 * The cursor advances only after a batch is acknowledged, so a failure resends rather than loses.
 */
export async function syncMemories(args: {
  store: MemoryStore;
  remote: Remote;
  identity: Identity;
  target: string;
}): Promise<SyncResult> {
  const { agent } = args.identity;
  let sent = 0;
  let applied = 0;
  let batches = 0;
  let pending = false;
  for (let round = 0; ; round++) {
    const changes = args.store.changesSince(args.target, agent.repo, SYNC_WINDOW);
    for (const batch of chunk(changes, LIMITS.memoriesPerBatch)) {
      const result = await args.remote.upsertMemories({ agentId: agent.id, repo: agent.repo, items: batch.map(toChange) });
      args.store.advanceCursor(args.target, agent.repo, batch[batch.length - 1] as Observation);
      sent += batch.length;
      applied += result.upserted;
      batches += 1;
    }
    if (changes.length < SYNC_WINDOW) break;
    if (round + 1 >= SYNC_MAX_ROUNDS) {
      pending = true;
      break;
    }
  }
  const recentTitles = args.store
    .recent(agent.repo, 20)
    .filter((o) => o.scope === "project")
    .slice(0, 10)
    .map((o) => o.title);
  return { sent, applied, batches, pending, recentTitles };
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
