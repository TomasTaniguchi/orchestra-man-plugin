# Memory and sync

## Built-in memory, local first

Each machine stores its repo's memory in the plugin's local SQLite (`localDbPath`). Nothing else needs to be installed. The design reproduces [Engram](https://github.com/Gentleman-Programming/engram), the reference we started from (see [ADR 0008](../adr/0008-built-in-local-first-memory.md)):

| Behavior | How it works | Code |
| --- | --- | --- |
| Save | `orchestra_save` with `type`, `title`, `content`, `scope`, `topicKey`. Attached to the open session | `MemoryStore.save` |
| Upsert by topic | Same `topicKey` + project + scope → updated in place, `revisionCount` +1, and the previous content is kept in `mem_observation_versions` | `save`, `update` |
| Dedupe | Same normalized content (case-insensitive, no extra whitespace), title, type, project and scope within 15 minutes → only `duplicateCount` +1 | `save` |
| `<private>` | Replaced with `[REDACTED]` before saving, locally too | `stripPrivate` |
| Delete | Soft by default (hidden). Hard deletes title, content and history and leaves a tombstone to propagate the withdrawal | `delete` |
| Search | FTS5 with bm25, filters by type and scope | `search` |
| Context | Recent sessions, pinned and recent memories, capped at 16 KB | `formatMemoryContext` |
| Timeline | Memories saved before and after in the same session | `timeline` |
| Suggest topic | Family by type or keywords + normalized title segment (Engram's algorithm) | `suggestTopicKey` |
| Sessions | Opened by the start hook with the Claude Code `session_id` and closed at the end. The summary goes to the session and as a `session_summary` memory | `startSession`, `saveSessionSummary` |
| Passive capture | Items in a `## Key Learnings` / `## Aprendizajes` section of a subagent's output, saved only once | `capturePassive`, `SubagentStop` hook |
| Recovery after compaction | The `SessionStart` hook with the `compact` matcher asks to save the summary and re-injects memory | `postCompact` |

The protocol for when and how to save lives in the `plugin/skills/memory/SKILL.md` skill.

Every operation by id is scoped to the repo: you cannot read or modify another project's memory with an id.

### Scopes

| Scope | Where it lives | Shared |
| --- | --- | --- |
| `project` (default) | Local | Yes, masked, on the next sync |
| `personal` | Local | **Never.** If a memory changes from `project` to `personal`, it is withdrawn from the backend |

## Incremental sync

```
orchestra_save ──► mem_observations (local, unmasked, change_seq = max+1)
                          │
        session-start · monitor every 5 min · session-end · orchestra_sync
                          ▼
     changesSince(cursor) → toChange → maskedRemote → PUT /v1/memories (batches of 50)
                          ▼
                 advance cursor after each confirmed batch
```

- Each change (create, edit, delete or scope change) gets a monotonic `change_seq` inside its transaction. Each backend's cursor stores the last confirmed `change_seq`. So **no change is skipped**, even if two share the same timestamp or the clock goes backwards.
- The cursor advances only after the backend confirms the batch. If the network fails, the next sync retries: nothing is lost.
- Deleted or `personal` memories travel as a **withdrawal**: only `sourceId` and `updatedAt`, with no title or content.
- Each batch is **one** D1 `batch()`. An upsert never replaces a newer copy, and a withdrawal never deletes a newer copy.
- One call processes up to 10 windows of 200 changes. If more remain, it says so (`pending`) and continues on the next call.
- There is one cursor per backend (`syncTarget`), so switching Workers or moving from local to D1 uploads everything again once.

Saved data becomes available to the other repos after the next sync: within `checkpointIntervalSec` (5 minutes by default), or immediately with `orchestra_sync`.

## Checkpoints

A checkpoint is a snapshot of where a repo left off: branch, commit, uncommitted files (up to 50) and the titles of recent `project` memories. It is generated **on the machine where the code runs**, never from the Worker, because a Worker cannot read a stopped codespace. It lets another agent know **how old** the information about a stopped repo is.

## Two searches

| Tool | What it searches | Advantages |
| --- | --- | --- |
| `orchestra_search` | **This repo's** memory, local | Instant, unmasked, includes `personal` |
| `orchestra_recall` | The shared memory **of all repos** | Works with stopped codespaces. Masked data, as old as the last sync |

Both use FTS5: each query word becomes a quoted prefix term, joined with OR, and bm25 ranks the best results first. Matches are marked with `[ ]`.
