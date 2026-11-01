// Pure text helpers of the memory store. Ported from Engram's store
// (stripPrivateTags, hashNormalized, normalizeTopicKey, SuggestTopicKey, ExtractLearnings).
// Engram: https://github.com/Gentleman-Programming/engram
// MIT License, Copyright (c) 2026 Alan Buscaglia. Portions of this file derive from it.
import { createHash } from "node:crypto";

/** `<private>…</private>` is never stored, not even locally. */
export const stripPrivate = (text: string): string => text.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]").trim();

/** Whitespace- and case-insensitive content hash, used for the dedupe window. */
export const normalizedHash = (content: string): string =>
  createHash("sha256").update(content.split(/\s+/).filter(Boolean).join(" ").toLowerCase()).digest("hex");

export function normalizeTopicKey(topic: string | null | undefined): string | null {
  const key = (topic ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).join("-").slice(0, 120);
  return key || null;
}

const normalizeSegment = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-")
    .slice(0, 100);

const FAMILY_BY_TYPE: Record<string, string> = {
  architecture: "architecture",
  design: "architecture",
  adr: "architecture",
  refactor: "architecture",
  bug: "bug",
  bugfix: "bug",
  fix: "bug",
  incident: "bug",
  hotfix: "bug",
  decision: "decision",
  pattern: "pattern",
  convention: "pattern",
  guideline: "pattern",
  config: "config",
  setup: "config",
  infra: "config",
  infrastructure: "config",
  ci: "config",
  discovery: "discovery",
  investigation: "discovery",
  root_cause: "discovery",
  "root-cause": "discovery",
  learning: "learning",
  learn: "learning",
  session_summary: "session",
};

const FAMILY_BY_WORDS: [string, string[]][] = [
  ["bug", ["bug", "fix", "panic", "error", "crash", "regression", "incident", "hotfix"]],
  ["architecture", ["architecture", "design", "adr", "boundary", "hexagonal", "refactor"]],
  ["decision", ["decision", "tradeoff", "chose", "choose", "decide"]],
  ["pattern", ["pattern", "convention", "naming", "guideline"]],
  ["config", ["config", "setup", "environment", "env", "docker", "pipeline"]],
  ["discovery", ["discovery", "investigate", "investigation", "found", "root cause"]],
  ["learning", ["learned", "learning"]],
];

function topicFamily(type: string, title: string, content: string): string {
  const t = type.trim().toLowerCase();
  const byType = FAMILY_BY_TYPE[t];
  if (byType) return byType;
  const text = `${title} ${content}`.toLowerCase();
  const byWords = FAMILY_BY_WORDS.find(([, words]) => words.some((w) => text.includes(w)));
  if (byWords) return byWords[0];
  return t && t !== "manual" ? normalizeSegment(t) || "topic" : "topic";
}

/** Suggests a stable `family/segment` key, e.g. `architecture/auth-model`. A hint, not identity. */
export function suggestTopicKey(type: string, title: string, content: string): string {
  const family = topicFamily(type, title, content);
  const titleSource = stripPrivate(title);
  let source = titleSource;
  let segment = normalizeSegment(source);
  if (!segment) {
    source = stripPrivate(content).split(/\s+/).slice(0, 8).join(" ");
    segment = normalizeSegment(source);
  }
  if (segment.startsWith(`${family}-`)) segment = segment.slice(family.length + 1);
  if (!segment || segment === family) segment = "general";
  // Non-ASCII titles (e.g. Spanish accents) would collapse; a short hash keeps them distinct.
  if (/[^\x00-\x7f]/.test(source)) {
    const suffix = `-u-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
    segment = segment.slice(0, Math.min(100, 120 - family.length - 1) - suffix.length) + suffix;
  }
  return `${family}/${segment}`;
}

const LEARNING_HEADER = /^#{2,3}\s+(?:Aprendizajes(?:\s+Clave)?|Key\s+Learnings?|Learnings?):?\s*$/gim;
const MIN_LENGTH = 20;
const MIN_WORDS = 4;

const cleanMarkdown = (text: string): string =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

const items = (section: string, pattern: RegExp): string[] =>
  [...section.matchAll(pattern)]
    .map((m) => cleanMarkdown(m[1] ?? ""))
    .filter((l) => l.length >= MIN_LENGTH && l.split(" ").length >= MIN_WORDS);

/**
 * Extracts items from the last "## Key Learnings" / "## Aprendizajes" section that has any.
 * Numbered items win over bullets. Items shorter than 20 chars or 4 words are ignored.
 */
export function extractLearnings(text: string): string[] {
  const headers = [...text.matchAll(LEARNING_HEADER)];
  for (const header of headers.reverse()) {
    let section = text.slice((header.index ?? 0) + header[0].length);
    const next = /\n#{1,3} /.exec(section);
    if (next) section = section.slice(0, next.index);
    const numbered = items(section, /^\s*\d+[.)]\s+(.+)$/gm);
    const learnings = numbered.length ? numbered : items(section, /^\s*[-*]\s+(.+)$/gm);
    if (learnings.length) return learnings;
  }
  return [];
}
