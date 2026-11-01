import type { Observation, Session } from "./store";

export const CONTEXT_MAX_BYTES = 16_384;
const MARKER = "\n[truncated]";

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Cuts to `maxBytes` of UTF-8 without splitting a character, adding a visible marker. */
export function limitBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const budget = maxBytes - new TextEncoder().encode(MARKER).length;
  let cut = new TextDecoder().decode(bytes.slice(0, budget));
  if (cut.endsWith("�")) cut = cut.slice(0, -1);
  return cut + MARKER;
}

export interface MemoryContextView {
  project: string;
  sessions: Session[];
  pinned: Observation[];
  recent: Observation[];
  compact?: boolean;
  maxBytes?: number;
}

const bullet = (o: Observation, compact: boolean) => {
  const preview = compact || oneLine(o.content, 400) === o.title ? "" : `: ${oneLine(o.content, 160)}`;
  return `- [${o.type}] ${o.title} (#${o.id}${o.topicKey ? `, ${o.topicKey}` : ""}${o.scope === "personal" ? ", personal" : ""})${preview}`;
};

/** The "memory from previous sessions" block, modelled on Engram's FormatContext. Pure. */
export function formatMemoryContext(view: MemoryContextView): string {
  const compact = view.compact ?? false;
  const lines = [`## Memory from previous sessions (${view.project})`];
  if (!view.sessions.length && !view.pinned.length && !view.recent.length) {
    lines.push("", "No memories yet. Save decisions, root causes and contracts with orchestra_save.");
    return lines.join("\n");
  }
  if (view.sessions.length) {
    lines.push("", "### Recent sessions");
    for (const s of view.sessions)
      lines.push(`- ${s.startedAt}${s.endedAt ? "" : " (open)"}${s.summary ? `: ${oneLine(s.summary, 200)}` : ""}`);
  }
  if (view.pinned.length) {
    lines.push("", "### Pinned");
    for (const o of view.pinned) lines.push(bullet(o, compact));
  }
  if (view.recent.length) {
    lines.push("", "### Recent");
    for (const o of view.recent) lines.push(bullet(o, compact));
  }
  lines.push("", "Full content: orchestra_get with the #id. Search: orchestra_search.");
  return limitBytes(lines.join("\n"), view.maxBytes ?? CONTEXT_MAX_BYTES);
}
